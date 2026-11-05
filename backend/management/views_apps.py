"""Back office: delivery apps (Uber Eats, DoorDash, Grubhub, … the admin adds more) and the tip prompt."""
import datetime
from decimal import Decimal, InvalidOperation

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from orders.models import DeliveryPartner, Order, TipSettings

from . import audit, reports
from .access import ADMIN, MANAGER, require, scope
from .views import mgmt_api

FIELDS = ["name", "emoji", "color", "commission_percent", "markup_percent", "collects_tax", "payout_schedule",
          "account_id", "notes", "is_active", "sort_order"]


def _json(p: DeliveryPartner) -> dict:
    return {
        "id": p.id, "name": p.name, "emoji": p.emoji, "color": p.color,
        "commission_percent": str(p.commission_percent), "markup_percent": str(p.markup_percent),
        "collects_tax": p.collects_tax, "payout_schedule": p.payout_schedule, "account_id": p.account_id,
        "notes": p.notes, "is_active": p.is_active, "sort_order": p.sort_order,
        "updated_by_name": (p.updated_by.get_full_name() or p.updated_by.username) if p.updated_by else None,
        "updated_at": p.updated_at,
    }


def _pct(v, field):
    try:
        d = Decimal(str(v if v not in (None, "") else 0)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValidationError({field: "Enter a number."})
    if d < 0 or d > 100:
        raise ValidationError({field: "Use 0–100%."})
    return d


def _apply(p: DeliveryPartner, data, user):
    for f in FIELDS:
        if f not in data:
            continue
        v = data[f]
        if f in ("commission_percent", "markup_percent"):
            v = _pct(v, f)
        elif f in ("collects_tax", "is_active"):
            v = v in (True, "true", "1", 1)
        elif f == "sort_order":
            v = int(v or 0)
        elif f == "color":
            v = str(v or "#111111").strip()
            if not (v.startswith("#") and len(v) in (4, 7) and all(c in "0123456789abcdefABCDEF" for c in v[1:])):
                raise ValidationError({"color": "Use a colour like #06C167."})
        else:
            v = str(v or "").strip()
        setattr(p, f, v)
    p.name = (p.name or "").strip()[:60]
    if not p.name:
        raise ValidationError({"name": "Enter the app's name."})
    if DeliveryPartner.objects.filter(name__iexact=p.name).exclude(pk=p.pk).exists():
        raise ValidationError({"name": f"{p.name} is already on the list."})
    p.updated_by = user
    p.save()


@mgmt_api(["GET", "POST"])
def delivery_apps(request):
    """GET: the apps (managers and above see them). POST: add one (admin only)."""
    a = request.actor
    if request.method == "POST":
        require(a, ADMIN, "add delivery apps")
        p = DeliveryPartner()
        _apply(p, request.data, request.user)
        audit.log(request.user, "created", "delivery app", p, summary=f"Added delivery app {p.name} ({p.commission_percent}% fee)")
        return Response(_json(p), status=201)
    require(a, MANAGER, "see delivery apps")
    return Response({"apps": [_json(p) for p in DeliveryPartner.objects.all()], "can_edit": a.level >= ADMIN})


@mgmt_api(["PATCH", "DELETE"])
def delivery_app_detail(request, pk: int):
    require(request.actor, ADMIN, "change delivery apps")
    p = get_object_or_404(DeliveryPartner, pk=pk)
    if request.method == "DELETE":
        if p.orders.exists():
            raise ValidationError({"detail": f"{p.name} has orders, so it can't be deleted — turn it off instead."})
        audit.log(request.user, "deleted", "delivery app", p, summary=f"Deleted delivery app {p.name}")
        p.delete()
        return Response(status=204)
    before = audit.snapshot(p, FIELDS)
    _apply(p, request.data, request.user)
    audit.log(request.user, "updated", "delivery app", p, changes=audit.diff(before, audit.snapshot(p, FIELDS)),
              summary=f"Changed delivery app {p.name}")
    return Response(_json(p))


@mgmt_api(["GET"])
def delivery_apps_report(request):
    """?from=&to=&branch= — orders, sales, app fees and expected payout per app and per store. Managers and above."""
    a = request.actor
    require(a, MANAGER, "see delivery app sales")
    start, end = reports.date_range(request.query_params)
    orders = scope(Order.objects.filter(partner__isnull=False), a, branch_param=request.query_params.get("branch"))
    sold = orders.filter(status__in=Order.SALE_STATUSES, created_at__date__gte=start, created_at__date__lte=end)
    refunded = orders.filter(status=Order.Status.REFUNDED, refunded_at__date__gte=start, refunded_at__date__lte=end)
    zero = Decimal("0")

    def block(qs):
        g = qs.aggregate(n=Count("id"), t_sales=Sum("total"), t_sub=Sum("subtotal"), t_tax=Sum("tax"),
                         t_fees=Sum("partner_commission"), t_app_tax=Sum("tax", filter=Q(partner_collects_tax=True)))
        total, fees, app_tax = g["t_sales"] or zero, g["t_fees"] or zero, g["t_app_tax"] or zero
        return {"orders": g["n"] or 0, "sales": reports.s(total), "food": reports.s(g["t_sub"] or zero),
                "tax": reports.s(g["t_tax"] or zero), "app_tax": reports.s(app_tax), "fees": reports.s(fees),
                "payout": reports.s(total - fees - app_tax),
                "average": reports.s(total / g["n"] if g["n"] else zero)}

    apps = []
    for p in DeliveryPartner.objects.all():
        b = block(sold.filter(partner=p))
        r = refunded.filter(partner=p).aggregate(n=Count("id"), t=Sum("total"))
        b.update(id=p.id, name=p.name, emoji=p.emoji, color=p.color, is_active=p.is_active,
                 commission_percent=str(p.commission_percent), refunds=r["n"] or 0, refunded=reports.s(r["t"] or zero))
        if b["orders"] or p.is_active:
            apps.append(b)
    stores = []
    for r in sold.values("branch_id", "branch__name").order_by("branch__name").distinct():
        b = block(sold.filter(branch_id=r["branch_id"]))
        b["name"] = r["branch__name"] or "—"
        stores.append(b)
    days = {}
    for r in (sold.values("created_at__date", "partner__name")
              .annotate(t=Sum("total"), n=Count("id"))):
        days.setdefault(r["created_at__date"].isoformat(), {})[r["partner__name"]] = {"total": reports.s(r["t"]), "orders": r["n"]}
    return Response({"from": start.isoformat(), "to": end.isoformat(), "total": block(sold),
                     "apps": apps, "stores": stores, "by_day": days})


@mgmt_api(["GET", "PUT"])
def tip_settings(request):
    """The tip question on the customer screen. Everyone in the back office sees it; only the admin changes it."""
    t = TipSettings.get()
    if request.method == "PUT":
        require(request.actor, ADMIN, "change tip settings")
        before = {"enabled": t.enabled, "percents": t.percents, "allow_custom": t.allow_custom}
        if "enabled" in request.data:
            t.enabled = request.data["enabled"] in (True, "true", 1)
        if "allow_custom" in request.data:
            t.allow_custom = request.data["allow_custom"] in (True, "true", 1)
        if "percents" in request.data:
            raw = request.data["percents"]
            if not isinstance(raw, list) or not 1 <= len(raw) <= 4:
                raise ValidationError({"percents": "Give 1 to 4 tip percentages."})
            vals = sorted({float(_pct(x, "percents")) for x in raw})
            if any(v <= 0 for v in vals):
                raise ValidationError({"percents": "Each tip option must be more than 0%."})
            t.percents = [int(v) if v == int(v) else v for v in vals]
        t.updated_by = request.user
        t.save()
        audit.log(request.user, "updated", "tip settings", t,
                  changes=audit.diff(before, {"enabled": t.enabled, "percents": t.percents, "allow_custom": t.allow_custom}),
                  summary=f"Tip options: {', '.join(f'{p}%' for p in t.percents)}{' + custom' if t.allow_custom else ''}"
                          f"{'' if t.enabled else ' (turned off)'}")
    return Response({"enabled": t.enabled, "percents": t.percents, "allow_custom": t.allow_custom,
                     "can_edit": request.actor.level >= ADMIN,
                     "updated_by_name": (t.updated_by.get_full_name() or t.updated_by.username) if t.updated_by else None,
                     "updated_at": t.updated_at})
