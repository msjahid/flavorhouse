"""Back office: monthly bills (utilities…) and delivery-app daily sales & payouts — all added role-wise.

Rules (both):
  * adding goes to the next role up for approval (manager → supervisor → super admin → admin; the admin's own apply directly);
  * editing is only for someone ranked ABOVE whoever submitted it, and that edit also goes one role up.
Bills: managers and above add & see. Delivery apps: supervisors and above.
"""
import datetime
import os
from decimal import Decimal, InvalidOperation

from django.core.files.base import File
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from orders.models import DeliveryPartner

from . import audit, changes, reports
from .access import ADMIN, MANAGER, SUPERVISOR, check_branch, level_of, require, scope
from .changes import LEVEL_NAME, handler
from .models import AppPayout, AppSalesDay, Bill, Branch, ChangeRequest
from .serializers import ChangeRequestSerializer
from .views import _ctx, jsonable, mgmt_api

Z = Decimal("0")


def _name(u):
    return (u.get_full_name() or u.username) if u else None


def _may_edit(actor, submitted_by) -> bool:
    """Only a higher rank than the person who submitted it (the admin always)."""
    return actor.level >= ADMIN or actor.level > (level_of(submitted_by) if submitted_by else 1)


def _pending(actor, kinds, branch=None):
    qs = ChangeRequest.objects.filter(kind__in=kinds, status="pending").select_related("submitted_by", "branch")
    out = [cr for cr in qs if cr.branch_id is None or actor.can_see(cr.branch_id)]
    if branch:
        out = [cr for cr in out if cr.branch_id == int(branch)]
    return ChangeRequestSerializer(out, many=True).data


def _cr(request, cr, code=200):
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data, status=code)


def _copy_file(obj, field, cr):
    if cr.file:
        getattr(obj, field).save(os.path.basename(cr.file.name), File(cr.file.open("rb")), save=False)


# =================================================================== monthly bills

BILL_FIELDS = ["branch", "category", "provider", "account_number", "bill_month", "period_start", "period_end", "due_date",
               "amount", "tax", "usage", "is_paid", "paid_on", "paid_with", "reference", "note"]


class BillSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    paid_with_display = serializers.CharField(source="get_paid_with_display", read_only=True)
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    submitted_level = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = BILL_FIELDS + ["id", "total", "category_display", "paid_with_display", "branch_name", "submitted_by_name", "submitted_level",
                                "approved_by_name", "file_url", "created_at", "updated_at"]
        read_only_fields = ["total", "created_at", "updated_at"]

    def get_submitted_by_name(self, o):
        return _name(o.submitted_by)

    def get_approved_by_name(self, o):
        return _name(o.approved_by)

    def get_submitted_level(self, o):
        return level_of(o.submitted_by) if o.submitted_by else 1

    def get_file_url(self, o):
        return o.file.url if o.file else None

    def validate(self, d):
        inst = self.instance
        g = lambda k: d.get(k, getattr(inst, k, None) if inst else None)  # noqa: E731
        if (g("amount") or Z) <= 0:
            raise serializers.ValidationError({"amount": "Enter the bill amount."})
        if (g("tax") or Z) < 0:
            raise serializers.ValidationError({"tax": "Tax can't be negative."})
        if not (g("provider") or "").strip():
            raise serializers.ValidationError({"provider": "Who is the bill from?"})
        if g("is_paid") and not g("paid_on"):
            raise serializers.ValidationError({"paid_on": "When was it paid?"})
        if "bill_month" in d and d["bill_month"]:
            d["bill_month"] = d["bill_month"].replace(day=1)
        return d


def _bill_apply(b: Bill, payload: dict):
    for f in BILL_FIELDS:
        if f not in payload:
            continue
        v = payload[f]
        if f == "branch":
            b.branch_id = v
        elif f in ("amount", "tax"):
            setattr(b, f, Decimal(str(v or 0)))
        elif f in ("bill_month", "period_start", "period_end", "due_date", "paid_on"):
            setattr(b, f, datetime.date.fromisoformat(v) if v else None)
        else:
            setattr(b, f, v)
    if not b.is_paid:
        b.paid_on, b.paid_with, b.reference = None, "", b.reference


