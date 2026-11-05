"""What happens when each kind of change is approved. Payloads were validated when submitted."""
import datetime
import os
from decimal import Decimal

from django.core.files.base import File
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from menu.models import Category, MenuItem, Promotion
from orders.pricing import money

from .access import ADMIN, MANAGER, SUPERADMIN, SUPERVISOR
from .changes import handler
from .models import (
    BankDeposit,
    DailyClose,
    MenuBoard,
    PayStatement,
    Purchase,
    PurchaseLine,
    StaffProfile,
    TimeEntry,
    Vendor,
)

D = lambda v: Decimal(str(v or 0))


def _set(obj, data: dict, fields):
    for f in fields:
        if f in data:
            setattr(obj, f, data[f])


# ---------------------------------------------------------------- purchases

PURCHASE_FIELDS = ["vendor", "invoice_number", "category", "paid_with", "purchase_date", "reason"]


@handler("purchase.edit", MANAGER, "purchase", "/manage/purchases")
def purchase_edit(cr, approver):
    p = Purchase.objects.get(pk=cr.target_id)
    d = cr.payload
    _set(p, d, PURCHASE_FIELDS)
    if "vendor_ref" in d:
        p.vendor_ref_id = d["vendor_ref"]
    if "lines" in d:
        p.lines.all().delete()
        PurchaseLine.objects.bulk_create([PurchaseLine(purchase=p, name=l["name"], quantity=D(l["quantity"]),
                                                       unit=l.get("unit", ""), unit_cost=D(l["unit_cost"]))
                                          for l in d["lines"]])
        p.subtotal = money(sum((D(l["quantity"]) * D(l["unit_cost"]) for l in d["lines"]), Decimal("0")))
    if "tax" in d:
        p.tax = money(D(d["tax"]))
    p.total = p.subtotal + p.tax
    if cr.file:
        p.receipt.save(os.path.basename(cr.file.name), File(cr.file.open("rb")), save=False)
    p.save()
    return p


# ---------------------------------------------------------------- cash

@handler("close.edit", MANAGER, "daily close", "/manage/cash")
def close_edit(cr, approver):
    c = DailyClose.objects.select_related("branch").get(pk=cr.target_id)
    d = cr.payload
    if "denominations" in d:
        c.denominations = d["denominations"]
        c.counted_cash = money(sum((D(k) * int(v or 0) for k, v in d["denominations"].items()), Decimal("0")))
        c.over_short = money(c.counted_cash - c.expected_cash)
        c.cash_to_deposit = money(max(Decimal("0"), c.counted_cash + c.safe_drops - c.branch.opening_float))
    if "notes" in d:
        c.notes = d["notes"]
    c.edited_by = cr.submitted_by
    c.save()
    return c


@handler("deposit.edit", SUPERADMIN, "bank deposit", "/manage/cash")
def deposit_edit(cr, approver):
    dep = BankDeposit.objects.get(pk=cr.target_id)
    d = dict(cr.payload)
    if "amount" in d:
        d["amount"] = D(d["amount"])
    _set(dep, d, ["date", "amount", "bank_name", "account_last4", "slip_number", "covers_from", "covers_to", "note"])
    if cr.file:
        dep.slip.save(os.path.basename(cr.file.name), File(cr.file.open("rb")), save=False)
    dep.save()
    return dep


# ---------------------------------------------------------------- time clock

def _dt(v):
    return parse_datetime(v) if isinstance(v, str) else v


@handler("time.add", MANAGER, "clock-in", "/manage/payroll")
def time_add(cr, approver):
    d = cr.payload
    return TimeEntry.objects.create(staff_id=d["staff"], branch_id=d["branch"], clock_in=_dt(d["clock_in"]),
                                    clock_out=_dt(d.get("clock_out")), tips=D(d.get("tips")),
                                    note=d.get("note", ""), edited_by=cr.submitted_by)


@handler("time.edit", MANAGER, "clock-in", "/manage/payroll")
def time_edit(cr, approver):
    e = TimeEntry.objects.get(pk=cr.target_id)
    d = cr.payload
    if "clock_in" in d:
        e.clock_in = _dt(d["clock_in"])
    if "clock_out" in d:
        e.clock_out = _dt(d["clock_out"])
    if "tips" in d:
        e.tips = D(d["tips"])
    if "note" in d:
        e.note = d["note"]
    e.edited_by = cr.submitted_by
    e.save()
    return e


@handler("time.delete", MANAGER, "clock-in", "/manage/payroll")
def time_delete(cr, approver):
    e = TimeEntry.objects.get(pk=cr.target_id)
    e.delete()
    return None


