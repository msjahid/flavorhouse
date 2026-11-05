import datetime
from datetime import timedelta
from decimal import Decimal, InvalidOperation

import stripe
from django.conf import settings
from django.contrib.auth import authenticate
from django.core import signing
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from management.auth import StaffTokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from management import audit
from management.access import MANAGER, IsActiveStaff, actor_for, check_branch, require, scope
from management.auth import EMPLOYEE_TTL, STAFF_TTL, hash_key, terminal_for
from management.models import Branch, DayOpen, StaffProfile, Terminal, TimeEntry
from management.reports import sales_summary
from menu.models import Category, MenuItem
from orders.models import DeliveryPartner, DisplayState, Order, OrderItem, OrderPayment, TipSettings
from orders.pricing import money, price_cart, promo_summary, totals
from orders.views import order_item

from .serializers import (
    KioskOrderInputSerializer,
    PayInputSerializer,
    PosCategorySerializer,
    PosOrderInputSerializer,
    PosOrderSerializer,
    StatusUpdateSerializer,
)

APPROVAL_SALT = "pos-approval"
APPROVAL_MAX_AGE = 300  # a manager approval is valid for 5 minutes


def staff_api(methods):
    """Decorator stack for POS endpoints: token login + active staff only."""
    def wrap(fn):
        fn = permission_classes([IsActiveStaff])(fn)
        fn = authentication_classes([StaffTokenAuthentication])(fn)
        return api_view(methods)(fn)
    return wrap


def _branches_for(actor):
    qs = Branch.objects.filter(is_active=True)
    return qs if actor.branch_ids is None else qs.filter(pk__in=actor.branch_ids)


def _user_payload(actor):
    p = actor.profile
    branch = p.branch if p else None
    return {
        "id": actor.user.id, "username": actor.user.username, "employee_id": p.employee_id if p else actor.user.username,
        "name": actor.name, "role": actor.role, "role_display": p.get_role_display() if p else "Admin",
        "level": actor.level, "discount_limit": actor.discount_limit, "can_refund": actor.can_refund,
        "branch": {"id": branch.id, "name": branch.name} if branch else None,
        "branches": [{"id": b.id, "name": b.name} for b in _branches_for(actor)],
        "is_superuser": actor.user.is_superuser,
        "photo_url": (p.photo.url if p and p.photo else None),
        "job_title": p.job_title if p else "",
    }


def _find_user(login_id: str, password: str):
    """Sign in with employee ID (or username) + password."""
    login_id = (login_id or "").strip()
    prof = StaffProfile.objects.select_related("user").filter(employee_id__iexact=login_id).first()
    username = prof.user.username if prof else login_id
    return authenticate(username=username, password=password or "")


# ---------------------------------------------------------------- auth

@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def login(request):
    user = _find_user(request.data.get("username") or request.data.get("employee_id"), request.data.get("password"))
    if not user or not user.is_active:
        return Response({"detail": "Wrong employee ID or password."}, status=status.HTTP_400_BAD_REQUEST)
    actor = actor_for(user)
    if not actor:
        prof = getattr(user, "staff", None)
        msg = {
            "pending": "Your account is waiting to be verified by a supervisor.",
            "rejected": "Your account was not approved. Please talk to your manager.",
            "inactive": "Your account is inactive.",
        }.get(prof.status if prof else "", "This account doesn't have staff access.")
        return Response({"detail": msg}, status=status.HTTP_403_FORBIDDEN)
    term = terminal_for(request)
    if actor.level == 1 and settings.REQUIRE_REGISTERED_DEVICE:  # employees: only on a registered device of their own store
        if not term:
            return Response({"detail": "This device isn't registered for the POS. Ask your manager to register it.",
                             "code": "device_not_registered"}, status=status.HTTP_403_FORBIDDEN)
        if term.branch_id != actor.branch_id:
            return Response({"detail": f"This device belongs to {term.branch.name}. You work at another store."},
                            status=status.HTTP_403_FORBIDDEN)
    token = Token.objects.filter(user=user).first()
    ttl = EMPLOYEE_TTL if actor.level == 1 else STAFF_TTL
    if token and timezone.now() - token.created > ttl:
        token.delete()
        token = None
    token = token or Token.objects.create(user=user)
    if term:
        Terminal.objects.filter(pk=term.pk).update(last_seen=timezone.now(), last_user=user)
    audit.log(user, "signed in", "session", object_id=user.pk, branch=term.branch_id if term else actor.branch_id,
              summary=f"{actor.name} signed in" + (f" on {term.name} ({term.branch.name})" if term else " (unregistered device)"))
    payload = _user_payload(actor)
    payload["device"] = {"id": term.id, "name": term.name, "branch": term.branch_id} if term else None
    return Response({"token": token.key, "user": payload})


