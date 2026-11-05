"""Back office (part 3): customers, salary weeks (paid / unpaid), owners' draws & profit split."""
import csv
import datetime
from decimal import Decimal

from django.db.models import Count, Max, Min, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from orders.models import Customer, Order, OrderItem
from pos.serializers import PosOrderSerializer

from . import audit
from .access import ADMIN, MANAGER, require, scope
from .changes import LEVEL_NAME
from .views import mgmt_api

DONE = [Order.Status.PENDING, Order.Status.CANCELLED, Order.Status.REFUNDED]


# =================================================================== customers

def _customer_orders(a, request):
    qs = Order.objects.filter(customer__isnull=False).exclude(status=Order.Status.PENDING)
    return scope(qs, a, branch_param=request.query_params.get("branch"))


def _customer_row(c: Customer, stats: dict) -> dict:
    return {
        "id": c.id, "name": c.name, "email": c.email, "phone": c.phone, "notes": c.notes,
        "orders": stats.get("orders", 0), "spent": str(stats.get("spent") or Decimal("0.00")),
        "first_order": stats.get("first"), "last_order": stats.get("last"),
        "edited_by_name": c.edited_by.get_full_name() or c.edited_by.username if c.edited_by else None,
        "updated_at": c.updated_at,
    }


@mgmt_api(["GET"])
def customers(request):
    """Customers who ordered at my stores, A–Z. ?q=&letter=&sort=name|spent|recent|orders&branch=&export=csv"""
    a = request.actor
    require(a, MANAGER, "see customers")
    p = request.query_params
    orders = _customer_orders(a, request)
    stats = {r["customer"]: r for r in orders.values("customer").annotate(
        orders=Count("id"), spent=Sum("total", filter=~Q(status__in=DONE)), first=Min("created_at"), last=Max("created_at"))}
    qs = Customer.objects.filter(pk__in=stats.keys()).select_related("edited_by")
    if q := p.get("q", "").strip():
        qs = qs.filter(Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q))
    if letter := p.get("letter", "").strip():
        qs = qs.filter(name__regex=r"^[^A-Za-z]") if letter == "#" else qs.filter(name__istartswith=letter[:1])
    rows = [_customer_row(c, stats[c.pk]) for c in qs]
    sort = p.get("sort", "name")
    if sort == "spent":
        rows.sort(key=lambda r: Decimal(r["spent"]), reverse=True)
    elif sort == "recent":
        rows.sort(key=lambda r: r["last_order"] or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc), reverse=True)
    elif sort == "orders":
        rows.sort(key=lambda r: r["orders"], reverse=True)
    else:
        rows.sort(key=lambda r: ((r["name"] or r["email"] or r["phone"] or "~").lower()))
    if p.get("export") == "csv":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="customers.csv"'
        w = csv.writer(resp)
        w.writerow(["Name", "Email", "Phone", "Orders", "Total spent", "First order", "Last order", "Notes"])
        for r in rows:
            w.writerow([r["name"], r["email"], r["phone"], r["orders"], r["spent"],
                        r["first_order"].date() if r["first_order"] else "", r["last_order"].date() if r["last_order"] else "", r["notes"]])
        return resp
    return Response({"count": len(rows), "can_edit": a.level >= ADMIN, "items": rows})


@mgmt_api(["GET", "PATCH"])
def customer_detail(request, pk):
    """GET: the customer, their orders and everything they bought (A–Z). PATCH: admin only."""
    a = request.actor
    require(a, MANAGER, "see customers")
    c = get_object_or_404(Customer.objects.select_related("edited_by"), pk=pk)
    orders = _customer_orders(a, request).filter(customer=c)
    if not orders.exists() and a.level < ADMIN:
        raise PermissionDenied("This customer hasn't ordered at your stores.")
    if request.method == "PATCH":
        if a.level < ADMIN:
            raise PermissionDenied("Only the admin can edit customers.")
        fields = ["name", "email", "phone", "notes"]
        before = audit.snapshot(c, fields)
        for f in fields:
            if f in request.data:
                setattr(c, f, str(request.data.get(f) or "").strip()[:255 if f != "notes" else 5000])
        if c.email and Customer.objects.filter(email=c.email.lower()).exclude(pk=c.pk).exists():
            raise ValidationError({"email": "Another customer already uses this email."})
        c.edited_by = request.user
        c.save()
        ch = audit.diff(before, audit.snapshot(c, fields))
        if ch:
            audit.log(request.user, "updated", "customer", c, branch=None, summary=f"Updated customer {c}", changes=ch)
    stats = orders.aggregate(orders=Count("id"), spent=Sum("total", filter=~Q(status__in=DONE)),
                             first=Min("created_at"), last=Max("created_at"))
    items = (OrderItem.objects.filter(order__in=orders.exclude(status__in=DONE))
             .values("name").annotate(quantity=Sum("quantity"), spent=Sum("line_total"), last=Max("order__created_at"))
             .order_by("name"))
    return Response({
        **_customer_row(c, stats),
        "items": [{"name": i["name"], "quantity": i["quantity"], "spent": str(i["spent"]), "last": i["last"]} for i in items],
        "order_list": PosOrderSerializer(orders.select_related("branch", "created_by").prefetch_related("items")
                                         .order_by("-created_at")[:200], many=True).data,
        "can_edit": a.level >= ADMIN,
    })


# =================================================================== salary weeks (running week, history, paid / unpaid)

from django.db.models import Q as _Q  # noqa: E402
from django.utils import timezone  # noqa: E402

