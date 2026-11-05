"""Sales / purchases / labor / profit calculations shared by the POS and the management dashboard."""
import datetime
from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import ExtractHour, TruncDate
from django.utils import timezone

from orders.models import Order, OrderItem
from orders.pricing import money

from .models import Purchase, TimeEntry

ZERO = Decimal("0.00")
OT_THRESHOLD = Decimal("40")   # FLSA: overtime after 40 hours in a work week
OT_MULTIPLIER = Decimal("1.5")


def s(v) -> str:
    return str(money(v or ZERO))


def date_range(params) -> tuple[datetime.date, datetime.date]:
    """?period=today|week|month|year or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive)."""
    today = timezone.localdate()
    if params.get("from") and params.get("to"):
        return datetime.date.fromisoformat(params["from"]), datetime.date.fromisoformat(params["to"])
    period = params.get("period", "today")
    if period == "week":       # Monday–Sunday
        start = today - datetime.timedelta(days=today.weekday())
        return start, start + datetime.timedelta(days=6)
    if period == "month":
        start = today.replace(day=1)
        nxt = (start + datetime.timedelta(days=32)).replace(day=1)
        return start, nxt - datetime.timedelta(days=1)
    if period == "year":
        return today.replace(month=1, day=1), today.replace(month=12, day=31)
    if period == "yesterday":
        y = today - datetime.timedelta(days=1)
        return y, y
    return today, today


def in_range(qs, start, end, field="created_at"):
    return qs.filter(**{f"{field}__date__gte": start, f"{field}__date__lte": end})


PAY_LABELS = {"cash": "Cash", "card": "Card (counter)", "stripe": "Online (Stripe)", "partner": "Delivery apps"}


def by_payment(sales) -> list[dict]:
    """Money per payment method; split orders count each part."""
    from orders.models import method_totals
    totals = method_totals(sales)
    counts = {m: sales.filter(Q(payments__method=m) | Q(payments__isnull=True, payment_method=m)).distinct().count()
              for m in ("cash", "card")}
    counts["stripe"] = sales.filter(payment_method="stripe").count()
    counts["partner"] = sales.filter(payment_method="partner").count()
    rows = [{"key": m, "label": PAY_LABELS[m], "count": counts.get(m, 0), "total": s(t)} for m, t in totals.items() if t]
    return sorted(rows, key=lambda r: -Decimal(r["total"]))


def sales_summary(orders, start, end) -> dict:
    """orders = a queryset already limited to the branches the viewer may see."""
    orders = in_range(orders, start, end)
    sales = orders.filter(status__in=Order.SALE_STATUSES)
    agg = sales.aggregate(
        count=Count("id"), gross=Sum("total"), subtotal=Sum("subtotal"), tax=Sum("tax"),
        delivery=Sum("delivery_fee"), discounts=Sum("discount_amount"),
        discounted=Count("id", filter=Q(discount_amount__gt=0)),
        tips=Sum("tip"), app_fees=Sum("partner_commission"),
    )
    refunds = orders.filter(status=Order.Status.REFUNDED).aggregate(count=Count("id"), total=Sum("total"))
    count, gross = agg["count"] or 0, agg["gross"] or ZERO
    net = (agg["subtotal"] or ZERO) - (agg["discounts"] or ZERO)

    def by(field):
        labels = dict(Order._meta.get_field(field).choices)
        rows = sales.values(field).annotate(count=Count("id"), total=Sum("total")).order_by("-total")
        return [{"key": r[field] or "", "label": labels.get(r[field], r[field] or "—"),
                 "count": r["count"], "total": s(r["total"])} for r in rows]

    top = (OrderItem.objects.filter(order__in=sales).values("name")
           .annotate(qty=Sum("quantity"), total=Sum("line_total")).order_by("-qty", "-total")[:10])

    days = {r["d"]: r for r in sales.annotate(d=TruncDate("created_at", tzinfo=timezone.get_current_timezone()))
            .values("d").annotate(count=Count("id"), total=Sum("total"))}
    by_day, d = [], start
    while d <= end and len(by_day) < 400:
        r = days.get(d)
        by_day.append({"date": d.isoformat(), "count": r["count"] if r else 0, "total": s(r["total"] if r else 0)})
        d += datetime.timedelta(days=1)

    hours = {r["h"]: r for r in sales.annotate(h=ExtractHour("created_at", tzinfo=timezone.get_current_timezone()))
             .values("h").annotate(count=Count("id"), total=Sum("total"))}
    by_hour = [{"hour": h, "count": hours[h]["count"] if h in hours else 0,
                "total": s(hours[h]["total"] if h in hours else 0)} for h in range(24)]

    return {
        "from": start.isoformat(), "to": end.isoformat(),
        "orders": count, "gross": s(gross), "net": s(net), "tax": s(agg["tax"]),
        "delivery_fees": s(agg["delivery"]), "discounts": s(agg["discounts"]),
        "discounted_orders": agg["discounted"] or 0,
        "average_order": s(gross / count if count else 0),
        "refunds": {"count": refunds["count"] or 0, "total": s(refunds["total"])},
        "tips": s(agg["tips"]), "app_fees": s(agg["app_fees"]),
        "by_app": [{"name": r["partner__name"], "count": r["count"], "total": s(r["total"]),
                    "fees": s(r["fees"])} for r in sales.filter(partner__isnull=False).values("partner__name")
                   .annotate(count=Count("id"), total=Sum("total"), fees=Sum("partner_commission")).order_by("-total")],
        "by_payment": by_payment(sales), "by_source": by("source"), "by_fulfillment": by("fulfillment"),
        "top_items": [{"name": r["name"], "qty": r["qty"], "total": s(r["total"])} for r in top],
        "by_day": by_day, "by_hour": by_hour,
    }