@handler("bill.create", MANAGER, "monthly bill", "/manage/bills")
def bill_create(cr, approver):
    b = Bill(submitted_by=cr.submitted_by, approved_by=approver)
    _bill_apply(b, cr.payload)
    _copy_file(b, "file", cr)
    b.save()
    return b


@handler("bill.edit", SUPERVISOR, "monthly bill", "/manage/bills")
def bill_edit(cr, approver):
    b = Bill.objects.get(pk=cr.target_id)
    _bill_apply(b, cr.payload)
    _copy_file(b, "file", cr)
    b.save()
    return b


def _bill_label(d):
    month = d.get("bill_month")
    m = month.strftime("%b %Y") if hasattr(month, "strftime") else str(month or "")[:7]
    return f"{dict(Bill.Category.choices).get(d.get('category'), 'Bill')} · {d.get('provider', '')} · {m}"


@mgmt_api(["GET", "POST"])
def bills(request):
    """GET ?year=&branch=&category=&status=paid|unpaid → bills, waiting ones, month-by-month totals.
    POST (multipart ok) → add a bill; it goes to the next role up for approval."""
    a = request.actor
    require(a, MANAGER, "see monthly bills")
    if request.method == "POST":
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        for k in ("is_paid",):
            if k in data:
                data[k] = str(data[k]).lower() in ("true", "1", "yes", "on")
        s = BillSerializer(data=data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        br = v.get("branch")
        if br:
            check_branch(a, br.id)
        elif a.branch_ids is not None:
            raise ValidationError({"branch": "Choose your store."})
        dup = Bill.objects.filter(branch=br, category=v["category"], provider__iexact=v["provider"].strip(), bill_month=v["bill_month"])
        if dup.exists():
            raise ValidationError({"bill_month": f"{_bill_label(v)} is already recorded — ask a higher role to edit it."})
        cr = changes.submit(a, "bill.create", payload=jsonable(v), branch=br, file=request.FILES.get("file"),
                            summary=f"Bill: {_bill_label(v)} ${v['amount'] + (v.get('tax') or Z)}")
        return _cr(request, cr, 201)

    p = request.query_params
    year = int(p.get("year") or timezone.localdate().year)
    qs = _scope_bills(a, p.get("branch"))
    qs = qs.filter(bill_month__year=year)
    if c := p.get("category"):
        qs = qs.filter(category=c)
    if st := p.get("status"):
        qs = qs.filter(is_paid=(st == "paid"))
    months = {r["bill_month"].month: r for r in qs.values("bill_month").annotate(t=Sum("total"), tax=Sum("tax"), n=Count("id"))}
    by_cat = list(qs.values("category").annotate(t=Sum("total"), tax=Sum("tax"), n=Count("id")).order_by("-t"))
    grid = {}
    for r in qs.values("category", "bill_month").annotate(t=Sum("total")):
        grid.setdefault(r["category"], {})[r["bill_month"].month] = reports.s(r["t"])
    labels = dict(Bill.Category.choices)
    today = timezone.localdate()
    unpaid = qs.filter(is_paid=False).aggregate(t=Sum("total"), n=Count("id"))
    agg = qs.aggregate(t=Sum("total"), tax=Sum("tax"))
    return Response({
        "year": year,
        "items": BillSerializer(qs, many=True).data,
        "waiting": _pending(a, ["bill.create", "bill.edit"], p.get("branch")),
        "months": [{"month": m, "total": reports.s(months[m]["t"]) if m in months else "0.00",
                    "tax": reports.s(months[m]["tax"]) if m in months else "0.00", "count": months[m]["n"] if m in months else 0}
                   for m in range(1, 13)],
        "categories": [{"key": r["category"], "label": labels.get(r["category"], r["category"]), "total": reports.s(r["t"]),
                        "tax": reports.s(r["tax"]), "count": r["n"], "by_month": grid.get(r["category"], {})} for r in by_cat],
        "total": reports.s(agg["t"]), "tax": reports.s(agg["tax"]),
        "this_month": reports.s(qs.filter(bill_month=today.replace(day=1)).aggregate(t=Sum("total"))["t"]),
        "unpaid": {"count": unpaid["n"] or 0, "total": reports.s(unpaid["t"])},
        "category_choices": [{"value": k, "label": l} for k, l in Bill.Category.choices],
        "paid_with_choices": [{"value": k, "label": l} for k, l in Bill.PaidWith.choices],
        "can_edit": a.level >= SUPERVISOR,
        "my_level": a.level,
    })


def _scope_bills(a, branch):
    qs = Bill.objects.select_related("branch", "submitted_by", "approved_by")
    if branch:
        check_branch(a, branch)
        return qs.filter(branch_id=branch)
    if a.branch_ids is None:
        return qs
    return qs.filter(branch_id__in=a.branch_ids)


@mgmt_api(["PATCH"])
def bill_detail(request, pk):
    """Edit a bill (supervisor and up, and only above whoever added it). Goes one role up for approval."""
    a = request.actor
    require(a, SUPERVISOR, "edit monthly bills")
    b = get_object_or_404(Bill, pk=pk)
    if b.branch_id:
        check_branch(a, b.branch_id)
    if not _may_edit(a, b.submitted_by):
        raise PermissionDenied(f"Only someone above {LEVEL_NAME.get(level_of(b.submitted_by), 'the person who added it')} can edit this bill.")
    data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
    if "is_paid" in data:
        data["is_paid"] = str(data["is_paid"]).lower() in ("true", "1", "yes", "on")
    s = BillSerializer(b, data=data, partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable({k: v for k, v in s.validated_data.items()})
    if not payload and not request.FILES.get("file"):
        raise ValidationError({"detail": "Nothing changed."})
    reason = str(request.data.get("change_reason") or "").strip()
    if not reason:
        raise ValidationError({"change_reason": "Say why you're changing it."})
    cr = changes.submit(a, "bill.edit", target=b, branch=b.branch_id, payload=payload, file=request.FILES.get("file"),
                        before=audit.snapshot(b, [k if k != "branch" else "branch_id" for k in payload]),
                        reason=reason, summary=f"Edit bill: {b.get_category_display()} · {b.provider} · {b.bill_month:%b %Y}")
    return _cr(request, cr)


def bills_total(start, end, branch_filter: dict | None = None) -> tuple[Decimal, Decimal]:
    """(total, tax) of bills for months that fall in [start, end] — used by Profit & loss and Sales tax."""
    qs = Bill.objects.filter(bill_month__gte=start.replace(day=1), bill_month__lte=end)
    if branch_filter is not None:
        qs = qs.filter(**branch_filter)
    g = qs.aggregate(t=Sum("total"), tax=Sum("tax"))
    return g["t"] or Z, g["tax"] or Z


# =================================================================== delivery apps: daily sales & money received

def _dec(v, field, allow_zero=True):
    try:
        d = Decimal(str(v if v not in (None, "") else 0)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValidationError({field: "Enter an amount."})
    if d < 0 or (not allow_zero and d == 0):
        raise ValidationError({field: "Enter an amount above 0." if not allow_zero else "Can't be negative."})
    return d


def _date(v, field):
    try:
        return datetime.date.fromisoformat(str(v)) if v else None
    except ValueError:
        raise ValidationError({field: "Use YYYY-MM-DD."})


def _day_payload(a, data, inst=None):
    g = lambda k: data.get(k) if k in data else (getattr(inst, k, None) if inst else None)  # noqa: E731
    partner_id = g("partner") if "partner" in data else (inst.partner_id if inst else None)
    branch_id = g("branch") if "branch" in data else (inst.branch_id if inst else None)
    if not partner_id or not DeliveryPartner.objects.filter(pk=partner_id).exists():
        raise ValidationError({"partner": "Choose the app."})
    if not branch_id:
        raise ValidationError({"branch": "Choose the store."})
    check_branch(a, branch_id)
    day = _date(g("date"), "date")
    if not day:
        raise ValidationError({"date": "Which day?"})
    if day > timezone.localdate():
        raise ValidationError({"date": "That day hasn't happened yet."})
    out = {"partner": int(partner_id), "branch": int(branch_id), "date": day.isoformat(),
           "orders": int(g("orders") or 0), "sales": str(_dec(g("sales"), "sales", allow_zero=False)),
           "tax": str(_dec(g("tax"), "tax")), "fees": str(_dec(g("fees"), "fees")),
           "adjustments": str(_dec(g("adjustments"), "adjustments")),
           "tax_by_app": str(g("tax_by_app")).lower() in ("true", "1", "yes", "on") if g("tax_by_app") is not None else True,
           "note": str(g("note") or "")[:255]}
    if out["orders"] < 0:
        raise ValidationError({"orders": "Can't be negative."})
    return out


def _payout_payload(a, data, inst=None):
    g = lambda k: data.get(k) if k in data else (getattr(inst, k, None) if inst else None)  # noqa: E731
    partner_id = data.get("partner") or (inst.partner_id if inst else None)
    branch_id = data.get("branch") or (inst.branch_id if inst else None)
    if not partner_id or not DeliveryPartner.objects.filter(pk=partner_id).exists():
        raise ValidationError({"partner": "Choose the app."})
    if not branch_id:
        raise ValidationError({"branch": "Choose the store."})
    check_branch(a, branch_id)
    got = _date(g("received_on"), "received_on")
    if not got:
        raise ValidationError({"received_on": "When did the money arrive?"})
    f, t = _date(g("covers_from"), "covers_from"), _date(g("covers_to"), "covers_to")
    if f and t and t < f:
        raise ValidationError({"covers_to": "The end is before the start."})
    return {"partner": int(partner_id), "branch": int(branch_id), "received_on": got.isoformat(),
            "amount": str(_dec(g("amount"), "amount", allow_zero=False)),
            "covers_from": f.isoformat() if f else None, "covers_to": t.isoformat() if t else None,
            "reference": str(g("reference") or "")[:60], "note": str(g("note") or "")[:255]}


def _apply_fields(obj, payload, dates=()):
    for k, v in payload.items():
        if k in ("partner", "branch"):
            setattr(obj, f"{k}_id", v)
        elif k in dates:
            setattr(obj, k, datetime.date.fromisoformat(v) if v else None)
        elif k in ("sales", "tax", "fees", "adjustments", "amount"):
            setattr(obj, k, Decimal(v))
        else:
            setattr(obj, k, v)


@handler("appday.create", SUPERVISOR, "delivery app day", "/manage/delivery-apps")
def appday_create(cr, approver):
    d = AppSalesDay.objects.filter(partner_id=cr.payload["partner"], branch_id=cr.payload["branch"], date=cr.payload["date"]).first()
    if d:
        raise ValidationError({"detail": "That day was already recorded meanwhile — edit it instead."})
    d = AppSalesDay(submitted_by=cr.submitted_by, approved_by=approver)
    _apply_fields(d, cr.payload, dates=("date",))
    d.save()
    return d


@handler("appday.edit", SUPERVISOR, "delivery app day", "/manage/delivery-apps")
def appday_edit(cr, approver):
    d = AppSalesDay.objects.get(pk=cr.target_id)
    _apply_fields(d, cr.payload, dates=("date",))
    d.approved_by = approver
    d.save()
    return d


@handler("apppayout.create", SUPERVISOR, "delivery app payout", "/manage/delivery-apps")
def apppayout_create(cr, approver):
    p = AppPayout(submitted_by=cr.submitted_by, approved_by=approver)
    _apply_fields(p, cr.payload, dates=("received_on", "covers_from", "covers_to"))
    p.save()
    return p


@handler("apppayout.edit", SUPERVISOR, "delivery app payout", "/manage/delivery-apps")
def apppayout_edit(cr, approver):
    p = AppPayout.objects.get(pk=cr.target_id)
    _apply_fields(p, cr.payload, dates=("received_on", "covers_from", "covers_to"))
    p.approved_by = approver
    p.save()
    return p


def _day_json(d: AppSalesDay):
    return {"id": d.id, "partner": d.partner_id, "partner_name": d.partner.name, "color": d.partner.color, "emoji": d.partner.emoji,
            "branch": d.branch_id, "branch_name": d.branch.name, "date": d.date.isoformat(), "orders": d.orders,
            "sales": str(d.sales), "tax": str(d.tax), "with_tax": str(d.sales + d.tax), "fees": str(d.fees),
            "adjustments": str(d.adjustments), "tax_by_app": d.tax_by_app, "expected": str(d.expected), "note": d.note,
            "submitted_by_name": _name(d.submitted_by), "approved_by_name": _name(d.approved_by),
            "submitted_level": level_of(d.submitted_by) if d.submitted_by else 1}


def _payout_json(p: AppPayout):
    return {"id": p.id, "partner": p.partner_id, "partner_name": p.partner.name, "color": p.partner.color, "emoji": p.partner.emoji,
            "branch": p.branch_id, "branch_name": p.branch.name, "received_on": p.received_on.isoformat(),
            "amount": str(p.amount), "covers_from": p.covers_from.isoformat() if p.covers_from else None,
            "covers_to": p.covers_to.isoformat() if p.covers_to else None, "reference": p.reference, "note": p.note,
            "submitted_by_name": _name(p.submitted_by), "approved_by_name": _name(p.approved_by),
            "submitted_level": level_of(p.submitted_by) if p.submitted_by else 1}


def _app_scope(a, model, branch):
    qs = model.objects.select_related("partner", "branch", "submitted_by", "approved_by")
    if branch:
        check_branch(a, branch)
        return qs.filter(branch_id=branch)
    return qs if a.branch_ids is None else qs.filter(branch_id__in=a.branch_ids)


@mgmt_api(["GET"])
def app_ledger(request):
    """?from&to&branch&partner — daily sales & tax per app, money received, and what's still owed. Supervisors and up."""
    a = request.actor
    require(a, SUPERVISOR, "see delivery app sales")
    start, end = reports.date_range(request.query_params)
    p = request.query_params
    days = _app_scope(a, AppSalesDay, p.get("branch")).filter(date__gte=start, date__lte=end)
    pays = _app_scope(a, AppPayout, p.get("branch")).filter(received_on__gte=start, received_on__lte=end)
    if pid := p.get("partner"):
        days, pays = days.filter(partner_id=pid), pays.filter(partner_id=pid)

    def sums(dq, pq):
        g = dq.aggregate(n=Sum("orders"), s=Sum("sales"), t=Sum("tax"), f=Sum("fees"), adj=Sum("adjustments"),
                         app_t=Sum("tax", filter=Q(tax_by_app=True)), days=Count("id"))
        expected = (g["s"] or Z) + (g["t"] or Z) - (g["app_t"] or Z) - (g["f"] or Z) - (g["adj"] or Z)
        received = pq.aggregate(t=Sum("amount"))["t"] or Z
        return {"days": g["days"] or 0, "orders": g["n"] or 0, "sales": reports.s(g["s"]), "tax": reports.s(g["t"]),
                "with_tax": reports.s((g["s"] or Z) + (g["t"] or Z)), "app_tax": reports.s(g["app_t"]),
                "fees": reports.s(g["f"]), "adjustments": reports.s(g["adj"]), "expected": reports.s(expected),
                "received": reports.s(received), "balance": reports.s(expected - received)}

    apps = []
    for partner in DeliveryPartner.objects.all():
        b = sums(days.filter(partner=partner), pays.filter(partner=partner))
        if partner.is_active or b["days"] or Decimal(b["received"]):
            apps.append({**b, "id": partner.id, "name": partner.name, "emoji": partner.emoji, "color": partner.color,
                         "is_active": partner.is_active})
    # Day by day (all apps side by side)
    by_day = {}
    for d in days.order_by("-date"):
        row = by_day.setdefault(d.date.isoformat(), {"date": d.date.isoformat(), "sales": Z, "tax": Z, "orders": 0, "apps": []})
        row["sales"] += d.sales
        row["tax"] += d.tax
        row["orders"] += d.orders
        row["apps"].append(_day_json(d))
    daily = [{**r, "sales": reports.s(r["sales"]), "tax": reports.s(r["tax"]), "with_tax": reports.s(r["sales"] + r["tax"])}
             for r in by_day.values()]
    return Response({
        "from": start.isoformat(), "to": end.isoformat(), "total": sums(days, pays), "apps": apps, "daily": daily,
        "payouts": [_payout_json(x) for x in pays.order_by("-received_on", "-id")],
        "waiting": _pending(a, ["appday.create", "appday.edit", "apppayout.create", "apppayout.edit"], p.get("branch")),
        "my_level": a.level,
    })


@mgmt_api(["POST"])
def app_days(request):
    a = request.actor
    require(a, SUPERVISOR, "record delivery app sales")
    payload = _day_payload(a, request.data)
    if AppSalesDay.objects.filter(partner_id=payload["partner"], branch_id=payload["branch"], date=payload["date"]).exists():
        raise ValidationError({"date": "This app's sales for that day are already recorded — a higher role can edit them."})
    if ChangeRequest.objects.filter(kind="appday.create", status="pending", payload__partner=payload["partner"],
                                    payload__branch=payload["branch"], payload__date=payload["date"]).exists():
        raise ValidationError({"date": "That day is already waiting for approval."})
    name = DeliveryPartner.objects.get(pk=payload["partner"]).name
    cr = changes.submit(a, "appday.create", payload=payload, branch=payload["branch"],
                        summary=f"{name} sales {payload['date']}: ${payload['sales']} + tax ${payload['tax']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def app_day_detail(request, pk):
    a = request.actor
    require(a, SUPERVISOR, "edit delivery app sales")
    d = get_object_or_404(AppSalesDay, pk=pk)
    check_branch(a, d.branch_id)
    if not _may_edit(a, d.submitted_by):
        raise PermissionDenied("Only a higher role than whoever recorded it can edit this.")
    reason = str(request.data.get("change_reason") or "").strip()
    if not reason:
        raise ValidationError({"change_reason": "Say why you're changing it."})
    payload = _day_payload(a, request.data, inst=d)
    payload.pop("partner"), payload.pop("branch")
    cr = changes.submit(a, "appday.edit", target=d, branch=d.branch_id, payload=payload, reason=reason,
                        before=_day_json(d), summary=f"Edit {d.partner.name} sales {d.date}")
    return _cr(request, cr)


@mgmt_api(["POST"])
def app_payouts(request):
    a = request.actor
    require(a, SUPERVISOR, "record money received from delivery apps")
    payload = _payout_payload(a, request.data)
    name = DeliveryPartner.objects.get(pk=payload["partner"]).name
    cr = changes.submit(a, "apppayout.create", payload=payload, branch=payload["branch"],
                        summary=f"{name} paid ${payload['amount']} on {payload['received_on']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def app_payout_detail(request, pk):
    a = request.actor
    require(a, SUPERVISOR, "edit delivery app payouts")
    p = get_object_or_404(AppPayout, pk=pk)
    check_branch(a, p.branch_id)
    if not _may_edit(a, p.submitted_by):
        raise PermissionDenied("Only a higher role than whoever recorded it can edit this.")
    reason = str(request.data.get("change_reason") or "").strip()
    if not reason:
        raise ValidationError({"change_reason": "Say why you're changing it."})
    payload = _payout_payload(a, request.data, inst=p)
    payload.pop("partner"), payload.pop("branch")
    cr = changes.submit(a, "apppayout.edit", target=p, branch=p.branch_id, payload=payload, reason=reason,
                        before=_payout_json(p), summary=f"Edit {p.partner.name} payout {p.received_on}")
    return _cr(request, cr)


def app_days_total(start, end, branch_filter: dict | None = None) -> dict:
    """Approved delivery-app days in [start, end] — for Profit & loss and Sales tax."""
    qs = AppSalesDay.objects.filter(date__gte=start, date__lte=end)
    if branch_filter is not None:
        qs = qs.filter(**branch_filter)
    g = qs.aggregate(s=Sum("sales"), t=Sum("tax"), f=Sum("fees"), adj=Sum("adjustments"),
                     app_t=Sum("tax", filter=Q(tax_by_app=True)), n=Sum("orders"))
    return {k: (g[k] or (0 if k == "n" else Z)) for k in g}


# =================================================================== sales by employee (who sold, discounts, refunds)

ROLE_LABEL = {"employee": "Employee", "manager": "Manager", "supervisor": "Supervisor", "superadmin": "Super admin", "admin": "Admin"}


@mgmt_api(["GET"])
def staff_sales(request):
    """?period|from&to&branch&seller=<user id>|web&role=&payment=&channel=&discounted=1&refunded=1
    Every transaction with who rang it up and the discount, plus totals per employee and per role. Managers and up."""
    from orders.models import Order
    a = request.actor
    require(a, MANAGER, "see sales by employee")
    p = request.query_params
    start, end = reports.date_range(p)
    base = scope(Order.objects.exclude(status__in=["pending", "cancelled", "unpaid"]), a, branch_param=p.get("branch"))
    qs = base.filter(created_at__date__gte=start, created_at__date__lte=end)
    if seller := p.get("seller"):
        qs = qs.filter(created_by__isnull=True) if seller == "web" else qs.filter(created_by_id=seller)
    if role := p.get("role"):
        qs = qs.filter(created_by__staff__role=role)
    if pay := p.get("payment"):
        qs = qs.filter(payment_method=pay)
    if ch := p.get("channel"):
        qs = qs.filter(source=ch)
    if p.get("discounted") == "1":
        qs = qs.filter(Q(discount_amount__gt=0) | Q(promo_discount__gt=0))
    if p.get("refunded") == "1":
        qs = qs.filter(status="refunded")
    sold = qs.exclude(status="refunded")
    refunded = qs.filter(status="refunded")

    people = {}
    for r in qs.values("created_by", "created_by__first_name", "created_by__last_name", "created_by__username",
                       "created_by__staff__employee_id", "created_by__staff__role").annotate(
            n=Count("id", filter=~Q(status="refunded")), sales=Sum("total", filter=~Q(status="refunded")),
            tax=Sum("tax", filter=~Q(status="refunded")), disc_n=Count("id", filter=Q(discount_amount__gt=0)),
            disc=Sum("discount_amount"), promo=Sum("promo_discount"), tips=Sum("tip", filter=~Q(status="refunded")),
            ref_n=Count("id", filter=Q(status="refunded")), ref=Sum("total", filter=Q(status="refunded"))):
        uid = r["created_by"]
        name = (f"{r['created_by__first_name']} {r['created_by__last_name']}".strip() or r["created_by__username"]) if uid else "Website / online (no cashier)"
        n = r["n"] or 0
        people[uid or "web"] = {
            "id": uid or "web", "name": name, "employee_id": r["created_by__staff__employee_id"] or ("" if uid else "WEB"),
            "role": r["created_by__staff__role"] or ("" if uid else "online"),
            "role_display": ROLE_LABEL.get(r["created_by__staff__role"], "Online" if not uid else "—"),
            "orders": n, "sales": reports.s(r["sales"]), "tax": reports.s(r["tax"]),
            "average": reports.s((r["sales"] or Z) / n if n else Z),
            "discounts": r["disc_n"] or 0, "discount_amount": reports.s(r["disc"]), "offers_amount": reports.s(r["promo"]),
            "tips": reports.s(r["tips"]), "refunds": r["ref_n"] or 0, "refund_amount": reports.s(r["ref"]),
        }
    # Refunds & discounts each person APPROVED (managers and up)
    for r in qs.filter(status="refunded", refunded_by__isnull=False).values("refunded_by").annotate(n=Count("id"), t=Sum("total")):
        if r["refunded_by"] in people:
            people[r["refunded_by"]].update(refunds_approved=r["n"], refunds_approved_amount=reports.s(r["t"]))
    for r in qs.filter(discount_approved_by__isnull=False).values("discount_approved_by").annotate(n=Count("id"), t=Sum("discount_amount")):
        if r["discount_approved_by"] in people:
            people[r["discount_approved_by"]].update(discounts_approved=r["n"], discounts_approved_amount=reports.s(r["t"]))
    by_employee = sorted(people.values(), key=lambda x: -Decimal(x["sales"]))

    roles = {}
    for x in by_employee:
        k = x["role"] or "online"
        g = roles.setdefault(k, {"role": k, "label": x["role_display"], "people": 0, "orders": 0, "sales": Z, "discounts": 0,
                                 "discount_amount": Z, "refunds": 0, "refund_amount": Z})
        g["people"] += 1
        g["orders"] += x["orders"]
        g["discounts"] += x["discounts"]
        g["refunds"] += x["refunds"]
        for f in ("sales", "discount_amount", "refund_amount"):
            g[f] += Decimal(x[f])
    order = ["employee", "manager", "supervisor", "superadmin", "admin", "online"]
    by_role = [{**g, "sales": reports.s(g["sales"]), "discount_amount": reports.s(g["discount_amount"]),
                "refund_amount": reports.s(g["refund_amount"]),
                "discount_rate": str((g["discount_amount"] / g["sales"] * 100).quantize(Decimal("0.1"))) if g["sales"] else "0.0"}
               for g in sorted(roles.values(), key=lambda g: order.index(g["role"]) if g["role"] in order else 99)]

    rows = []
    for o in qs.select_related("created_by__staff", "branch", "discount_approved_by", "refunded_by").order_by("-created_at")[:1500]:
        st = getattr(o.created_by, "staff", None) if o.created_by else None
        rows.append({
            "id": o.id, "number": o.number, "created_at": o.created_at, "branch_name": o.branch.name if o.branch else "—",
            "seller": _name(o.created_by) or "Website", "employee_id": st.employee_id if st else "",
            "role_display": ROLE_LABEL.get(st.role, "—") if st else "Online", "source": o.source, "source_display": o.get_source_display(),
            "payment_display": o.get_payment_method_display(), "customer": o.customer_name,
            "subtotal": str(o.subtotal), "discount_percent": str(o.discount_percent), "discount_amount": str(o.discount_amount),
            "discount_reason": o.discount_reason, "discount_approved_by": _name(o.discount_approved_by),
            "offers": str(o.promo_discount), "tax": str(o.tax), "total": str(o.total), "tip": str(o.tip),
            "status": o.status, "status_display": o.get_status_display(), "refunded_by": _name(o.refunded_by),
            "refund_reason": o.refund_reason,
        })
    sg = sold.aggregate(n=Count("id"), t=Sum("total"), tax=Sum("tax"), d=Sum("discount_amount"), pr=Sum("promo_discount"),
                        dn=Count("id", filter=Q(discount_amount__gt=0)))
    rg = refunded.aggregate(n=Count("id"), t=Sum("total"))
    sellers = [{"value": str(x["id"]), "label": f"{x['name']}{' · ' + x['employee_id'] if x['employee_id'] and x['id'] != 'web' else ''}"}
               for x in by_employee]
    return Response({
        "from": start.isoformat(), "to": end.isoformat(),
        "total": {"orders": sg["n"] or 0, "sales": reports.s(sg["t"]), "tax": reports.s(sg["tax"]),
                  "discounts": sg["dn"] or 0, "discount_amount": reports.s(sg["d"]), "offers_amount": reports.s(sg["pr"]),
                  "refunds": rg["n"] or 0, "refund_amount": reports.s(rg["t"])},
        "by_employee": by_employee, "by_role": by_role, "rows": rows, "rows_capped": qs.count() > 1500, "sellers": sellers,
    })