from . import changes, reports  # noqa: E402
from .models import ChangeRequest, Owner, OwnerDraw, PaySettings, PayStatement, StaffProfile, TimeEntry  # noqa: E402
from .serializers import ChangeRequestSerializer  # noqa: E402
from .views import _can_manage, _ctx, _staff_scope  # noqa: E402

MAX_WEEKS = 26


PAY_METHODS = {"cash": "Cash", "check": "Check", "direct_deposit": "Direct deposit"}


def _paid_in(stmts, start, end, gross: Decimal):
    """Paid amount and parts for a period from the records inside it (or one record covering it).
    Works when the pay frequency changes: two weekly records add up inside a 2-week period."""
    inside = [s for s in stmts if s.period_start >= start and s.period_end <= end]
    covering = [s for s in stmts if s.period_start <= start and s.period_end >= end and s not in inside]
    paid, parts, dates = Decimal("0"), [], []
    for s in inside:
        paid += s.paid_amount
        parts += s.payments
        if s.paid_on:
            dates.append(s.paid_on)
    for s in covering:
        if s.gross_pay and s.paid_amount:
            share = (s.paid_amount * gross / s.gross_pay).quantize(Decimal("0.01")) if s.gross_pay > gross else s.paid_amount
            paid += min(share, gross)
            parts += [{**x, "amount": str((Decimal(x["amount"]) * share / s.paid_amount).quantize(Decimal("0.01")))} for x in s.payments]
            if s.paid_on:
                dates.append(s.paid_on)
    return paid, parts, max(dates) if dates else None, inside


def salary_weeks(profiles, count: int) -> dict[int, list[dict]]:
    """For each person: the running pay period and past periods with paid / partly paid / unpaid.
    Periods follow Pay settings (every week or every 2 weeks); overtime is still worked out per Mon–Sun week."""
    profiles = list(profiles)
    cfg = PaySettings.get()
    today = timezone.localdate()
    cur, _ = cfg.period_of(today)
    periods = [(cur - datetime.timedelta(days=cfg.days * i), cur - datetime.timedelta(days=cfg.days * i) + datetime.timedelta(days=cfg.days - 1))
               for i in range(count)]
    ids = [p.id for p in profiles]
    oldest = periods[-1][0]
    stmts_by = {}
    for st in PayStatement.objects.filter(staff_id__in=ids, period_end__gte=oldest):
        stmts_by.setdefault(st.staff_id, []).append(st)
    pending = {}
    for cr in ChangeRequest.objects.filter(kind="pay.mark", status="pending"):
        pending[(cr.payload.get("staff"), cr.payload.get("from"))] = cr
    entries = TimeEntry.objects.filter(staff_id__in=ids)
    out = {p.id: [] for p in profiles}
    for start, end in periods:
        for r in reports.payroll(entries, profiles, start, end):
            p = next(x for x in profiles if x.id == r["staff_id"])
            stmts = stmts_by.get(p.id, [])
            running = start == cur
            gross = Decimal(r["gross_pay"])
            paid, parts, paid_on, inside = _paid_in(stmts, start, end, gross)
            if p.hire_date and end < p.hire_date and Decimal(r["hours"]) <= 0 and not inside:
                continue
            if not running and gross <= 0 and Decimal(r["tips"]) <= 0 and not inside:
                continue
            status = "running" if running else ("paid" if paid > 0 and paid >= gross else "partial" if paid > 0 else "unpaid")
            cr = pending.get((p.id, start.isoformat()))
            out[p.id].append({
                "from": start.isoformat(), "to": end.isoformat(), "running": running,
                "hours": r["hours"], "regular_hours": r["regular_hours"], "overtime_hours": r["overtime_hours"],
                "tips": r["tips"], "gross_pay": r["gross_pay"], "paid_amount": reports.s(paid),
                "balance": reports.s(max(Decimal("0"), gross - paid)),
                "status": status, "paid_on": paid_on.isoformat() if paid_on else None,
                "payments": [{"method": x.get("method"), "method_display": PAY_METHODS.get(x.get("method"), x.get("method")),
                              "amount": x.get("amount"), "reference": x.get("reference", "")} for x in parts],
                "pay_method": " + ".join(sorted({PAY_METHODS.get(x.get("method"), "") for x in parts})) or p.get_pay_method_display(),
                "reference": ", ".join(x.get("reference") for x in parts if x.get("reference")),
                "statement_id": inside[0].id if len(inside) == 1 else None,
                "pending": {"id": cr.id, "paid": cr.payload.get("paid"), "need_role": LEVEL_NAME.get(cr.need_level, "")} if cr else None,
            })
    return out


@mgmt_api(["GET", "POST"])
def pay_settings(request):
    """GET: pay frequency. POST (admin): change it."""
    cfg = PaySettings.get()
    if request.method == "POST":
        require(request.actor, ADMIN, "change the pay frequency")
        f = request.data.get("frequency")
        if f not in dict(PaySettings.FREQUENCIES):
            raise ValidationError({"frequency": "Choose every week or every 2 weeks."})
        try:
            anchor = datetime.date.fromisoformat(str(request.data.get("anchor") or cfg.anchor))
        except ValueError:
            raise ValidationError({"anchor": "Pick the first day of a pay period."})
        before = {"frequency": cfg.frequency, "anchor": cfg.anchor.isoformat()}
        cfg.frequency, cfg.anchor = f, anchor - datetime.timedelta(days=anchor.weekday())
        cfg.updated_by = request.user
        cfg.save()
        audit.log(request.user, "updated", "pay settings", cfg, branch=None, summary=f"Pay frequency: {cfg.get_frequency_display()}",
                  changes=audit.diff(before, {"frequency": cfg.frequency, "anchor": cfg.anchor.isoformat()}))
    start, end = cfg.period_of(timezone.localdate())
    return Response({"frequency": cfg.frequency, "frequency_display": cfg.get_frequency_display(), "anchor": cfg.anchor.isoformat(),
                     "days": cfg.days, "current": {"from": start.isoformat(), "to": end.isoformat()}})


