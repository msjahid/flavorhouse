import logging

import stripe
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Order, OrderItem
from .pricing import money, price_cart, promo_summary, to_cents, totals


def _ctx(request, channel="online"):
    ch = request.data.get("channel", channel)
    ctx = {"branch_id": request.data.get("branch") or None,
           "channel": ch if ch in ("online", "pos", "kiosk") else "online",
           "code": request.data.get("code", "")}
    if request.data.get("partner"):
        from .models import DeliveryPartner
        p = DeliveryPartner.objects.filter(pk=request.data.get("partner"), is_active=True).first()
        if p:
            ctx.update(channel="partner", markup=p.markup_percent, code="")
    return ctx


def order_item(order, l):
    """Snapshot of a priced line (kept even if the menu changes later)."""
    return OrderItem(order=order, menu_item=l.item, name=l.item.name, options=l.options_snapshot(),
                     unit_price=l.unit_price, regular_price=l.regular_price,
                     promotion=l.promotion.name if l.promotion else "", quantity=l.quantity, line_total=l.line_total)
from .serializers import CheckoutInputSerializer, OrderSerializer, QuoteInputSerializer

logger = logging.getLogger(__name__)
stripe.api_key = settings.STRIPE_SECRET_KEY


@api_view(["POST"])
def quote(request):
    """Return server-calculated totals for a cart (used on the cart page)."""
    s = QuoteInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    lines = price_cart(s.validated_data["items"], _ctx(request))
    t = totals(lines, s.validated_data["fulfillment"], s.validated_data.get("discount_percent") or 0)
    saved, promos = promo_summary(lines)
    out = {k: str(v) for k, v in t.items()}
    out.update(promo_savings=str(saved), promotions=promos, lines=[
        {"unit_price": str(l.unit_price), "regular_price": str(l.regular_price) if l.regular_price else None,
         "promotion": l.promotion.name if l.promotion else None, "line_total": str(l.line_total)} for l in lines])
    return Response(out)


@api_view(["POST"])
def create_checkout_session(request):
    s = CheckoutInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    data = s.validated_data

    if not settings.STRIPE_SECRET_KEY:
        return Response({"detail": "Stripe is not configured (missing STRIPE_SECRET_KEY)."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)

    from management.models import Branch
    branch = Branch.objects.filter(is_active=True, pk=request.data.get("branch") or 0).first() \
        or Branch.objects.filter(is_active=True).order_by("id").first()

    lines = price_cart(data["items"], {"branch_id": branch.pk if branch else None, "channel": "online",
                                       "code": request.data.get("code", "")})
    t = totals(lines, data["fulfillment"])
    saved, promos = promo_summary(lines)
    tip = money(data.get("tip") or 0)
    if tip > t["total"]:
        return Response({"tip": [f"A tip over ${t['total']} (the order total) looks like a typo."]}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        order = Order.objects.create(
            branch=branch, tip=tip,
            customer_name=data["customer_name"],
            customer_email=data["customer_email"],
            customer_phone=data["customer_phone"],
            fulfillment=data["fulfillment"],
            delivery_address=data.get("delivery_address", ""),
            notes=data.get("notes", ""),
            promo_discount=saved, promotions=promos,
            **t,
        )
        OrderItem.objects.bulk_create([order_item(order, l) for l in lines])

    currency = settings.STRIPE_CURRENCY
    line_items = []
    for l in lines:
        product = {"name": l.item.name}
        opts = ", ".join(o.name for o in l.options)
        if opts:
            product["description"] = opts[:500]
        if l.item.image and str(l.item.image.url).startswith("http"):
            product["images"] = [l.item.image.url]
        line_items.append({
            "price_data": {"currency": currency, "unit_amount": to_cents(l.unit_price), "product_data": product},
            "quantity": l.quantity,
        })
    if t["delivery_fee"] > 0:
        line_items.append({"price_data": {"currency": currency, "unit_amount": to_cents(t["delivery_fee"]),
                                          "product_data": {"name": "Delivery fee"}}, "quantity": 1})
    if t["tax"] > 0:
        line_items.append({"price_data": {"currency": currency, "unit_amount": to_cents(t["tax"]),
                                          "product_data": {"name": "Tax"}}, "quantity": 1})
    if tip > 0:
        line_items.append({"price_data": {"currency": currency, "unit_amount": to_cents(tip),
                                          "product_data": {"name": "Driver tip", "description": "100% goes to your delivery driver"}},
                           "quantity": 1})

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=line_items,
            customer_email=order.customer_email,
            client_reference_id=str(order.public_id),
            metadata={"order_id": str(order.public_id)},
            success_url=f"{settings.FRONTEND_URL}/order/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.FRONTEND_URL}/cart?cancelled=1",
        )
    except stripe.StripeError as e:
        logger.exception("Stripe error")
        order.status = Order.Status.CANCELLED
        order.save(update_fields=["status"])
        return Response({"detail": getattr(e, "user_message", None) or "Payment provider error."},
                        status=status.HTTP_502_BAD_GATEWAY)

    order.stripe_session_id = session.id
    order.save(update_fields=["stripe_session_id"])
    return Response({"checkout_url": session.url, "order_id": str(order.public_id)})


def _mark_paid(order: Order, payment_intent: str = ""):
    if order.status == Order.Status.PENDING:
        order.status = Order.Status.PAID
        order.paid_at = timezone.now()
        order.stripe_payment_intent = payment_intent or ""
        order.save(update_fields=["status", "paid_at", "stripe_payment_intent"])


@api_view(["GET"])
def order_by_session(request, session_id: str):
    """Called by the success page. Falls back to asking Stripe if the webhook hasn't arrived yet."""
    order = get_object_or_404(Order.objects.prefetch_related("items"), stripe_session_id=session_id)
    if order.status == Order.Status.PENDING and settings.STRIPE_SECRET_KEY:
        try:
            session = stripe.checkout.Session.retrieve(session_id)
            if session.payment_status == "paid":
                _mark_paid(order, session.payment_intent or "")
        except stripe.StripeError:
            logger.warning("Could not verify session %s", session_id)
    return Response(OrderSerializer(order).data)


@api_view(["GET"])
def order_detail(request, public_id):
    order = get_object_or_404(Order.objects.prefetch_related("items"), public_id=public_id)
    return Response(OrderSerializer(order).data)


@csrf_exempt
def stripe_webhook(request):
    payload = request.body
    sig = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        return HttpResponse(status=400)

    obj = event["data"]["object"]
    if event["type"] in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        order = Order.objects.filter(stripe_session_id=obj["id"]).first()
        if order and obj.get("payment_status") == "paid":
            _mark_paid(order, obj.get("payment_intent") or "")
    elif event["type"] in ("checkout.session.expired", "checkout.session.async_payment_failed"):
        Order.objects.filter(stripe_session_id=obj["id"], status=Order.Status.PENDING).update(
            status=Order.Status.CANCELLED
        )
    return HttpResponse(status=200)