# ---------------------------------------------------------------- vendors

VENDOR_FIELDS = ["name", "contact_name", "phone", "email", "website", "address", "city", "state", "zip_code",
                 "account_number", "payment_terms", "w9_on_file", "categories", "notes", "is_active"]


@handler("vendor.create", MANAGER, "vendor", "/manage/vendors")
def vendor_create(cr, approver):
    v = Vendor()
    _set(v, cr.payload, VENDOR_FIELDS)
    v.save()
    return v


@handler("vendor.edit", MANAGER, "vendor", "/manage/vendors")
def vendor_edit(cr, approver):
    v = Vendor.objects.get(pk=cr.target_id)
    _set(v, cr.payload, VENDOR_FIELDS)
    v.save()
    return v


# ---------------------------------------------------------------- menu

ITEM_FIELDS = ["name", "description", "emoji", "is_available", "is_featured", "is_spicy", "is_vegetarian",
               "calories", "sort_order"]


def _item(obj, cr):
    d = cr.payload
    _set(obj, d, ITEM_FIELDS)
    if "price" in d:
        obj.price = money(D(d["price"]))
    if "category" in d:
        obj.category_id = d["category"]
    if cr.file:
        obj.image.save(os.path.basename(cr.file.name), File(cr.file.open("rb")), save=False)
    obj.save()
    if "option_groups" in d:
        sync_options(obj, d["option_groups"] or [])
    return obj


def sync_options(item, groups):
    """Make the item's option groups match the list (update by id, add new, remove missing).
    Orders keep their own copy of chosen options, so past orders are unaffected."""
    from menu.models import Option, OptionGroup
    keep_groups = []
    for gi, g in enumerate(groups):
        grp = OptionGroup.objects.filter(pk=g.get("id"), item=item).first() if g.get("id") else None
        grp = grp or OptionGroup(item=item)
        grp.name = str(g.get("name") or "Options")[:80]
        grp.required = bool(g.get("required"))
        grp.max_select = max(1, int(g.get("max_select") or 1))
        grp.min_select = min(grp.max_select, max(1 if grp.required else 0, int(g.get("min_select") or 0)))
        grp.sort_order = gi
        grp.save()
        keep_groups.append(grp.pk)
        keep_opts = []
        for oi, o in enumerate(g.get("options") or []):
            opt = Option.objects.filter(pk=o.get("id"), group=grp).first() if o.get("id") else None
            opt = opt or Option(group=grp)
            opt.name = str(o.get("name") or "")[:80] or "Option"
            opt.price_delta = money(D(o.get("price_delta") or 0))
            opt.is_available = o.get("is_available", True) is not False
            opt.sort_order = oi
            opt.save()
            keep_opts.append(opt.pk)
        grp.options.exclude(pk__in=keep_opts).delete()
    item.option_groups.exclude(pk__in=keep_groups).delete()


@handler("menu_item.create", SUPERVISOR, "menu item", "/manage/menu")
def menu_item_create(cr, approver):
    return _item(MenuItem(), cr)


@handler("menu_item.edit", SUPERVISOR, "menu item", "/manage/menu")
def menu_item_edit(cr, approver):
    return _item(MenuItem.objects.get(pk=cr.target_id), cr)


CATEGORY_FIELDS = ["name", "description", "emoji", "sort_order", "is_active"]


@handler("category.create", SUPERVISOR, "menu section", "/manage/menu")
def category_create(cr, approver):
    c = Category()
    _set(c, cr.payload, CATEGORY_FIELDS)
    c.save()
    return c


@handler("category.edit", SUPERVISOR, "menu section", "/manage/menu")
def category_edit(cr, approver):
    c = Category.objects.get(pk=cr.target_id)
    _set(c, cr.payload, CATEGORY_FIELDS)
    c.save()
    return c


PROMO_FIELDS = ["name", "description", "kind", "applies_to", "days", "start_date", "end_date", "channels",
                "code", "is_active"]


def _promo(p, cr):
    d = cr.payload
    _set(p, d, PROMO_FIELDS)
    if "value" in d:
        p.value = D(d["value"])
    if "category" in d:
        p.category_id = d["category"]
    for f in ("start_time", "end_time"):
        if f in d:
            setattr(p, f, datetime.time.fromisoformat(d[f]) if d[f] else None)
    p.save()
    if "items" in d:
        p.items.set(d["items"])
    if "branches" in d:
        p.branches.set(d["branches"])
    return p


@handler("promotion.create", SUPERVISOR, "offer", "/manage/offers")
def promotion_create(cr, approver):
    return _promo(Promotion(), cr)