@mgmt_api(["GET"])
def salary(request):
    """Everyone I manage (and me): running pay period + past periods with paid / unpaid. ?weeks=8 (periods)&branch=&staff="""
    a = request.actor
    require(a, MANAGER, "see wages")
    p = request.query_params
    count = min(MAX_WEEKS, max(1, int(p.get("weeks") or 8)))
    profiles = _staff_scope(a).exclude(status__in=["pending", "rejected"])
    if b := p.get("branch"):
        profiles = scope(profiles, a, branch_param=b)
    if sid := p.get("staff"):
        profiles = profiles.filter(pk=sid)
    data = salary_weeks(profiles, count)
    rows = []
    for prof in profiles:
        wk = data[prof.id]
        owed = [w for w in wk if w["status"] in ("unpaid", "partial")]
        rows.append({
            "staff_id": prof.id, "employee_id": prof.employee_id, "name": prof.name, "role": prof.get_role_display(),
            "level": prof.level, "branch": prof.branch.name if prof.branch else "All",
            "pay_type": prof.get_pay_type_display(), "pay_method": prof.get_pay_method_display(), "pay_method_key": prof.pay_method,
            "can_mark": a.level >= ADMIN or _can_manage(a, prof),
            "weeks": wk, "unpaid_count": len(owed),
            "unpaid_total": reports.s(sum((Decimal(w["balance"]) for w in owed), Decimal("0"))),
        })
    rows.sort(key=lambda r: (-r["unpaid_count"], r["name"].lower()))
    cfg = PaySettings.get()
    return Response({"weeks": count, "frequency": cfg.frequency, "frequency_display": cfg.get_frequency_display(), "rows": rows,
                     "unpaid_total": reports.s(sum((Decimal(r["unpaid_total"]) for r in rows), Decimal("0")))})


def _pay_parts(d, prof, gross: Decimal):
    raw = d.get("payments")
    if not raw:
        return [{"method": d.get("pay_method") or prof.pay_method, "amount": str(gross), "reference": str(d.get("reference") or "")[:60]}]
    parts = []
    try:
        for x in raw:
            m = x.get("method")
            if m not in PAY_METHODS:
                raise ValidationError({"payments": "Each part is cash, check or direct deposit."})
            amt = Decimal(str(x.get("amount"))).quantize(Decimal("0.01"))
            if amt <= 0:
                raise ValidationError({"payments": "Each part must be more than $0."})
            parts.append({"method": m, "amount": str(amt), "reference": str(x.get("reference") or "")[:60]})
    except (ArithmeticError, TypeError, ValueError, AttributeError):
        raise ValidationError({"payments": "Check the amounts."})
    total = sum((Decimal(x["amount"]) for x in parts), Decimal("0"))
    if total > gross:
        raise ValidationError({"payments": f"The parts add up to ${total}, more than the ${gross} earned."})
    return parts


@mgmt_api(["POST"])
def salary_mark(request):
    """Mark a person's pay period paid (in one or several parts: cash, check, direct deposit) or unpaid.
    Goes to the next role up (admin: saved right away). Nobody marks their own pay.
    Body: staff, from (period start), paid (bool), paid_on, payments [{method, amount, reference}], change_reason"""
    a = request.actor
    require(a, MANAGER, "mark pay")
    d = request.data
    prof = get_object_or_404(_staff_scope(a), pk=d.get("staff"))
    if prof.user_id == request.user.pk and a.level < ADMIN:
        raise PermissionDenied("You can't mark your own pay. Someone in a higher role must do it.")
    if a.level < ADMIN and not _can_manage(a, prof):
        raise PermissionDenied("You can't change this person's pay.")
    cfg = PaySettings.get()
    try:
        day = datetime.date.fromisoformat(str(d.get("from")))
    except ValueError:
        raise ValidationError({"from": "Choose the pay period."})
    start, end = cfg.period_of(day)
    if end >= timezone.localdate():
        raise ValidationError({"from": "This pay period is still running. Mark it once it's over."})
    paid = d.get("paid") in (True, "true", "1", 1)
    if ChangeRequest.objects.filter(kind="pay.mark", status="pending", payload__staff=prof.id, payload__from=start.isoformat()).exists():
        raise ValidationError({"detail": "A change for this pay period is already waiting for approval."})
    row = reports.payroll(TimeEntry.objects.filter(staff=prof), [prof], start, end)[0]
    gross = Decimal(row["gross_pay"])
    parts = _pay_parts(d, prof, gross) if paid else []
    paid_total = sum((Decimal(x["amount"]) for x in parts), Decimal("0"))
    paid_on = d.get("paid_on") or (timezone.localdate().isoformat() if paid else None)
    stmts = list(PayStatement.objects.filter(staff=prof, period_start__gte=start, period_end__lte=end))
    payload = {"staff": prof.id, "from": start.isoformat(), "to": end.isoformat(), "paid": paid,
               "paid_on": paid_on if paid else None, "payments": parts, "paid_amount": str(paid_total),
               "gross_pay": row["gross_pay"], "hours": row["hours"]}
    before = {"paid": any(s.is_paid for s in stmts), "paid_amount": str(sum((s.paid_amount for s in stmts), Decimal("0"))),
              "payments": [x for s in stmts for x in s.payments],
              "paid_on": max((s.paid_on for s in stmts if s.paid_on), default=None)}
    before["paid_on"] = before["paid_on"].isoformat() if before["paid_on"] else None
    what = ("PAID" if paid_total >= gross else f"PART-PAID ${paid_total} of") if paid else "UNPAID"
    cr = changes.submit(a, "pay.mark", target=stmts[0] if len(stmts) == 1 else None, branch=prof.branch_id, payload=payload,
                        before=before, reason=str(d.get("change_reason") or "")[:255],
                        summary=f"Mark {prof.name} {what} ${row['gross_pay']} for {start:%b %d}–{end:%b %d}")
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)