def purchases_summary(purchases, start, end) -> dict:
    p = purchases.filter(purchase_date__gte=start, purchase_date__lte=end)
    approved = p.filter(status="approved")
    labels = dict(Purchase.Category.choices)
    by_cat = [{"key": r["category"], "label": labels.get(r["category"], r["category"]),
               "count": r["n"], "total": s(r["t"])}
              for r in approved.values("category").annotate(n=Count("id"), t=Sum("total")).order_by("-t")]
    cogs = approved.filter(category__in=Purchase.COGS).aggregate(t=Sum("total"))["t"] or ZERO
    total = approved.aggregate(t=Sum("total"))["t"] or ZERO
    return {
        "approved_total": s(total), "cogs": s(cogs), "expenses": s(total - cogs),
        "pending": {"count": p.filter(status="pending").count(),
                    "total": s(p.filter(status="pending").aggregate(t=Sum("total"))["t"])},
        "by_category": by_cat,
    }


# ---------------------------------------------------------------- payroll

def week_bounds(day: datetime.date) -> tuple[datetime.date, datetime.date]:
    start = day - datetime.timedelta(days=day.weekday())
    return start, start + datetime.timedelta(days=6)


def payroll(entries, profiles, start, end) -> list[dict]:
    """Hours & gross pay per person. Overtime is figured per Mon–Sun week (1.5× over 40 h)."""
    hours = defaultdict(lambda: defaultdict(Decimal))   # profile_id -> week_start -> hours
    tips = defaultdict(Decimal)
    shifts = defaultdict(int)
    for e in entries.filter(clock_in__date__gte=start, clock_in__date__lte=end):
        wk = week_bounds(timezone.localtime(e.clock_in).date())[0]
        hours[e.staff_id][wk] += e.hours
        tips[e.staff_id] += e.tips
        shifts[e.staff_id] += 1

    rows = []
    for p in profiles:
        weeks = hours.get(p.id, {})
        total = sum(weeks.values(), Decimal("0"))
        ot = sum((max(Decimal("0"), h - OT_THRESHOLD) for h in weeks.values()), Decimal("0"))
        regular = total - ot
        # salary is prorated by day, and only from the day they were hired
        from_day = max(start, p.hire_date) if p.hire_date else start
        weeks = Decimal(max(0, (end - from_day).days + 1)) / Decimal(7)
        if p.pay_type == "salary":
            gross = p.weekly_salary * weeks
            regular_pay, ot_pay = gross, ZERO
        else:
            regular_pay = regular * p.hourly_rate
            ot_pay = ot * p.hourly_rate * OT_MULTIPLIER
            gross = regular_pay + ot_pay
        rows.append({
            "staff_id": p.id, "employee_id": p.employee_id, "name": p.name, "role": p.get_role_display(),
            "branch": p.branch.name if p.branch else "All", "pay_type": p.get_pay_type_display(),
            "pay_method": p.get_pay_method_display(), "rate": s(p.hourly_rate),
            "weekly_salary": s(p.weekly_salary), "shifts": shifts.get(p.id, 0),
            "hours": str(total.quantize(Decimal("0.01"))), "regular_hours": str(regular.quantize(Decimal("0.01"))),
            "overtime_hours": str(ot.quantize(Decimal("0.01"))),
            "regular_pay": s(regular_pay), "overtime_pay": s(ot_pay), "tips": s(tips.get(p.id, 0)),
            "gross_pay": s(gross),
        })
    return rows


def labor_cost(entries, profiles, start, end) -> Decimal:
    return sum((Decimal(r["gross_pay"]) for r in payroll(entries, profiles, start, end)), Decimal("0"))