@handler("promotion.edit", SUPERVISOR, "offer", "/manage/offers")
def promotion_edit(cr, approver):
    return _promo(Promotion.objects.get(pk=cr.target_id), cr)


# ---------------------------------------------------------------- TV screens

BOARD_FIELDS = ["name", "title", "subtitle", "theme", "columns", "categories", "show_qr", "show_flavours",
                "show_offers", "ticker", "is_active", "layout", "orientation", "featured"]


@handler("board.create", MANAGER, "TV screen", "/manage/screens")
def board_create(cr, approver):
    b = MenuBoard(branch_id=cr.payload.get("branch"))
    _set(b, cr.payload, BOARD_FIELDS)
    b.save()
    return b


@handler("board.edit", MANAGER, "TV screen", "/manage/screens")
def board_edit(cr, approver):
    b = MenuBoard.objects.get(pk=cr.target_id)
    _set(b, cr.payload, BOARD_FIELDS)
    if "branch" in cr.payload:
        b.branch_id = cr.payload["branch"]
    b.save()
    return b


# ---------------------------------------------------------------- staff store access & pay

@handler("staff.stores", SUPERADMIN, "store access", "/manage/staff")
def staff_stores(cr, approver):
    p = StaffProfile.objects.get(pk=cr.target_id)
    p.assigned_branches.set(cr.payload["branches"])
    return p


PAY_FIELDS = ["paid_on", "pay_method", "reference", "note"]
PAY_MONEY = ["regular_hours", "overtime_hours", "rate", "regular_pay", "overtime_pay", "tips", "gross_pay"]


@handler("pay.edit", SUPERADMIN, "pay statement", "/manage/payroll")
def pay_edit(cr, approver):
    s = PayStatement.objects.get(pk=cr.target_id)
    _set(s, cr.payload, PAY_FIELDS)
    for f in PAY_MONEY:
        if f in cr.payload:
            setattr(s, f, D(cr.payload[f]))
    s.save()
    return s


@handler("staff.pay", MANAGER, "pay rate", "/manage/staff")
def staff_pay(cr, approver):
    p = StaffProfile.objects.get(pk=cr.target_id)
    d = cr.payload
    if "pay_type" in d:
        p.pay_type = d["pay_type"]
    for f in ("hourly_rate", "weekly_salary"):
        if f in d:
            setattr(p, f, D(d[f]))
    p.save()
    return p


# ---------------------------------------------------------------- salary paid / unpaid

@handler("pay.mark", MANAGER, "salary payment", "/manage/payroll")
def pay_mark(cr, approver):
    """Mark a pay period paid (in parts) or unpaid. One record per period; smaller records inside it are merged into it."""
    from . import reports
    d = cr.payload
    prof = StaffProfile.objects.get(pk=d["staff"])
    start = datetime.date.fromisoformat(d["from"])
    end = datetime.date.fromisoformat(d["to"]) if d.get("to") else start + datetime.timedelta(days=6)
    row = reports.payroll(TimeEntry.objects.filter(staff=prof), [prof], start, end)[0]
    # older records inside this period (e.g. weekly ones before switching to every 2 weeks) are folded in
    PayStatement.objects.filter(staff=prof, period_start__gte=start, period_end__lte=end).exclude(
        period_start=start, period_end=end).delete()
    st, _ = PayStatement.objects.get_or_create(staff=prof, period_start=start, period_end=end,
                                               defaults={"created_by": cr.submitted_by})
    st.regular_hours, st.overtime_hours = D(row["regular_hours"]), D(row["overtime_hours"])
    st.rate, st.tips = prof.hourly_rate, D(row["tips"])
    st.regular_pay, st.overtime_pay, st.gross_pay = D(row["regular_pay"]), D(row["overtime_pay"]), D(row["gross_pay"])
    parts = d.get("payments") or ([] if not d["paid"] else [{"method": d.get("pay_method") or prof.pay_method,
                                                               "amount": row["gross_pay"], "reference": d.get("reference", "")}])
    st.payments = parts if d["paid"] else []
    st.paid_amount = sum((D(x["amount"]) for x in st.payments), Decimal("0"))
    st.is_paid = bool(d["paid"]) and st.paid_amount >= st.gross_pay
    st.paid_on = datetime.date.fromisoformat(d["paid_on"]) if d.get("paid") and d.get("paid_on") else None
    st.pay_method = parts[0]["method"] if len({x["method"] for x in parts}) == 1 and parts else prof.pay_method
    st.reference = ", ".join(x.get("reference", "") for x in parts if x.get("reference"))[:60]
    st.status, st.reviewed_by, st.reviewed_at = "approved", approver, timezone.now()
    st.save()
    return st