@staff_api(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@staff_api(["GET"])
def me(request):
    return Response(_user_payload(request.actor))


@staff_api(["POST"])
def authorize(request):
    """Manager override: a higher role types their ID + password to approve ONE discount or refund."""
    action = request.data.get("action")
    if action not in ("discount", "refund"):
        raise ValidationError({"action": "Must be 'discount' or 'refund'."})
    user = _find_user(request.data.get("employee_id"), request.data.get("password"))
    approver = actor_for(user) if user else None
    if not approver:
        raise ValidationError({"detail": "Wrong employee ID or password."})
    branch_id = request.data.get("branch_id")
    if branch_id:
        check_branch(approver, branch_id)
    percent = _percent(request.data.get("percent", 0))
    if action == "discount" and percent > approver.discount_limit:
        raise PermissionDenied(f"{approver.name} can approve discounts up to {approver.discount_limit}% only.")
    if action == "refund" and not approver.can_refund:
        raise PermissionDenied(f"{approver.name} can't approve refunds.")
    token = signing.dumps({"u": approver.user.id, "a": action, "p": str(percent)}, salt=APPROVAL_SALT)
    return Response({"approval": token, "approver": approver.name, "limit": approver.discount_limit})


def _percent(v) -> Decimal:
    try:
        p = Decimal(str(v or 0)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValidationError({"discount_percent": "Enter a number."})
    if p < 0 or p > 100:
        raise ValidationError({"discount_percent": "Discount must be between 0 and 100%."})
    return p


def _approver(request, action: str, percent: Decimal = Decimal("0")):
    """Who is allowed to do this: the signed-in person, or the manager who approved it with their password."""
    me_ = request.actor
    if action == "discount" and percent <= me_.discount_limit:
        return me_.user
    if action == "refund" and me_.can_refund:
        return me_.user
    token = request.data.get("approval")
    if not token:
        raise PermissionDenied({"detail": "A manager needs to approve this.", "code": "approval_required"})
    try:
        data = signing.loads(token, salt=APPROVAL_SALT, max_age=APPROVAL_MAX_AGE)
    except signing.BadSignature:
        raise PermissionDenied({"detail": "The manager approval expired. Ask again.", "code": "approval_required"})
    if data["a"] != action or (action == "discount" and Decimal(data["p"]) < percent):
        raise PermissionDenied({"detail": "The manager approval doesn't match this action.", "code": "approval_required"})
    from django.contrib.auth import get_user_model
    return get_user_model().objects.get(pk=data["u"])


def _branch(request, required=True):
    """Branch for this register: staff tied to a branch always use theirs; supervisors+ choose one."""
    a = request.actor
    value = request.data.get("branch_id") if request.method == "POST" else request.query_params.get("branch")
    if a.branch_id and not a.multi_branch:
        return Branch.objects.get(pk=a.branch_id)
    if value:
        check_branch(a, value)
        return get_object_or_404(Branch, pk=value)
    if a.branch_id:
        return Branch.objects.get(pk=a.branch_id)
    if required:
        raise ValidationError({"branch_id": "Choose which branch this register is in."})
    return None


OPEN_STATUSES = ["unpaid", "paid", "preparing", "ready", "out_for_delivery"]


def _employee_window(qs, actor):
    """Employees only see today's orders (plus anything still open, e.g. a late order crossing midnight).
    Managers and above see every day."""
    if actor.level >= MANAGER:
        return qs
    from django.db.models import Q
    midnight = timezone.make_aware(datetime.datetime.combine(timezone.localdate(), datetime.time.min))
    return qs.filter(Q(created_at__gte=midnight) | Q(status__in=OPEN_STATUSES))


def _order_for(request, order_id):
    order = get_object_or_404(_employee_window(Order.objects.prefetch_related("items"), request.actor), pk=order_id)
    if order.branch_id:
        check_branch(request.actor, order.branch_id)
    return order


# ---------------------------------------------------------------- menu

@staff_api(["GET"])
def menu(request):
    cats = Category.objects.filter(is_active=True)
    return Response({
        "categories": PosCategorySerializer(cats, many=True, context={"request": request}).data,
        "tax_rate": str(settings.TAX_RATE),
        "partners": [_partner_json(p) for p in DeliveryPartner.objects.filter(is_active=True)],
        "tips": _tip_settings_json(),
    })


def _partner_json(p):
    return {"id": p.id, "name": p.name, "emoji": p.emoji, "color": p.color,
            "markup_percent": str(p.markup_percent), "commission_percent": str(p.commission_percent)}


def _tip_settings_json():
    t = TipSettings.get()
    return {"enabled": t.enabled, "percents": [float(x) for x in (t.percents or [])], "allow_custom": t.allow_custom}


@staff_api(["POST"])
def toggle_item(request, item_id: int):
    """Mark an item sold out / back in stock (managers and above)."""
    require(request.actor, MANAGER, "mark items sold out")
    item = get_object_or_404(MenuItem, pk=item_id)
    item.is_available = bool(request.data.get("is_available", not item.is_available))
    item.save(update_fields=["is_available"])
    audit.log(request.user, "updated", "menu item", item, branch=None,
              summary=f"{item.name} {'back in stock' if item.is_available else 'sold out'}")
    return Response({"id": item.id, "is_available": item.is_available})


# ---------------------------------------------------------------- orders

@staff_api(["GET", "POST"])
def orders(request):
    if request.method == "POST":
        return _create_pos_order(request)

    qs = Order.objects.select_related("created_by", "branch").prefetch_related("items", "payments").exclude(status=Order.Status.PENDING)
    p = request.query_params
    qs = scope(qs, request.actor, branch_param=p.get("branch"))
    employee = request.actor.level < MANAGER
    if employee:
        qs = _employee_window(qs, request.actor)   # employees: today only — older sales are hidden

    day = "all" if employee else p.get("date", "today")
    start, end = (None, None) if employee else (_parse_dt(p.get("start")), _parse_dt(p.get("end")))
    if start and end:
        # The register sends its own local day (midnight → midnight), so the list matches what staff see on the clock
        qs = qs.filter(created_at__gte=start, created_at__lt=end)
    elif day != "all":
        d = timezone.localdate() if day == "today" else _parse_date(day)
        qs = qs.filter(created_at__date=d)
    if s := p.get("status"):
        qs = qs.filter(status__in=s.split(","))
    if src := p.get("source"):
        qs = qs.filter(source=src)
    if q := p.get("search", "").strip():
        from django.db.models import Q
        num = q.upper().replace("FH-", "")
        cond = Q(customer_name__icontains=q) | Q(customer_phone__icontains=q) | Q(customer_email__icontains=q)
        if num.isdigit():
            cond |= Q(pk=int(num))
        qs = qs.filter(cond)

    if p.get("order") == "oldest":  # kitchen shows oldest first
        qs = qs.order_by("created_at")
    return Response(PosOrderSerializer(qs[:300], many=True).data)


@staff_api(["GET"])
def orders_summary(request):
    """Totals for the Orders tab: the register's local day (?start=&end=) or ?date=. Managers and above."""
    require(request.actor, MANAGER, "see sales totals")
    p = request.query_params
    qs = scope(Order.objects.exclude(status=Order.Status.PENDING), request.actor, branch_param=p.get("branch"))
    start, end = _parse_dt(p.get("start")), _parse_dt(p.get("end"))
    if not (start and end):
        d = _parse_date(p["date"]) if p.get("date") else timezone.localdate()
        start = timezone.make_aware(datetime.datetime.combine(d, datetime.time.min))
        end = start + datetime.timedelta(days=1)
    from django.db.models import Count, Q, Sum
    from orders.models import method_totals
    placed = qs.filter(created_at__gte=start, created_at__lt=end)
    sales = placed.filter(status__in=Order.SALE_STATUSES + [Order.Status.REFUNDED])
    refunded = qs.filter(status=Order.Status.REFUNDED, refunded_at__gte=start, refunded_at__lt=end)
    agg = sales.aggregate(n=Count("id"), t=Sum("total"), tax=Sum("tax"), disc=Sum("discount_amount"), promo=Sum("promo_discount"),
                          tips=Sum("tip", filter=~Q(status=Order.Status.REFUNDED)))
    ref = refunded.aggregate(n=Count("id"), t=Sum("total"))
    taken = method_totals(sales)
    back = method_totals(refunded)
    z = Decimal("0")
    m = lambda v: str(money(v))  # noqa: E731
    return Response({
        "start": start, "end": end,
        "orders": agg["n"] or 0, "sales": m(agg["t"] or z), "tax": m(agg["tax"] or z),
        "discounts": m((agg["disc"] or z) + (agg["promo"] or z)),
        "refunds": {"count": ref["n"] or 0, "total": m(ref["t"] or z)},
        "net": m((agg["t"] or z) - (ref["t"] or z)),
        "tips": m(agg["tips"] or z),
        "by_method": [{"key": k, "label": {"cash": "Cash", "card": "Card", "stripe": "Online", "partner": "Delivery apps"}[k],
                       "taken": m(taken.get(k, z)), "refunded": m(back.get(k, z)),
                       "net": m(taken.get(k, z) - back.get(k, z))} for k in ("cash", "card", "stripe", "partner")
                      if k != "partner" or taken.get(k) or back.get(k)],
        "by_app": [{"name": r["partner__name"], "orders": r["n"], "sales": m(r["t"] or z)} for r in
                   sales.filter(partner__isnull=False).values("partner__name").annotate(n=Count("id"), t=Sum("total")).order_by("-t")],
        "unpaid": placed.filter(status=Order.Status.UNPAID).count(),
        "cancelled": placed.filter(status=Order.Status.CANCELLED).count(),
        "split_orders": sales.filter(payment_method="split").count(),
    })


def _parse_dt(v):
    if not v:
        return None
    try:
        d = datetime.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if timezone.is_aware(d) else timezone.make_aware(d)


def _parse_payments(data, total):
    """Counter payment, single or split. Returns (method, cash_received, change, parts).
    data: {"payments": [{"method": "cash"|"card", "amount": "10.00", "tendered": "20.00", "card_last4": "4242"}, …]}
    or the older {"payment_method": "cash"|"card", "cash_received": "20.00"}."""
    raw = data.get("payments")
    if not raw:
        method = data.get("payment_method")
        if method not in ("cash", "card"):
            raise ValidationError({"payment_method": "Choose cash or card."})
        received, change = _cash(method, data.get("cash_received"), total)
        part = {"method": method, "amount": total, "tendered": received, "change": change or Decimal("0"), "card_last4": ""}
        return method, received, change, [part]
    parts = []
    try:
        for p in raw:
            m = p.get("method")
            if m not in ("cash", "card"):
                raise ValidationError({"payments": "Each payment is cash or card."})
            amount = money(Decimal(str(p.get("amount"))))
            if amount <= 0:
                raise ValidationError({"payments": "Each payment must be more than $0."})
            tendered = money(Decimal(str(p["tendered"]))) if m == "cash" and p.get("tendered") not in (None, "") else (amount if m == "cash" else None)
            if m == "cash" and tendered < amount:
                raise ValidationError({"payments": f"Cash handed over ({tendered}) is less than the cash part ({amount})."})
            last4 = "".join(c for c in str(p.get("card_last4") or "") if c.isdigit())[-4:]
            parts.append({"method": m, "amount": amount, "tendered": tendered,
                          "change": money(tendered - amount) if m == "cash" else Decimal("0"), "card_last4": last4})
    except (ArithmeticError, TypeError, ValueError):
        raise ValidationError({"payments": "Check the payment amounts."})
    if len(parts) > 8:
        raise ValidationError({"payments": "Up to 8 payments per order."})
    paid = sum((x["amount"] for x in parts), Decimal("0"))
    if paid != total:
        raise ValidationError({"payments": f"The payments add up to ${paid}, but the total is ${total}."})
    cash = [x for x in parts if x["method"] == "cash"]
    method = "split" if len(parts) > 1 else parts[0]["method"]
    received = sum((x["tendered"] for x in cash), Decimal("0")) if cash else None
    change = sum((x["change"] for x in cash), Decimal("0")) if cash else None
    return method, received, change, parts


def _tip(data, total) -> Decimal:
    """Tip on top of the order (not taxed, not a sale). Up to the order total."""
    raw = data.get("tip")
    if raw in (None, "", 0, "0"):
        return Decimal("0.00")
    try:
        tip = money(Decimal(str(raw)))
    except (ArithmeticError, ValueError, TypeError):
        raise ValidationError({"tip": "Enter the tip as an amount, e.g. 2.50."})
    if tip < 0:
        raise ValidationError({"tip": "The tip can't be negative."})
    if tip > total:
        raise ValidationError({"tip": f"A tip over ${total} (the order total) looks like a typo."})
    return tip


def _save_payments(order, parts):
    OrderPayment.objects.filter(order=order).delete()
    OrderPayment.objects.bulk_create([OrderPayment(order=order, **x) for x in parts])


def _cash(method, received, total):
    """Returns (cash_received, change) for cash payments, (None, None) for card."""
    if method != "cash":
        return None, None
    received = money(total if received is None else received)
    if received < total:
        raise ValidationError({"cash_received": f"Cash received is less than the total ({total})."})
    return received, money(received - total)


def _add_lines(order, lines):
    OrderItem.objects.bulk_create([order_item(order, l) for l in lines])


def _fresh(order):
    return Order.objects.prefetch_related("items", "payments").select_related("created_by", "branch").get(pk=order.pk)


def _require_day_open(branch):
    if not DayOpen.objects.filter(branch=branch, date=timezone.localdate()).exists():
        raise ValidationError({"detail": "The day hasn't been started. A manager needs to count the opening cash first.",
                               "code": "day_not_started"})


def _create_partner_order(request, data, branch, partner_id):
    """An order that came in on Uber Eats / DoorDash / Grubhub… — already paid on the app."""
    partner = DeliveryPartner.objects.filter(pk=partner_id, is_active=True).first()
    if not partner:
        raise ValidationError({"partner": "That delivery app isn't set up (or was turned off)."})
    ref = (request.data.get("partner_ref") or "").strip()[:40]
    if not ref:
        raise ValidationError({"partner_ref": f"Enter the {partner.name} order number."})
    if not data.get("customer_name", "").strip():
        raise ValidationError({"customer_name": "Enter the customer's name from the app."})
    if Order.objects.filter(partner=partner, partner_ref__iexact=ref, branch=branch,
                            created_at__gte=timezone.now() - timedelta(days=2)).exists():
        raise ValidationError({"partner_ref": f"{partner.name} order {ref} was already rung in."})
    lines = price_cart(data["items"], {"branch_id": branch.pk, "channel": "partner", "markup": partner.markup_percent})
    t = totals(lines, "pickup")   # the app charges the customer its own delivery fee
    commission = money((t["subtotal"] - t["discount_amount"]) * partner.commission_percent / 100)
    with transaction.atomic():
        order = Order.objects.create(
            source=Order.Source.PARTNER, status=Order.Status.PAID, branch=branch,
            payment_method=Order.PaymentMethod.PARTNER,
            fulfillment="delivery" if data["fulfillment"] == "delivery" else "pickup",
            customer_name=data.get("customer_name", ""), customer_phone=data.get("customer_phone", ""),
            notes=data.get("notes", ""), created_by=request.user, paid_at=timezone.now(),
            partner=partner, partner_ref=ref, partner_commission=commission,
            partner_collects_tax=partner.collects_tax, **t,
        )
        _add_lines(order, lines)
    return Response(PosOrderSerializer(_fresh(order)).data, status=status.HTTP_201_CREATED)


def _create_pos_order(request):
    s = PosOrderInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    data = s.validated_data
    branch = _branch(request)
    _require_day_open(branch)
    if request.data.get("partner"):
        return _create_partner_order(request, data, branch, request.data.get("partner"))
    if data["fulfillment"] == "delivery":
        raise ValidationError({"fulfillment": "Delivery from the counter isn't offered — choose dine-in or takeaway."})

    pct = _percent(request.data.get("discount_percent", 0))
    reason = (request.data.get("discount_reason") or "").strip()
    approver = None
    if pct > 0:
        if not reason:
            raise ValidationError({"discount_reason": "Give a reason for the discount."})
        approver = _approver(request, "discount", pct)

    lines = price_cart(data["items"], {"branch_id": branch.pk, "channel": "pos"})
    t = totals(lines, data["fulfillment"], pct)
    saved, promos = promo_summary(lines)
    tip = _tip(request.data, t["total"])
    method, cash_received, change, parts = _parse_payments(request.data, t["total"] + tip)

    now = timezone.now()
    with transaction.atomic():
        order = Order.objects.create(
            source=Order.Source.POS,
            status=Order.Status.PAID,
            branch=branch,
            payment_method=method,
            fulfillment=data["fulfillment"],
            customer_name=data.get("customer_name", ""),
            customer_phone=data.get("customer_phone", ""),
            customer_email=data.get("customer_email", ""),
            notes=data.get("notes", ""),
            cash_received=cash_received,
            change_given=change,
            created_by=request.user,
            paid_at=now,
            discount_percent=pct,
            discount_reason=reason[:160],
            discount_approved_by=approver,
            promo_discount=saved, promotions=promos, tip=tip,
            **t,
        )
        _add_lines(order, lines)
        _save_payments(order, parts)
    return Response(PosOrderSerializer(_fresh(order)).data, status=status.HTTP_201_CREATED)


@staff_api(["GET"])
def order_detail(request, order_id: int):
    return Response(PosOrderSerializer(_order_for(request, order_id)).data)


@staff_api(["POST"])
def order_status(request, order_id: int):
    order = _order_for(request, order_id)
    s = StatusUpdateSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    new = s.validated_data["status"]
    if order.status in (Order.Status.PENDING, Order.Status.REFUNDED):
        raise ValidationError({"status": f"Can't change an order that is '{order.get_status_display()}'."})
    if order.status == Order.Status.UNPAID and new != Order.Status.CANCELLED:
        raise ValidationError({"status": "This order hasn't been paid yet. Take payment first."})
    order.status = new
    fields = ["status"]
    if new == Order.Status.READY:
        order.ready_at = timezone.now()
        fields.append("ready_at")
    order.save(update_fields=fields)
    return Response(PosOrderSerializer(_fresh(order)).data)


@staff_api(["POST"])
def order_refund(request, order_id: int):
    order = _order_for(request, order_id)
    if order.status in (Order.Status.PENDING, Order.Status.UNPAID, Order.Status.REFUNDED, Order.Status.CANCELLED):
        raise ValidationError({"detail": f"This order is '{order.get_status_display()}' and can't be refunded."})
    approver = _approver(request, "refund")

    if order.payment_method == Order.PaymentMethod.STRIPE:
        if not order.stripe_payment_intent:
            raise ValidationError({"detail": "No Stripe payment found for this order."})
        stripe.api_key = settings.STRIPE_SECRET_KEY
        try:
            stripe.Refund.create(payment_intent=order.stripe_payment_intent)
        except stripe.StripeError as e:
            raise ValidationError({"detail": getattr(e, "user_message", None) or "Stripe refused the refund."})

    order.status = Order.Status.REFUNDED
    order.refunded_at = timezone.now()
    order.refunded_by = approver
    order.refund_reason = (request.data.get("reason") or "")[:255]
    order.save(update_fields=["status", "refunded_at", "refunded_by", "refund_reason"])
    audit.log(request.user, "refunded", "order", order, approved_by=approver if approver != request.user else None,
              summary=f"Refunded {order.number} ${order.total} — {order.refund_reason}")
    if order.payment_method == "partner":
        msg = f"Marked as refunded. Refund the customer in the {order.partner.name if order.partner else 'delivery'} app / merchant portal."
    elif order.payment_method == "stripe":
        msg = "Refunded to the customer's card via Stripe."
    elif order.payment_method == "split":
        parts = ", ".join(f"${p.amount} {'cash' if p.method == 'cash' else 'on card' + (f' ••{p.card_last4}' if p.card_last4 else '')}"
                          for p in order.payments.all())
        msg = f"Marked as refunded. Give back: {parts}."
    else:
        msg = "Marked as refunded. Give the money back by cash / on the card machine."
    return Response({"order": PosOrderSerializer(_fresh(order)).data, "message": msg})


@staff_api(["POST"])
def order_pay(request, order_id: int):
    """Cashier takes payment for a self-order kiosk order -> it goes to the kitchen."""
    order = _order_for(request, order_id)
    if order.status != Order.Status.UNPAID:
        raise ValidationError({"detail": f"This order is '{order.get_status_display()}', not waiting for payment."})
    if order.branch_id:
        _require_day_open(order.branch)
    s = PayInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    order.tip = _tip(request.data, order.total)
    method, order.cash_received, order.change_given, parts = _parse_payments(request.data, order.total + order.tip)
    order.payment_method = method
    order.status = Order.Status.PAID
    order.paid_at = timezone.now()
    order.created_by = request.user
    with transaction.atomic():
        order.save(update_fields=["cash_received", "change_given", "payment_method", "status", "paid_at", "created_by", "tip"])
        _save_payments(order, parts)
    return Response(PosOrderSerializer(_fresh(order)).data)


# ---------------------------------------------------------------- self-order kiosk

@staff_api(["POST"])
def kiosk_order(request):
    """Customer places an order on the in-store kiosk; they pay at the counter.
    (The kiosk device is signed in once with a staff account of that branch.)"""
    s = KioskOrderInputSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    data = s.validated_data
    branch = _branch(request)
    lines = price_cart(data["items"], {"branch_id": branch.pk, "channel": "kiosk"})
    t = totals(lines, data["fulfillment"])
    saved, promos = promo_summary(lines)
    with transaction.atomic():
        order = Order.objects.create(
            promo_discount=saved, promotions=promos,
            source=Order.Source.KIOSK, status=Order.Status.UNPAID, payment_method="", branch=branch,
            fulfillment=data["fulfillment"], customer_name=data["customer_name"].strip(), **t,
        )
        _add_lines(order, lines)
    return Response(PosOrderSerializer(_fresh(order)).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------- time clock

def _open_entry(profile):
    return TimeEntry.objects.filter(staff=profile, clock_out__isnull=True).order_by("-clock_in").first()


def _today_hours(profile):
    entries = TimeEntry.objects.filter(staff=profile, clock_in__date=timezone.localdate())
    return str(sum((e.hours for e in entries), Decimal("0")))


def _week_hours(profile):
    today = timezone.localdate()
    start = today - timedelta(days=today.weekday())
    entries = TimeEntry.objects.filter(staff=profile, clock_in__date__gte=start, clock_in__date__lte=today)
    return sum((e.hours for e in entries), Decimal("0"))


@staff_api(["GET", "POST"])
def clock(request):
    """GET: am I clocked in? POST: clock in (or out if already in)."""
    profile = request.actor.profile
    if not profile:
        raise ValidationError({"detail": "Owner accounts don't use the time clock."})
    entry = _open_entry(profile)
    if request.method == "POST":
        if entry:
            entry.clock_out = timezone.now()
            entry.tips = money(request.data.get("tips") or 0)
            entry.save(update_fields=["clock_out", "tips"])
            entry = None
        else:
            entry = TimeEntry.objects.create(staff=profile, branch=_branch(request), clock_in=timezone.now())
    return Response({
        "clocked_in": bool(entry),
        "since": entry.clock_in if entry else None,
        "branch": entry.branch.name if entry else None,
        "today_hours": _today_hours(profile),
        "week_hours": str(_week_hours(profile)),
        "hourly_rate": str(profile.hourly_rate or 0) if profile.pay_type != "salary" else None,
        "pay_type": profile.pay_type,
    })


# ---------------------------------------------------------------- customer status board (public, read-only)

@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def status_board(request):
    """Order numbers for the in-store TV. Shows only number + first name; no other details."""
    now = timezone.now()
    qs = (Order.objects.filter(created_at__date=timezone.localdate())
          .exclude(fulfillment=Order.Fulfillment.DELIVERY))
    if b := request.query_params.get("branch"):
        qs = qs.filter(branch_id=b)

    def row(o):
        first = (o.customer_name or "").split(" ")[0][:12]
        return {"id": o.id, "number": o.short_number, "name": first}

    preparing = qs.filter(status__in=[Order.Status.PAID, Order.Status.PREPARING]).order_by("paid_at", "id")
    ready = qs.filter(status=Order.Status.READY, ready_at__gte=now - datetime.timedelta(minutes=30)).order_by("-ready_at")
    return Response({
        "preparing": [row(o) for o in preparing[:40]],
        "ready": [row(o) for o in ready[:24]],
    })


# ---------------------------------------------------------------- reports

def _parse_date(value: str) -> datetime.date:
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise ValidationError({"date": "Use the format YYYY-MM-DD."})


@staff_api(["GET"])
def daily_report(request):
    require(request.actor, MANAGER, "see sales reports")
    d = request.query_params.get("date")
    day = _parse_date(d) if d else timezone.localdate()
    qs = scope(Order.objects.all(), request.actor, branch_param=request.query_params.get("branch"))
    r = sales_summary(qs, day, day)
    r["date"] = day.isoformat()
    return Response(r)


# ---------------------------------------------------------------- start of day

DENOMS = ["100", "50", "20", "10", "5", "2", "1", "0.25", "0.10", "0.05", "0.01"]


@staff_api(["GET", "POST"])
def day(request):
    """GET: is today started at this store? POST (manager+): count the opening cash and start the day."""
    branch = _branch(request)
    today = timezone.localdate()
    opened = DayOpen.objects.filter(branch=branch, date=today).select_related("opened_by").first()
    if request.method == "POST":
        require(request.actor, MANAGER, "start the day")
        if opened:
            raise ValidationError({"detail": "Today is already started."})
        denoms = request.data.get("denominations") or {}
        try:
            denoms = {k: int(v or 0) for k, v in denoms.items() if k in DENOMS and int(v or 0) > 0}
        except (ValueError, AttributeError):
            raise ValidationError({"denominations": "Counts must be whole numbers."})
        amount = money(sum((Decimal(k) * v for k, v in denoms.items()), Decimal("0")))
        opened = DayOpen.objects.create(branch=branch, date=today, opening_float=amount, denominations=denoms,
                                        note=(request.data.get("note") or "")[:255], opened_by=request.user)
        audit.log(request.user, "created", "day start", opened, summary=f"Started {branch.name} {today} with ${amount}")
    return Response({
        "branch": branch.id, "date": today.isoformat(), "started": bool(opened),
        "opening_float": str(opened.opening_float) if opened else None,
        "opened_by": (opened.opened_by.get_full_name() or opened.opened_by.username) if opened and opened.opened_by else None,
        "opened_at": opened.created_at if opened else None,
        "suggested_float": str(branch.opening_float), "denominations": DENOMS,
    })


# ---------------------------------------------------------------- registered devices

@staff_api(["GET", "POST"])
def device(request):
    """GET: is this device registered? POST (manager+): register this device for a store; returns its secret key once."""
    term = terminal_for(request)
    if request.method == "POST":
        require(request.actor, MANAGER, "register devices")
        branch = _branch(request)
        name = (request.data.get("name") or "").strip()[:80]
        if not name:
            raise ValidationError({"name": "Give the device a name, e.g. Front register."})
        import secrets
        key = secrets.token_urlsafe(32)
        term = Terminal.objects.create(branch=branch, name=name, key_hash=hash_key(key), registered_by=request.user)
        audit.log(request.user, "created", "device", term, summary=f"Registered device '{name}' at {branch.name}")
        return Response({"key": key, "id": term.id, "name": term.name, "branch": branch.id, "branch_name": branch.name},
                        status=status.HTTP_201_CREATED)
    return Response({"registered": bool(term), "id": term.id if term else None, "name": term.name if term else None,
                     "branch": term.branch_id if term else None, "branch_name": term.branch.name if term else None})


# ---------------------------------------------------------------- customer-facing screen (+ tip prompt)

def _display_key(request):
    """The customer screen pairs with the register by a private screen ID kept in the register's browser
    (sent as X-Screen-Id). It isn't tied to who is signed in, so a shift change doesn't blank the screen."""
    import re
    sid = request.META.get("HTTP_X_SCREEN_ID") or request.query_params.get("screen") or ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{12,40}", sid):
        raise ValidationError({"detail": "Open the customer screen from the register (📺 Customer screen)."})
    return f"s{sid}"


def _display_json(d: DisplayState):
    return {"state": d.state, "tip_answer": d.tip_answer, "updated_at": d.updated_at, "tips": _tip_settings_json()}


def _soft_auth(fn):
    """No sign-in: the screen faces customers and keeps running across staff log-outs; the screen ID pairs it."""
    fn = permission_classes([permissions.AllowAny])(fn)
    fn = authentication_classes([])(fn)
    return fn


@api_view(["GET", "POST"])
@_soft_auth
def display(request):
    """GET: what the customer screen should show. POST {state}: the register updates it (cart, tip prompt, thanks, idle)."""
    d, _ = DisplayState.objects.get_or_create(key=_display_key(request))
    if request.method == "POST":
        import json
        state = request.data.get("state") or {}
        if not isinstance(state, dict) or len(json.dumps(state)) > 30000:
            raise ValidationError({"state": "Bad screen state."})
        if state.get("mode") == "tip" and state.get("request_id") != d.state.get("request_id"):
            d.tip_answer = {}   # a new tip question — forget the last answer
        d.state = state
        d.save()
    return Response(_display_json(d))


@api_view(["POST"])
@_soft_auth
def display_tip(request):
    """The customer answers the tip question on their screen: {request_id, choice: none|percent|custom, percent?, amount?}."""
    d, _ = DisplayState.objects.get_or_create(key=_display_key(request))
    st = d.state or {}
    if st.get("mode") != "tip" or request.data.get("request_id") != st.get("request_id"):
        raise ValidationError({"detail": "This tip question has ended."})
    base = Decimal(str(st.get("base") or "0"))
    choice = request.data.get("choice")
    settings_ = TipSettings.get()
    if choice == "none":
        tip, pct = Decimal("0.00"), None
    elif choice == "percent":
        pct = _percent(request.data.get("percent"))
        if float(pct) not in [float(x) for x in settings_.percents or []]:
            raise ValidationError({"percent": "Choose one of the tip options."})
        tip = money(base * pct / 100)
    elif choice == "custom" and settings_.allow_custom:
        try:
            tip, pct = money(Decimal(str(request.data.get("amount")))), None
        except (ArithmeticError, ValueError, TypeError):
            raise ValidationError({"amount": "Enter an amount."})
        if tip < 0 or tip > base:
            raise ValidationError({"amount": f"Enter a tip between $0 and ${base}."})
    else:
        raise ValidationError({"choice": "Choose a tip."})
    d.tip_answer = {"request_id": st.get("request_id"), "tip": str(tip), "percent": str(pct) if pct is not None else None,
                    "choice": choice, "at": timezone.now().isoformat()}
    d.state = {**st, "mode": "tip_done", "tip": str(tip)}
    d.save()
    return Response(_display_json(d))
