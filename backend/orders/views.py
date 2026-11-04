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
from .pricing import price_cart, to_cents, totals
from .serializers import CheckoutInputSerializer, OrderSerializer, QuoteInputSerializer

logger = logging.getLogger(__name__)
stripe.api_key = settings.STRIPE_SECRET_KEY


@api_view(["POST"])
def quote(request):
    """Return server-calculated totals for a cart (used on the cart page)."""
    s = QuoteInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    lines = price_cart(s.validated_data["items"])
    t = totals(lines, s.validated_data["fulfillment"])
    return Response({k: str(v) for k, v in t.items()})


@api_view(["POST"])
def create_checkout_session(request):
    s = CheckoutInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    data = s.validated_data

    if not settings.STRIPE_SECRET_KEY:
        return Response({"detail": "Stripe is not configured (missing STRIPE_SECRET_KEY)."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)

    lines = price_cart(data["items"])
    t = totals(lines, data["fulfillment"])

    with transaction.atomic():
        order = Order.objects.create(
            customer_name=data["customer_name"],
            customer_email=data["customer_email"],
            customer_phone=data["customer_phone"],
            fulfillment=data["fulfillment"],
            delivery_address=data.get("delivery_address", ""),
            notes=data.get("notes", ""),
            **t,
        )
        OrderItem.objects.bulk_create([
            OrderItem(
                order=order, menu_item=l.item, name=l.item.name, options=l.options_snapshot(),
                unit_price=l.unit_price, quantity=l.quantity, line_total=l.line_total,
            )
            for l in lines
        ])

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