# =================================================================== owners: draws and profit split (admin only)

def _admin(request):
    require(request.actor, ADMIN, "manage owners")


def _company_profit(start, end) -> dict:
    from .models import Purchase
    staff = StaffProfile.objects.exclude(status__in=["pending", "rejected"])
    sales = reports.sales_summary(Order.objects.all(), start, end)
    pur = reports.purchases_summary(Purchase.objects.all(), start, end)
    labor = reports.labor_cost(TimeEntry.objects.all(), staff, start, end)
    net = Decimal(sales["net"])
    from .views_bills import app_days_total, bills_total
    bills, _ = bills_total(start, end)
    app = app_days_total(start, end)
    net += app["s"] - app["adj"]
    app_fees = Decimal(sales["app_fees"]) + app["f"]
    profit = net - Decimal(pur["cogs"]) - Decimal(pur["expenses"]) - bills - labor - app_fees
    return {"net_sales": reports.s(net), "cogs": pur["cogs"], "expenses": pur["expenses"], "labor": reports.s(labor),
            "app_fees": reports.s(app_fees), "bills": reports.s(bills),
            "net_profit": reports.s(profit)}


def _owner_json(o: Owner) -> dict:
    return {"id": o.id, "name": o.name, "user": o.user_id, "share_percent": str(o.share_percent),
            "is_active": o.is_active, "notes": o.notes}


def _draw_json(x: OwnerDraw) -> dict:
    return {"id": x.id, "owner": x.owner_id, "owner_name": x.owner.name, "branch": x.branch_id,
            "branch_name": x.branch.name if x.branch else None, "date": x.date.isoformat(), "amount": str(x.amount),
            "method": x.method, "method_display": x.get_method_display(), "reference": x.reference, "note": x.note,
            "created_by_name": (x.created_by.get_full_name() or x.created_by.username) if x.created_by else None,
            "created_at": x.created_at}


@mgmt_api(["GET", "POST"])
def owners(request):
    _admin(request)
    if request.method == "POST":
        d = request.data
        try:
            pct = Decimal(str(d.get("share_percent") or 0))
        except ArithmeticError:
            raise ValidationError({"share_percent": "Enter a percent."})
        if not (0 <= pct <= 100):
            raise ValidationError({"share_percent": "Use 0 to 100."})
        name = str(d.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Enter the owner's name."})
        o = Owner.objects.filter(pk=d.get("id")).first() if d.get("id") else Owner()
        before = audit.snapshot(o, ["name", "share_percent", "is_active", "notes"]) if o.pk else {}
        o.name, o.share_percent = name[:120], pct
        o.user_id = d.get("user") or None
        o.is_active = d.get("is_active", True) not in (False, "false", "0")
        o.notes = str(d.get("notes") or "")[:255]
        others = Owner.objects.filter(is_active=True).exclude(pk=o.pk).aggregate(t=Sum("share_percent"))["t"] or Decimal("0")
        if o.is_active and others + pct > 100:
            raise ValidationError({"share_percent": f"Shares would add up to {others + pct}%. The total can't be over 100%."})
        o.save()
        audit.log(request.user, "updated" if before else "created", "owner", o, branch=None,
                  summary=f"Owner {o.name}: {o.share_percent}%", changes=audit.diff(before, audit.snapshot(o, ["name", "share_percent", "is_active", "notes"])) if before else {})
    return Response([_owner_json(o) for o in Owner.objects.all()])


@mgmt_api(["GET", "POST"])
def owner_draws(request):
    """GET ?from=&to=&owner= ; POST: record money an owner took out."""
    _admin(request)
    if request.method == "POST":
        d = request.data
        owner = get_object_or_404(Owner, pk=d.get("owner"))
        try:
            amount = Decimal(str(d.get("amount")))
            day = datetime.date.fromisoformat(str(d.get("date") or timezone.localdate()))
        except (ArithmeticError, ValueError):
            raise ValidationError({"amount": "Enter the amount and date."})
        if amount <= 0:
            raise ValidationError({"amount": "The amount must be above 0."})
        if d.get("method") not in dict(OwnerDraw.Method.choices):
            raise ValidationError({"method": "Choose how the money was taken."})
        x = OwnerDraw.objects.create(owner=owner, branch_id=d.get("branch") or None, date=day, amount=amount.quantize(Decimal("0.01")),
                                     method=d["method"], reference=str(d.get("reference") or "")[:60],
                                     note=str(d.get("note") or "")[:255], created_by=request.user)
        audit.log(request.user, "created", "owner draw", x, branch=x.branch_id,
                  summary=f"{owner.name} took ${x.amount} ({x.get_method_display()}) on {x.date}")
        return Response(_draw_json(x), status=201)
    qs = OwnerDraw.objects.select_related("owner", "branch", "created_by")
    p = request.query_params
    if p.get("from"):
        qs = qs.filter(date__gte=p["from"])
    if p.get("to"):
        qs = qs.filter(date__lte=p["to"])
    if p.get("owner"):
        qs = qs.filter(owner_id=p["owner"])
    return Response([_draw_json(x) for x in qs[:1000]])


@mgmt_api(["DELETE"])
def owner_draw_detail(request, pk):
    _admin(request)
    x = get_object_or_404(OwnerDraw, pk=pk)
    audit.log(request.user, "deleted", "owner draw", x, branch=x.branch_id,
              summary=f"Deleted draw: {x.owner.name} ${x.amount} on {x.date}")
    x.delete()
    return Response(status=204)


@mgmt_api(["GET"])
def owner_split(request):
    """Month by month: company profit, each owner's share, what they took, and what's left. ?year=2026"""
    _admin(request)
    year = int(request.query_params.get("year") or timezone.localdate().year)
    today = timezone.localdate()
    owners_ = list(Owner.objects.all())
    months, totals = [], {o.id: {"share": Decimal("0"), "taken": Decimal("0")} for o in owners_}
    for m in range(1, 13):
        start = datetime.date(year, m, 1)
        if start > today:
            break
        end = (datetime.date(year + (m == 12), m % 12 + 1, 1) - datetime.timedelta(days=1))
        prof = _company_profit(start, min(end, today))
        profit = Decimal(prof["net_profit"])
        draws = {r["owner"]: r["t"] for r in OwnerDraw.objects.filter(date__gte=start, date__lte=end)
                 .values("owner").annotate(t=Sum("amount"))}
        per = []
        for o in owners_:
            share = (profit * o.share_percent / 100).quantize(Decimal("0.01")) if o.is_active else Decimal("0.00")
            taken = draws.get(o.id) or Decimal("0")
            totals[o.id]["share"] += share
            totals[o.id]["taken"] += taken
            per.append({"owner": o.id, "share": reports.s(share), "taken": reports.s(taken), "balance": reports.s(share - taken)})
        months.append({"month": start.isoformat()[:7], "running": end >= today, **prof, "owners": per,
                       "taken_total": reports.s(sum(draws.values(), Decimal("0")))})
    return Response({
        "year": year, "owners": [_owner_json(o) for o in owners_],
        "share_total": str(sum((o.share_percent for o in owners_ if o.is_active), Decimal("0"))),
        "months": months,
        "totals": [{"owner": oid, "share": reports.s(t["share"]), "taken": reports.s(t["taken"]),
                    "balance": reports.s(t["share"] - t["taken"])} for oid, t in totals.items()],
    })


# =================================================================== cash position: what's left to deposit / take out

def _cash_out(qs) -> Decimal:
    """Cash part of deposits / take-outs (checks never sat in the drawer)."""
    t = Decimal("0")
    for d in qs.only("amount", "cash_amount", "check_amount"):
        t += d.cash_amount if d.cash_amount is not None else d.amount - (d.check_amount or 0)
    return t


@mgmt_api(["GET"])
def cash_position(request):
    """Real-time cash per store: closed days not yet deposited + today's cash so far, and a month-by-month history.
    ?branch=&months=12"""
    from .models import BankDeposit, Branch, DailyClose
    from .views import _close_numbers
    a = request.actor
    require(a, MANAGER, "see cash")
    p = request.query_params
    branches = Branch.objects.filter(is_active=True, **({} if a.branch_ids is None else {"pk__in": a.branch_ids}))
    if b := p.get("branch"):
        branches = branches.filter(pk=b)
    today = timezone.localdate()
    months = min(24, max(1, int(p.get("months") or 12)))
    out = []
    for br in branches:
        closes = DailyClose.objects.filter(branch=br)
        to_dep = closes.aggregate(t=Sum("cash_to_deposit"))["t"] or Decimal("0")
        deps = BankDeposit.objects.filter(branch=br)
        deposited = _cash_out(deps.filter(kind="deposit"))
        taken = _cash_out(deps.filter(kind="takeout"))
        owner_cash = OwnerDraw.objects.filter(branch=br, method="cash").aggregate(t=Sum("amount"))["t"] or Decimal("0")
        held = to_dep - deposited - taken - owner_cash
        today_closed = closes.filter(date=today).exists()
        live = {}
        if not today_closed:
            n = _close_numbers(br, today)
            drawer = n["expected_cash"]
            float_ = n["opening_float"]
            live = {"drawer_expected": reports.s(drawer), "opening_float": reports.s(float_),
                    "safe_drops": reports.s(n["safe_drops"]), "cash_sales": reports.s(n["cash_sales"]),
                    "paid_outs": reports.s(n["paid_outs"]), "paid_ins": reports.s(n["paid_ins"]),
                    "today_extra": reports.s(max(Decimal("0"), drawer + n["safe_drops"] - float_))}
        available = held + (Decimal(live["today_extra"]) if live else Decimal("0"))
        last_dep = deps.filter(kind="deposit").order_by("-date").first()
        unclosed = []
        d = today - datetime.timedelta(days=7)
        opened_days = set(DailyClose.objects.filter(branch=br, date__gte=d).values_list("date", flat=True))
        from .models import DayOpen
        for od in DayOpen.objects.filter(branch=br, date__gte=d, date__lt=today).values_list("date", flat=True):
            if od not in opened_days:
                unclosed.append(od.isoformat())
        # month by month
        hist = []
        m0 = datetime.date(today.year, today.month, 1)
        for i in range(months):
            y, mth = m0.year, m0.month - i
            while mth <= 0:
                mth += 12
                y -= 1
            start = datetime.date(y, mth, 1)
            end = (datetime.date(y + (mth == 12), mth % 12 + 1, 1) - datetime.timedelta(days=1))
            c = closes.filter(date__gte=start, date__lte=end).aggregate(
                td=Sum("cash_to_deposit"), os=Sum("over_short"), cs=Sum("cash_sales"), ts=Sum("total_sales"),
                po=Sum("paid_outs"), pi=Sum("paid_ins"), n=Count("id"))
            dm = deps.filter(date__gte=start, date__lte=end)
            dep_m = _cash_out(dm.filter(kind="deposit"))
            take_m = _cash_out(dm.filter(kind="takeout")) + (OwnerDraw.objects.filter(branch=br, method="cash", date__gte=start, date__lte=end)
                                                               .aggregate(t=Sum("amount"))["t"] or Decimal("0"))
            bal = ((closes.filter(date__lte=end).aggregate(t=Sum("cash_to_deposit"))["t"] or Decimal("0"))
                   - _cash_out(deps.filter(date__lte=end))
                   - (OwnerDraw.objects.filter(branch=br, method="cash", date__lte=end).aggregate(t=Sum("amount"))["t"] or Decimal("0")))
            hist.append({"month": start.isoformat()[:7], "running": end >= today, "days_closed": c["n"] or 0,
                         "total_sales": reports.s(c["ts"]), "cash_sales": reports.s(c["cs"]), "paid_outs": reports.s(c["po"]),
                         "paid_ins": reports.s(c["pi"]), "over_short": reports.s(c["os"]), "to_deposit": reports.s(c["td"]),
                         "deposited": reports.s(dep_m), "taken_out": reports.s(take_m), "balance_end": reports.s(bal)})
        out.append({
            "branch": br.id, "branch_name": br.name,
            "closed_to_deposit": reports.s(to_dep), "deposited": reports.s(deposited), "taken_out": reports.s(taken + owner_cash),
            "held": reports.s(held), "today": live, "today_closed": today_closed, "available": reports.s(available),
            "last_deposit": {"date": last_dep.date.isoformat(), "amount": reports.s(last_dep.amount)} if last_dep else None,
            "unclosed_days": unclosed, "months": hist,
        })
    return Response(out)


# =================================================================== sales tax report (super admin & admin; filing status: admin only)

from django.conf import settings as dj_settings  # noqa: E402
from django.db.models.functions import TruncDay, TruncMonth, TruncQuarter, TruncWeek, TruncYear  # noqa: E402

from .access import SUPERADMIN  # noqa: E402
from .models import Branch, TaxFiling  # noqa: E402

TRUNC = {"day": TruncDay, "week": TruncWeek, "month": TruncMonth, "quarter": TruncQuarter, "year": TruncYear}
SOLD = Order.SALE_STATUSES + [Order.Status.REFUNDED]   # a refunded sale still happened on its day; the refund is counted on the refund day


def _bucket_end(start: datetime.date, group: str) -> datetime.date:
    if group == "day":
        return start
    if group == "week":
        return start + datetime.timedelta(days=6)
    months = {"month": 1, "quarter": 3, "year": 12}[group]
    y, m = start.year + (start.month - 1 + months) // 12, (start.month - 1 + months) % 12 + 1
    return datetime.date(y, m, 1) - datetime.timedelta(days=1)


def _label(start: datetime.date, group: str) -> str:
    return {"day": start.strftime("%a %b %d, %Y"), "week": f"Week of {start:%b %d, %Y}", "month": start.strftime("%B %Y"),
            "quarter": f"Q{(start.month - 1) // 3 + 1} {start.year}", "year": str(start.year)}[group]


def tax_numbers(orders, start: datetime.date, end: datetime.date, group: str, app_days=None) -> tuple[list[dict], dict]:
    """Per period: sales with and without tax, tax collected, refunds and what's owed."""
    tz = timezone.get_current_timezone()
    tr = TRUNC[group]
    zero = Decimal("0")
    sold = (orders.filter(status__in=SOLD, created_at__date__gte=start, created_at__date__lte=end)
            .annotate(b=tr("created_at", tzinfo=tz)).values("b")
            .annotate(app_total=Sum("total", filter=Q(partner_collects_tax=True)),   # before "total" is shadowed
                      app_tax=Sum("tax", filter=Q(partner_collects_tax=True)),
                      n=Count("id"), total=Sum("total"), tax=Sum("tax"), fees=Sum("delivery_fee"),
                      disc=Sum("discount_amount"), promo=Sum("promo_discount")))
    refunded = (orders.filter(status=Order.Status.REFUNDED, refunded_at__date__gte=start, refunded_at__date__lte=end)
                .annotate(b=tr("refunded_at", tzinfo=tz)).values("b")
                .annotate(app_total=Sum("total", filter=Q(partner_collects_tax=True)),
                          app_tax=Sum("tax", filter=Q(partner_collects_tax=True)),
                          n=Count("id"), total=Sum("total"), tax=Sum("tax")))
    buckets: dict = {}
    for r in sold:
        k = r["b"].date() if hasattr(r["b"], "date") else r["b"]
        buckets.setdefault(k, {})["sold"] = r
    for r in refunded:
        k = r["b"].date() if hasattr(r["b"], "date") else r["b"]
        buckets.setdefault(k, {})["ref"] = r
    if app_days is not None:   # delivery-app sales entered day by day (Uber Eats, DoorDash…)
        for r in (app_days.filter(date__gte=start, date__lte=end).annotate(b=tr("date")).values("b")
                  .annotate(app_s=Sum("sales", filter=Q(tax_by_app=True)), app_t=Sum("tax", filter=Q(tax_by_app=True)),
                            n=Sum("orders"), s_=Sum("sales"), t_=Sum("tax"))):
            k = r["b"].date() if hasattr(r["b"], "date") else r["b"]
            buckets.setdefault(k, {})["app"] = r
    rows, T = [], {k: zero for k in ("with_tax", "tax", "without_tax", "fees", "discounts", "refund_with_tax", "refund_tax",
                                      "net_without_tax", "net_tax", "net_with_tax", "app_with_tax", "app_tax",
                                      "tax_collected")}
    T["orders"], T["refunds"] = 0, 0
    for k in sorted(buckets):
        s, r, ad = buckets[k].get("sold", {}), buckets[k].get("ref", {}), buckets[k].get("app", {})
        ad_t = ad.get("t_") or zero
        with_tax = (s.get("total") or zero) + (ad.get("s_") or zero) + ad_t
        tax = (s.get("tax") or zero) + ad_t
        rw, rt = r.get("total") or zero, r.get("tax") or zero
        # Sales on delivery apps that collect & pay the tax themselves (marketplace facilitators)
        app_w = (s.get("app_total") or zero) - (r.get("app_total") or zero) + (ad.get("app_s") or zero) + (ad.get("app_t") or zero)
        app_t = (s.get("app_tax") or zero) - (r.get("app_tax") or zero) + (ad.get("app_t") or zero)
        row = {
            "from": k.isoformat(), "to": min(_bucket_end(k, group), end).isoformat(), "label": _label(k, group),
            "orders": s.get("n", 0) + (ad.get("n") or 0), "with_tax": with_tax, "tax": tax, "without_tax": with_tax - tax,
            "fees": s.get("fees") or zero, "discounts": (s.get("disc") or zero) + (s.get("promo") or zero),
            "refunds": r.get("n", 0), "refund_with_tax": rw, "refund_tax": rt,
            "net_without_tax": (with_tax - tax) - (rw - rt), "net_with_tax": with_tax - rw,
            "tax_collected": tax - rt, "app_with_tax": app_w, "app_tax": app_t,
            "net_tax": tax - rt - app_t,   # the tax YOU report and pay
        }
        for key in T:
            T[key] += row[key] if key in row else 0
        rows.append(row)
    fmt = lambda d: {k: (reports.s(v) if isinstance(v, Decimal) else v) for k, v in d.items()}
    return [fmt(x) for x in rows], fmt(T)


@mgmt_api(["GET"])
def tax_report(request):
    """?from=&to=&group=day|week|month|quarter|year&branch= — super admin & admin."""
    a = request.actor
    require(a, SUPERADMIN, "see tax reports")
    p = request.query_params
    group = p.get("group", "month") if p.get("group") in TRUNC else "month"
    today = timezone.localdate()
    try:
        start = datetime.date.fromisoformat(p.get("from") or f"{today.year}-01-01")
        end = datetime.date.fromisoformat(p.get("to") or today.isoformat())
    except ValueError:
        raise ValidationError({"from": "Use YYYY-MM-DD dates."})
    if end < start:
        raise ValidationError({"to": "The end date is before the start date."})
    orders = scope(Order.objects.all(), a, branch_param=p.get("branch"))
    from .models import AppSalesDay
    days = scope(AppSalesDay.objects.all(), a, branch_param=p.get("branch"))
    channel = p.get("channel") or "all"
    if channel == "store":        # counter + self-order kiosk
        orders, days = orders.filter(source__in=["pos", "kiosk"]), days.none()
    elif channel == "online":     # your website
        orders, days = orders.filter(source="online"), days.none()
    elif channel == "apps":       # Uber Eats, DoorDash, Grubhub…
        orders = orders.filter(source="partner")
    rows, total = tax_numbers(orders, start, end, group, app_days=days)
    branch = p.get("branch") or None
    filings = {(f.period_start.isoformat(), f.period_end.isoformat()): f
               for f in TaxFiling.objects.filter(branch_id=branch, period_start__gte=start - datetime.timedelta(days=366))}
    for r in rows:
        f = filings.get((r["from"], r["to"]))
        r["filing"] = _filing_json(f) if f else None
    by_store = []
    if not branch:
        for b in Branch.objects.filter(is_active=True):
            if a.can_see(b.id):
                _, t = tax_numbers(orders.filter(branch=b), start, end, group, app_days=days.filter(branch=b))
                by_store.append({"id": b.id, "name": b.name, "state": b.state, **t})
        _, t = tax_numbers(orders.filter(branch__isnull=True), start, end, group)
        if t["orders"]:
            by_store.append({"id": None, "name": "Online (no store)", "state": "", **t})
    # Channels side by side (always for all channels, so the filter can be compared)
    all_orders = scope(Order.objects.all(), a, branch_param=p.get("branch"))
    all_days = scope(AppSalesDay.objects.all(), a, branch_param=p.get("branch"))
    by_channel = []
    for key, label, oq, dq in [("store", "In store (counter + kiosk)", all_orders.filter(source__in=["pos", "kiosk"]), None),
                               ("online", "Online (website)", all_orders.filter(source="online"), None),
                               ("apps", "Delivery apps", all_orders.filter(source="partner"), all_days)]:
        _, t = tax_numbers(oq, start, end, group, app_days=dq)
        by_channel.append({"key": key, "label": label, **t})
    return Response({"from": start.isoformat(), "to": end.isoformat(), "group": group, "tax_rate": str(dj_settings.TAX_RATE),
                     "channel": channel, "rows": rows, "total": total, "by_store": by_store, "by_channel": by_channel,
                     "paid": _taxes_paid(a, p.get("branch"), start, end), "can_edit_status": a.level >= ADMIN})


def _taxes_paid(a, branch, start, end) -> dict:
    """Sales tax & taxes YOU paid: on vendor purchases and on monthly bills (utilities…). For your accountant."""
    from .models import Bill, Purchase
    pur = scope(Purchase.objects.filter(status="approved", purchase_date__gte=start, purchase_date__lte=end), a, branch_param=branch)
    bills = Bill.objects.filter(bill_month__gte=start.replace(day=1), bill_month__lte=end)
    if branch:
        bills = bills.filter(branch_id=branch)
    elif a.branch_ids is not None:
        bills = bills.filter(branch_id__in=a.branch_ids)
    vendors = [{"name": r["vendor"], "count": r["n"], "spent": reports.s(r["t"]), "tax": reports.s(r["tax"])}
               for r in pur.values("vendor").annotate(n=Count("id"), t=Sum("total"), tax=Sum("tax")).order_by("-tax", "-t")]
    labels = dict(Bill.Category.choices)
    utils = [{"name": labels.get(r["category"], r["category"]), "count": r["n"], "spent": reports.s(r["t"]), "tax": reports.s(r["tax"])}
             for r in bills.values("category").annotate(n=Count("id"), t=Sum("total"), tax=Sum("tax")).order_by("-tax", "-t")]
    vt = pur.aggregate(t=Sum("total"), tax=Sum("tax"))
    bt = bills.aggregate(t=Sum("total"), tax=Sum("tax"))
    z = Decimal("0")
    return {"vendors": vendors, "utilities": utils,
            "vendor_spent": reports.s(vt["t"]), "vendor_tax": reports.s(vt["tax"]),
            "utility_spent": reports.s(bt["t"]), "utility_tax": reports.s(bt["tax"]),
            "total_tax": reports.s((vt["tax"] or z) + (bt["tax"] or z))}


def _filing_json(f: TaxFiling) -> dict:
    return {"id": f.id, "branch": f.branch_id, "period_start": f.period_start.isoformat(), "period_end": f.period_end.isoformat(),
            "status": f.status, "status_display": f.get_status_display(), "tax_due": str(f.tax_due), "amount_paid": str(f.amount_paid),
            "filed_on": f.filed_on.isoformat() if f.filed_on else None, "paid_on": f.paid_on.isoformat() if f.paid_on else None,
            "confirmation": f.confirmation, "note": f.note,
            "updated_by_name": (f.updated_by.get_full_name() or f.updated_by.username) if f.updated_by else None,
            "updated_at": f.updated_at}


@mgmt_api(["GET", "POST"])
def tax_filings(request):
    """GET (super admin & admin): filing records. POST (admin only): set the status of a period."""
    a = request.actor
    require(a, SUPERADMIN, "see tax filings")
    if request.method == "GET":
        qs = TaxFiling.objects.select_related("updated_by")
        if a.level < ADMIN:
            qs = qs.filter(Q(branch__isnull=True) | Q(branch_id__in=a.branch_ids or []))
        return Response([_filing_json(f) for f in qs[:500]])
    if a.level < ADMIN:
        raise PermissionDenied("Only the admin can change tax filing status.")
    d = request.data
    try:
        start = datetime.date.fromisoformat(str(d.get("period_start")))
        end = datetime.date.fromisoformat(str(d.get("period_end")))
        paid_amt = Decimal(str(d.get("amount_paid") or 0)).quantize(Decimal("0.01"))
        filed_on = datetime.date.fromisoformat(d["filed_on"]) if d.get("filed_on") else None
        paid_on = datetime.date.fromisoformat(d["paid_on"]) if d.get("paid_on") else None
    except (ValueError, ArithmeticError):
        raise ValidationError({"period_start": "Check the dates and amounts."})
    status = d.get("status")
    if status not in TaxFiling.Status.values:
        raise ValidationError({"status": "Choose not filed, filed, or filed & paid."})
    if status != "open" and not filed_on:
        raise ValidationError({"filed_on": "Enter the date it was filed."})
    if status == "paid" and not paid_on:
        raise ValidationError({"paid_on": "Enter the date the tax was paid."})
    branch = d.get("branch") or None
    from .models import AppSalesDay
    orders = Order.objects.all() if not branch else Order.objects.filter(branch_id=branch)
    days = AppSalesDay.objects.all() if not branch else AppSalesDay.objects.filter(branch_id=branch)
    _, t = tax_numbers(orders, start, end, "year", app_days=days)
    f, _ = TaxFiling.objects.get_or_create(branch_id=branch, period_start=start, period_end=end)
    before = audit.snapshot(f, ["status", "amount_paid", "filed_on", "paid_on", "confirmation", "note"])
    f.status, f.amount_paid, f.filed_on, f.paid_on = status, paid_amt, filed_on, paid_on
    f.confirmation, f.note = str(d.get("confirmation") or "")[:80], str(d.get("note") or "")[:255]
    f.tax_due, f.updated_by = Decimal(t["net_tax"]), request.user
    f.save()
    audit.log(request.user, "updated", "tax filing", f, branch=branch,
              summary=f"Sales tax {start:%b %d, %Y}–{end:%b %d, %Y}: {f.get_status_display()} (${f.amount_paid} of ${f.tax_due})",
              changes=audit.diff(before, audit.snapshot(f, ["status", "amount_paid", "filed_on", "paid_on", "confirmation", "note"])))
    return Response(_filing_json(f))
