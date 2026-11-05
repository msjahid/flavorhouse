import csv
import datetime
import json
from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from .auth import StaffTokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from orders.models import Order, method_totals
from orders.pricing import money

from . import audit, changes, reports
from .access import (
    ADMIN,
    MANAGER,
    PURCHASE_APPROVER_LEVEL,
    STAFF_APPROVER_LEVEL,
    SUPERADMIN,
    SUPERVISOR,
    IsActiveStaff,
    actor_for,
    can_edit_entry_of,
    level_of,
    can_create_role,
    check_branch,
    notify,
    notify_admins,
    require,
    scope,
    users_at_level,
)
from .models import (
    LEVEL,
    DayOpen,
    Vendor,
    BankDeposit,
    Branch,
    CashDrop,
    DailyClose,
    Notification,
    Purchase,
    PurchaseLine,
    Role,
    StaffProfile,
    TimeEntry,
)
from .serializers import (
    BankDepositSerializer,
    ChangeRequestSerializer,
    BranchSerializer,
    CashDropSerializer,
    DailyCloseSerializer,
    NotificationSerializer,
    PurchaseSerializer,
    StaffSerializer,
    TimeEntrySerializer,
)

LEVEL_NAME = {SUPERVISOR: "Supervisor", SUPERADMIN: "Super admin", ADMIN: "Admin"}


def mgmt_api(methods):
    def wrap(fn):
        fn = permission_classes([IsActiveStaff])(fn)
        fn = authentication_classes([StaffTokenAuthentication])(fn)
        return api_view(methods)(fn)
    return wrap


def _ctx(request):
    return {"request": request}


def _branch_param(request):
    return request.query_params.get("branch") or None


def _dates(request):
    try:
        return reports.date_range(request.query_params)
    except ValueError:
        raise ValidationError({"date": "Use the format YYYY-MM-DD."})


# =================================================================== branches

@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def public_branches(request):
    """For the website checkout ("pick up from…") and in-store screens."""
    return Response([{"id": b.id, "name": b.name, "address": b.address}
                     for b in Branch.objects.filter(is_active=True)])


@mgmt_api(["GET", "POST"])
def branches(request):
    a = request.actor
    if request.method == "POST":
        require(a, ADMIN, "add branches")
        s = BranchSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response(BranchSerializer(s.save()).data, status=201)
    qs = Branch.objects.all() if a.branch_ids is None else Branch.objects.filter(pk__in=a.branch_ids)
    return Response(BranchSerializer(qs, many=True).data)


@mgmt_api(["PATCH"])
def branch_detail(request, pk):
    require(request.actor, ADMIN, "edit branches")
    b = get_object_or_404(Branch, pk=pk)
    s = BranchSerializer(b, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    return Response(BranchSerializer(s.save()).data)


# =================================================================== staff

def _staff_scope(a):
    qs = StaffProfile.objects.select_related("user", "branch", "created_by", "reviewed_by").prefetch_related("assigned_branches")
    if a.level == ADMIN:
        return qs
    lower = [r for r, lv in LEVEL.items() if lv < a.level]
    if a.multi_branch:  # supervisors / super admins: people below them in their assigned stores + themselves
        return qs.filter(Q(role__in=lower) & (Q(branch_id__in=a.branch_ids) | Q(branch__isnull=True, assigned_branches__in=a.branch_ids))
                         | Q(user=a.user)).distinct()
    # managers: employees of their store + themselves
    return qs.filter(Q(branch_id=a.branch_id, role=Role.EMPLOYEE) | Q(user=a.user))


def _can_manage(a, target: StaffProfile) -> bool:
    if a.level == ADMIN:
        return True
    if target.user_id == a.user.pk or LEVEL[target.role] >= a.level:
        return False
    if target.branch_id:
        return a.can_see(target.branch_id)
    return bool(set(target.assigned_branches.values_list("id", flat=True)) & set(a.branch_ids or []))


def staff_need_level(role: str, creator_level: int) -> int | None:
    """Who verifies a new staff member: at least the usual verifier for that role, and always above the person who added them."""
    if creator_level >= ADMIN:
        return None
    return max(STAFF_APPROVER_LEVEL[role], creator_level + 1)


def _staff_needs_review(a, role) -> bool:
    return staff_need_level(role, a.level) is not None


def _ask_staff_review(profile, a):
    lvl = staff_need_level(profile.role, a.level)
    who = f"{profile.name} ({profile.get_role_display()}, {profile.branch.name if profile.branch else 'all branches'})"
    # Approvers at that level and above (admins are always included) get one notification each.
    notify(users_at_level(lvl), "New staff member to verify",
           f"{who} was added by {a.name} — needs {LEVEL_NAME[lvl]} verification.", "/manage/approvals", exclude=a.user)


@mgmt_api(["GET", "POST"])
def staff(request):
    a = request.actor
    require(a, MANAGER, "manage staff")
    if request.method == "GET":
        qs = _staff_scope(a)
        if b := _branch_param(request):
            check_branch(a, b)
            qs = qs.filter(branch_id=b)
        if st := request.query_params.get("status"):
            qs = qs.filter(status=st)
        return Response(StaffSerializer(qs, many=True).data)

    data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
    if a.level == MANAGER:  # managers only add employees, always to their own store
        data["role"], data["branch"] = Role.EMPLOYEE, a.branch_id
    role = data.get("role", Role.EMPLOYEE)
    if role not in LEVEL or not can_create_role(a, role):
        raise PermissionDenied("Your role can't add this kind of staff member.")
    s = StaffSerializer(data=data)
    s.is_valid(raise_exception=True)
    branch = s.validated_data.get("branch")
    if branch:
        check_branch(a, branch.id)
    stores = _store_ids(a, data.get("assigned_branches")) if role in (Role.SUPERVISOR, Role.SUPERADMIN) else []
    with transaction.atomic():
        profile = s.save(created_by=request.user)
        if stores:
            profile.assigned_branches.set(stores)
        if _staff_needs_review(a, role):
            profile.status = StaffProfile.Status.PENDING
        else:
            profile.status = StaffProfile.Status.ACTIVE
            profile.reviewed_by, profile.reviewed_at = request.user, timezone.now()
        profile.save()
    audit.log(request.user, "created", "staff", profile, branch=profile.branch_id,
              summary=f"Added {profile.name} ({profile.get_role_display()}) — {profile.get_status_display()}")
    if profile.status == StaffProfile.Status.PENDING:
        _ask_staff_review(profile, a)
    return Response(StaffSerializer(profile).data, status=201)


def _store_ids(a, value) -> list[int]:
    """Stores to assign to a supervisor / super admin (only super admins & admins assign stores)."""
    if value in (None, ""):
        return []
    if a.level < SUPERADMIN:
        raise PermissionDenied("Only a super admin or admin can assign stores.")
    ids = [int(x) for x in (value if isinstance(value, list) else str(value).split(",")) if str(x).strip()]
    for i in ids:
        check_branch(a, i)
    return ids


@mgmt_api(["GET", "PATCH"])
def staff_detail(request, pk):
    a = request.actor
    require(a, MANAGER, "manage staff")
    p = get_object_or_404(_staff_scope(a), pk=pk)
    if request.method == "GET":
        return Response(StaffSerializer(p).data)
    if not _can_manage(a, p):
        raise PermissionDenied("You can't edit this person.")
    old_role = p.role
    data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
    if a.level == MANAGER:
        data.pop("role", None)
        data.pop("branch", None)
    new_role = data.get("role", p.role)
    if new_role not in LEVEL:
        raise ValidationError({"role": "Unknown role."})
    if new_role != old_role and not can_create_role(a, new_role):
        raise PermissionDenied("Your role can't give this role.")
    stores = data.pop("assigned_branches", None)
    # Pay changes need role-wise approval; everything else is saved now (and recorded in history).
    pay = {k: str(data.pop(k)) for k in ("pay_type", "hourly_rate", "weekly_salary") if k in data}
    pay = {k: v for k, v in pay.items() if str(getattr(p, k)) != v and not (k != "pay_type" and Decimal(v or 0) == getattr(p, k))}
    if pay:
        check = StaffSerializer(p, data={**pay}, partial=True)
        check.is_valid(raise_exception=True)
    before = audit.snapshot(p, ["employee_id", "role", "branch", "phone", "address", "job_title", "pay_method",
                                "employment_type", "i9_verified", "w4_on_file", "notes"])
    s = StaffSerializer(p, data=data, partial=True)
    s.is_valid(raise_exception=True)
    if s.validated_data.get("branch"):
        check_branch(a, s.validated_data["branch"].id)
    p = s.save()
    after = audit.snapshot(p, before.keys())
    if audit.diff(before, after) or data.get("password"):
        ch = audit.diff(before, after)
        if data.get("password"):
            ch["password"] = ["••••", "reset"]
        audit.log(request.user, "updated", "staff", p, branch=p.branch_id, summary=f"Updated {p.name}", changes=ch)
    msgs = []
    if pay:
        cr = changes.submit(a, "staff.pay", target=p, branch=p.branch_id, payload=pay,
                            before={k: str(getattr(p, k)) for k in pay}, summary=f"Pay change for {p.name}")
        msgs.append("Pay change sent for approval." if cr.status == "pending" else "Pay updated.")
    if stores is not None and p.role in (Role.SUPERVISOR, Role.SUPERADMIN):
        ids = _store_ids(a, stores)
        cr = changes.submit(a, "staff.stores", target=p, payload={"branches": ids},
                            before={"branches": sorted(p.assigned_branches.values_list("id", flat=True))},
                            summary=f"Store access for {p.name}: {', '.join(Branch.objects.filter(pk__in=ids).values_list('name', flat=True)) or 'none'}")
        msgs.append("Store access sent for approval." if cr.status == "pending" else "Store access updated.")
    # A promotion that the editor isn't senior enough to verify goes back for verification.
    if new_role != old_role and _staff_needs_review(a, new_role):
        p.status = StaffProfile.Status.PENDING
        p.save(update_fields=["status"])
        _ask_staff_review(p, a)
    out = StaffSerializer(p).data
    out["message"] = " ".join(msgs)
    return Response(out)


@mgmt_api(["POST"])
def staff_review(request, pk, decision):
    """Supervisor verifies employees; super admin verifies managers & supervisors; admin verifies super admins."""
    a = request.actor
    p = get_object_or_404(StaffProfile.objects.select_related("user", "branch"), pk=pk)
    if p.status != StaffProfile.Status.PENDING:
        raise ValidationError({"detail": "This person isn't waiting for verification."})
    need = staff_need_level(p.role, level_of(p.created_by) if p.created_by else MANAGER) or STAFF_APPROVER_LEVEL[p.role]
    if a.level < need:
        raise PermissionDenied(f"Only a {LEVEL_NAME[need]} or higher can verify a {p.get_role_display()}.")
    if not _can_manage(a, p) and a.level < ADMIN:
        raise PermissionDenied("You don't have access to this person's store.")
    if p.created_by_id == request.user.id and a.level < ADMIN:
        raise PermissionDenied("Someone else has to verify a person you added.")
    approve = decision == "approve"
    p.status = StaffProfile.Status.ACTIVE if approve else StaffProfile.Status.REJECTED
    p.reviewed_by, p.reviewed_at = request.user, timezone.now()
    p.review_note = (request.data.get("note") or "")[:255]
    p.save()
    audit.log(request.user, "verified" if approve else "rejected", "staff", p, branch=p.branch_id,
              summary=f"{'Verified' if approve else 'Rejected'} {p.name}" + (f" — {p.review_note}" if p.review_note else ""))
    if p.created_by:
        notify([p.created_by], f"{p.name} was {'verified' if approve else 'rejected'}",
               f"By {a.name}. {p.review_note}".strip(), "/manage/staff")
    return Response(StaffSerializer(p).data)


@mgmt_api(["POST"])
def staff_set_active(request, pk):
    a = request.actor
    p = get_object_or_404(_staff_scope(a), pk=pk)
    if not _can_manage(a, p):
        raise PermissionDenied("You can't change this person.")
    active = bool(request.data.get("active"))
    if active and p.status == StaffProfile.Status.PENDING:
        raise ValidationError({"detail": "This person still needs to be verified."})
    p.status = StaffProfile.Status.ACTIVE if active else StaffProfile.Status.INACTIVE
    p.save(update_fields=["status"])
    if not active:
        from rest_framework.authtoken.models import Token
        Token.objects.filter(user=p.user).delete()  # sign them out everywhere
    return Response(StaffSerializer(p).data)


# =================================================================== time clock & payroll

def _entries(a, request):
    qs = TimeEntry.objects.select_related("staff__user", "branch", "edited_by")
    visible = _staff_scope(a).values("id")
    qs = qs.filter(staff_id__in=visible)
    if b := _branch_param(request):
        check_branch(a, b)
        qs = qs.filter(branch_id=b)
    return qs


@mgmt_api(["GET", "POST"])
def time_entries(request):
    a = request.actor
    require(a, MANAGER, "see hours")
    if request.method == "POST":
        s = TimeEntrySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        target = s.validated_data["staff"]
        if not _can_manage(a, target):
            raise PermissionDenied("You can't add hours for yourself or for someone at or above your role.")
        check_branch(a, s.validated_data["branch"].id)
        reason = _reason(request)
        cr = changes.submit(a, "time.add", branch=s.validated_data["branch"], reason=reason,
                            payload=jsonable({**s.validated_data, "note": reason}),
                            summary=f"Add shift for {target.name}: {_fmt_dt(s.validated_data['clock_in'])}")
        return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data, status=201)
    start, end = _dates(request)
    qs = _entries(a, request).filter(clock_in__date__gte=start, clock_in__date__lte=end)
    if sid := request.query_params.get("staff"):
        qs = qs.filter(staff_id=sid)
    return Response(TimeEntrySerializer(qs[:1000], many=True).data)


@mgmt_api(["PATCH", "DELETE"])
def time_entry_detail(request, pk):
    a = request.actor
    require(a, MANAGER, "edit hours")
    e = get_object_or_404(_entries(a, request), pk=pk)
    if not _can_manage(a, e.staff):
        raise PermissionDenied("Nobody can change their own clock-ins. Ask someone in a higher role.")
    reason = _reason(request)
    if request.method == "DELETE":
        cr = changes.submit(a, "time.delete", target=e, branch=e.branch_id, reason=reason, payload={"_delete": True},
                            before=audit.snapshot(e, ["clock_in", "clock_out", "tips"]),
                            summary=f"Delete shift of {e.staff.name} on {_fmt_dt(e.clock_in)}")
        return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)
    s = TimeEntrySerializer(e, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    fields = {k: v for k, v in s.validated_data.items() if k in ("clock_in", "clock_out", "tips")}
    cr = changes.submit(a, "time.edit", target=e, branch=e.branch_id, reason=reason,
                        payload=jsonable({**fields, "note": reason}),
                        before=audit.snapshot(e, ["clock_in", "clock_out", "tips", "note"]),
                        summary=f"Fix shift of {e.staff.name} on {_fmt_dt(e.clock_in)}")
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)


def _reason(request, key_only: bool = False) -> str:
    d = request.data
    r = (d.get("change_reason") or ("" if key_only else (d.get("reason") or d.get("note"))) or "").strip()
    if not r:
        raise ValidationError({"reason": "Say why this is being changed."})
    return r[:255]


def _fmt_dt(v) -> str:
    return timezone.localtime(v).strftime("%b %d %I:%M %p") if v else "—"


def jsonable(d: dict) -> dict:
    """Validated data → plain JSON (ids for records, strings for money & dates)."""
    import datetime as _dt
    from django.db.models import Model as _M
    out = {}
    for k, v in d.items():
        if isinstance(v, _M):
            v = v.pk
        elif isinstance(v, (Decimal, _dt.date, _dt.datetime, _dt.time)):
            v = v.isoformat() if hasattr(v, "isoformat") else str(v)
            if isinstance(d[k], Decimal):
                v = str(d[k])
        elif isinstance(v, (list, tuple)) and v and isinstance(v[0], _M):
            v = [x.pk for x in v]
        out[k] = v
    return out


@mgmt_api(["GET"])
def payroll(request):
    a = request.actor
    require(a, MANAGER, "see wages")
    if not request.query_params.get("from"):
        start, end = reports.week_bounds(timezone.localdate())
    else:
        start, end = _dates(request)
    profiles = _staff_scope(a).exclude(status__in=["pending", "rejected"])
    if b := _branch_param(request):
        check_branch(a, b)
        profiles = profiles.filter(branch_id=b)
    rows = reports.payroll(TimeEntry.objects.filter(staff__in=profiles), profiles, start, end)

    if request.query_params.get("export") == "csv":
        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="payroll_{start}_{end}.csv"'
        w = csv.writer(resp)
        cols = ["employee_id", "name", "role", "branch", "pay_type", "pay_method", "rate", "weekly_salary", "shifts",
                "hours", "regular_hours", "overtime_hours", "regular_pay", "overtime_pay", "tips", "gross_pay"]
        w.writerow(cols)
        for r in rows:
            w.writerow([r[c] for c in cols])
        return resp
    total = sum((Decimal(r["gross_pay"]) for r in rows), Decimal("0"))
    hours = sum((Decimal(r["hours"]) for r in rows), Decimal("0"))
    return Response({"from": start.isoformat(), "to": end.isoformat(), "rows": rows,
                     "total_gross": reports.s(total), "total_hours": str(hours)})


# =================================================================== purchases

def _purchase_scope(a, request):
    qs = Purchase.objects.select_related("branch", "submitted_by", "reviewed_by").prefetch_related("lines")
    return scope(qs, a, branch_param=_branch_param(request))


@mgmt_api(["GET", "POST"])
def purchases(request):
    a = request.actor
    require(a, MANAGER, "see purchases")
    if request.method == "GET":
        start, end = _dates(request) if request.query_params.get("period") or request.query_params.get("from") \
            else (datetime.date(2000, 1, 1), datetime.date(2100, 1, 1))
        qs = _purchase_scope(a, request).filter(purchase_date__gte=start, purchase_date__lte=end)
        if st := request.query_params.get("status"):
            qs = qs.filter(status=st)
        if c := request.query_params.get("category"):
            qs = qs.filter(category=c)
        if v := request.query_params.get("vendor"):
            # a vendor from the list (id), or the typed name of an "Other" vendor
            qs = qs.filter(vendor_ref_id=v) if str(v).isdigit() else qs.filter(vendor__iexact=v)
        return Response(PurchaseSerializer(qs[:500], many=True, context=_ctx(request)).data)
    return _create_purchase(request, a)


def _parse_purchase(request, a, current: Purchase | None = None) -> dict:
    """Validate a purchase form (new or edit). Returns clean fields + lines."""
    d = request.data
    get = lambda k, default=None: d.get(k, default if current is None else getattr(current, k, default))
    branch_id = d.get("branch") or (current.branch_id if current else a.branch_id)
    if not branch_id:
        raise ValidationError({"branch": "Choose a branch."})
    check_branch(a, branch_id)
    vendor_ref = None
    if d.get("vendor_ref"):
        vendor_ref = Vendor.objects.filter(pk=d["vendor_ref"], is_active=True).first()
        if not vendor_ref:
            raise ValidationError({"vendor_ref": "Choose a vendor from the list."})
    vendor = (vendor_ref.name if vendor_ref else (d.get("vendor") or (current.vendor if current else ""))).strip()
    if get("category") not in Purchase.Category.values:
        raise ValidationError({"category": "Choose a category."})
    if not vendor:
        raise ValidationError({"vendor": "Who did you buy from?"})
    reason = (d.get("reason") or (current.reason if current else "")).strip()
    if not reason:
        raise ValidationError({"reason": "Explain why this was bought."})
    raw = d.get("lines")
    try:
        if raw is None and current:
            lines = [{"name": l.name, "quantity": l.quantity, "unit": l.unit, "unit_cost": l.unit_cost} for l in current.lines.all()]
        else:
            raw = json.loads(raw or "[]") if isinstance(raw, str) else (raw or [])
            lines = [{"name": str(l["name"]).strip()[:120], "quantity": Decimal(str(l.get("quantity") or 1)),
                      "unit": str(l.get("unit") or "")[:20], "unit_cost": Decimal(str(l["unit_cost"]))}
                     for l in raw if str(l.get("name", "")).strip()]
        tax = money(Decimal(str(d.get("tax") if d.get("tax") not in (None, "") else (current.tax if current else 0))))
    except (KeyError, ValueError, ArithmeticError, TypeError):
        raise ValidationError({"lines": "Check the items: each needs a name, quantity and price."})
    if not lines:
        raise ValidationError({"lines": "Add at least one item."})
    if any(l["quantity"] <= 0 or l["unit_cost"] < 0 for l in lines):
        raise ValidationError({"lines": "Quantities must be above 0 and prices can't be negative."})
    return {
        "branch_id": int(branch_id), "vendor": vendor[:120], "vendor_ref": vendor_ref,
        "invoice_number": (get("invoice_number", "") or "")[:60], "category": get("category"),
        "purchase_date": get("purchase_date") or timezone.localdate(),
        "paid_with": get("paid_with") or Purchase.PaidWith.COMPANY_CARD, "reason": reason, "lines": lines, "tax": tax,
    }


def _create_purchase(request, a):
    f = _parse_purchase(request, a)
    lines, tax, branch_id = f.pop("lines"), f.pop("tax"), f.pop("branch_id")
    subtotal = money(sum((l["quantity"] * l["unit_cost"] for l in lines), Decimal("0")))

    need = PURCHASE_APPROVER_LEVEL.get(a.level)
    with transaction.atomic():
        p = Purchase.objects.create(
            branch_id=branch_id, receipt=request.FILES.get("receipt"), **f,
            subtotal=subtotal, tax=tax, total=subtotal + tax, submitted_by=request.user,
            status="pending" if need else "approved",
            reviewed_by=None if need else request.user, reviewed_at=None if need else timezone.now(),
            review_note="" if need else "Auto-approved",
        )
        PurchaseLine.objects.bulk_create([PurchaseLine(purchase=p, **l) for l in lines])
    audit.log(request.user, "created", "purchase", p, summary=f"{p.vendor} ${p.total} ({p.get_status_display()})")

    text = f"{p.branch.name} · {p.vendor} · ${p.total} · {p.get_category_display()} — by {a.name}"
    if need:
        # Approvers (admins included) get one notification each.
        notify(users_at_level(need, branch=branch_id), f"Purchase waiting for approval — {LEVEL_NAME[need]}", text,
               "/manage/approvals", exclude=a.user)
    else:
        notify_admins(f"Purchase added by {a.name} (auto-approved)", text, "/manage/purchases", exclude=a.user)
    return Response(PurchaseSerializer(p, context=_ctx(request)).data, status=201)


@mgmt_api(["GET", "PATCH"])
def purchase_detail(request, pk):
    a = request.actor
    require(a, MANAGER, "see purchases")
    p = get_object_or_404(_purchase_scope(a, request), pk=pk)
    if request.method == "GET":
        return Response(PurchaseSerializer(p, context=_ctx(request)).data)
    if not can_edit_entry_of(a, p.submitted_by):
        raise PermissionDenied("You can't edit your own purchase. Someone in a higher role must make the change.")
    f = _parse_purchase(request, a, current=p)
    vref = f.pop("vendor_ref")
    payload = {k: (str(v) if isinstance(v, (Decimal, datetime.date)) else v) for k, v in f.items() if k != "branch_id"}
    payload["lines"] = [{**l, "quantity": str(l["quantity"]), "unit_cost": str(l["unit_cost"])} for l in f["lines"]]
    payload["vendor_ref"] = vref.pk if vref else p.vendor_ref_id
    before = {**audit.snapshot(p, ["vendor", "invoice_number", "category", "paid_with", "purchase_date", "reason", "tax"]),
              "lines": [{"name": l.name, "quantity": str(l.quantity), "unit": l.unit, "unit_cost": str(l.unit_cost)} for l in p.lines.all()]}
    cr = changes.submit(a, "purchase.edit", target=p, branch=p.branch_id, payload=payload, before=before,
                        file=request.FILES.get("receipt"), reason=_reason(request, key_only=True),
                        summary=f"Edit purchase #{p.pk} {p.vendor} ${p.total}")
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)


@mgmt_api(["POST"])
def purchase_review(request, pk, decision):
    a = request.actor
    p = get_object_or_404(Purchase.objects.select_related("branch", "submitted_by"), pk=pk)
    check_branch(a, p.branch_id)
    if p.status != "pending":
        raise ValidationError({"detail": "This purchase was already reviewed."})
    sub = actor_for(p.submitted_by) if p.submitted_by else None
    need = PURCHASE_APPROVER_LEVEL.get(sub.level if sub else MANAGER) or SUPERVISOR
    if a.level < need:
        raise PermissionDenied(f"Only a {LEVEL_NAME[need]} or higher can approve this purchase.")
    if p.submitted_by_id == request.user.id and a.level < ADMIN:
        raise PermissionDenied("You can't approve your own purchase.")
    note = (request.data.get("note") or "").strip()
    if decision == "reject" and not note:
        raise ValidationError({"note": "Say why it's rejected."})
    p.status = "approved" if decision == "approve" else "rejected"
    p.reviewed_by, p.reviewed_at, p.review_note = request.user, timezone.now(), note[:255]
    p.save()
    audit.log(request.user, p.status, "purchase", p, summary=f"{p.status.title()}: {p.vendor} ${p.total}" + (f" — {note}" if note else ""))
    if p.submitted_by:
        notify([p.submitted_by], f"Purchase {p.status}: {p.vendor} ${p.total}",
               f"By {a.name}. {note}".strip(), "/manage/purchases")
    return Response(PurchaseSerializer(p, context=_ctx(request)).data)


# =================================================================== approvals inbox

@mgmt_api(["GET"])
def approvals(request):
    a = request.actor
    pend_p = []
    for p in scope(Purchase.objects.filter(status="pending").select_related("branch", "submitted_by")
                   .prefetch_related("lines"), a):
        sub = actor_for(p.submitted_by) if p.submitted_by else None
        need = PURCHASE_APPROVER_LEVEL.get(sub.level if sub else MANAGER) or SUPERVISOR
        if a.level >= need and (p.submitted_by_id != request.user.id or a.level == ADMIN):
            pend_p.append(p)
    pend_s = [s for s in StaffProfile.objects.filter(status="pending").select_related("user", "branch", "created_by")
              if a.level >= (staff_need_level(s.role, level_of(s.created_by) if s.created_by else MANAGER) or 5)
              and (a.level == ADMIN or _can_manage(a, s))
              and (s.created_by_id != request.user.id or a.level == ADMIN)]
    pend_c = changes.pending_for(a)
    return Response({
        "purchases": PurchaseSerializer(pend_p, many=True, context=_ctx(request)).data,
        "staff": StaffSerializer(pend_s, many=True).data,
        "changes": ChangeRequestSerializer(pend_c, many=True, context=_ctx(request)).data,
        "count": len(pend_p) + len(pend_s) + len(pend_c),
    })


# =================================================================== cash: drops, closing, deposits

@mgmt_api(["GET", "POST"])
def cash_drops(request):
    a = request.actor
    require(a, MANAGER, "handle cash")
    if request.method == "POST":
        s = CashDropSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        br = s.validated_data["branch"]
        check_branch(a, br.id)
        if s.validated_data["kind"] in ("safe_drop", "paid_out"):
            today = timezone.localdate()
            if DailyClose.objects.filter(branch=br, date=today).exists():
                raise ValidationError({"detail": "Today is already closed — the drawer is counted."})
            in_drawer = _close_numbers(br, today)["expected_cash"]
            if s.validated_data["amount"] > in_drawer:
                raise ValidationError({"amount": f"Only ${in_drawer} should be in the drawer right now — "
                                                 f"you can't take out ${s.validated_data['amount']}."})
        drop = s.save(made_by=request.user)
        audit.log(request.user, "created", "cash drop", drop, summary=f"{drop.get_kind_display()} ${drop.amount} {drop.note}")
        return Response(CashDropSerializer(drop).data, status=201)
    start, end = _dates(request)
    qs = scope(CashDrop.objects.select_related("branch", "made_by"), a, branch_param=_branch_param(request))
    qs = qs.filter(created_at__date__gte=start, created_at__date__lte=end)
    return Response(CashDropSerializer(qs, many=True).data)


def safe_cash(branch: Branch, exclude_deposit=None) -> Decimal:
    """Cash sitting in the store's safe, ready to deposit or take out:
    every closed day's "cash to deposit" (+ safe drops on days not closed yet) − cash already deposited / taken out."""
    closes = DailyClose.objects.filter(branch=branch)
    closed_days = closes.values_list("date", flat=True)
    into = (closes.aggregate(t=Sum("cash_to_deposit"))["t"] or Decimal("0")) + (
        CashDrop.objects.filter(branch=branch, kind="safe_drop").exclude(created_at__date__in=closed_days)
        .aggregate(t=Sum("amount"))["t"] or Decimal("0"))
    out = Decimal("0")
    deps = BankDeposit.objects.filter(branch=branch)
    if exclude_deposit:
        deps = deps.exclude(pk=exclude_deposit)
    for amount, cash, checks in deps.values_list("amount", "cash_amount", "check_amount"):
        out += cash if cash is not None else amount - (checks or Decimal("0"))
    return money(into - out)


def _deposit_cash(d: dict) -> Decimal:
    if d.get("cash_amount") is not None:
        return d["cash_amount"]
    return (d.get("amount") or Decimal("0")) - (d.get("check_amount") or Decimal("0"))


def _close_numbers(branch: Branch, day: datetime.date) -> dict:
    orders = Order.objects.filter(branch=branch, created_at__date=day)
    took_money = orders.filter(status__in=Order.SALE_STATUSES + [Order.Status.REFUNDED])

    def total(qs):
        return qs.aggregate(t=Sum("total"))["t"] or Decimal("0")

    cash_sales = method_totals(took_money)["cash"]
    cash_refunds = method_totals(Order.objects.filter(branch=branch, refunded_at__date=day, status="refunded"))["cash"]
    drops = CashDrop.objects.filter(branch=branch, created_at__date=day)
    paid_outs = (drops.filter(kind="paid_out").aggregate(t=Sum("amount"))["t"] or Decimal("0")) + (
        Purchase.objects.filter(branch=branch, purchase_date=day, paid_with="register_cash")
        .exclude(status="rejected").aggregate(t=Sum("total"))["t"] or Decimal("0"))
    paid_ins = drops.filter(kind="paid_in").aggregate(t=Sum("amount"))["t"] or Decimal("0")
    safe = drops.filter(kind="safe_drop").aggregate(t=Sum("amount"))["t"] or Decimal("0")
    opened = DayOpen.objects.filter(branch=branch, date=day).first()
    float_ = opened.opening_float if opened else branch.opening_float
    expected = float_ + cash_sales - cash_refunds - paid_outs + paid_ins - safe
    sales = orders.filter(status__in=Order.SALE_STATUSES)
    by_method = method_totals(sales)
    return {
        "opening_float": money(float_), "cash_sales": money(cash_sales),
        "cash_refunds": money(cash_refunds), "paid_outs": money(paid_outs), "paid_ins": money(paid_ins),
        "safe_drops": money(safe), "expected_cash": money(expected),
        "card_sales": money(by_method["card"]),
        "online_sales": money(by_method["stripe"]),
        "app_sales": money(by_method["partner"]),
        "tips": money(sales.aggregate(t=Sum("tip"))["t"] or 0),
        "total_sales": money(total(sales)),
        "unpaid_kiosk_orders": orders.filter(status="unpaid").count(),
    }


DENOMS = ["100", "50", "20", "10", "5", "2", "1", "0.25", "0.10", "0.05", "0.01"]


@mgmt_api(["GET", "POST"])
def daily_close(request):
    """GET ?branch=&date= → expected numbers (or the saved close). POST → save the counted drawer."""
    a = request.actor
    require(a, MANAGER, "close the day")
    src = request.data if request.method == "POST" else request.query_params
    branch_id = src.get("branch") or a.branch_id
    if not branch_id:
        raise ValidationError({"branch": "Choose a branch."})
    check_branch(a, branch_id)
    branch = get_object_or_404(Branch, pk=branch_id)
    try:
        day = datetime.date.fromisoformat(src.get("date")) if src.get("date") else timezone.localdate()
    except ValueError:
        raise ValidationError({"date": "Use YYYY-MM-DD."})
    existing = DailyClose.objects.filter(branch=branch, date=day).first()

    if request.method == "GET":
        return Response({"numbers": {k: str(v) if not isinstance(v, int) else v
                                     for k, v in _close_numbers(branch, day).items()},
                         "saved": DailyCloseSerializer(existing).data if existing else None,
                         "denominations": DENOMS, "next_float": str(branch.opening_float)})

    if existing:
        raise ValidationError({"detail": "This day is already closed. To fix it, someone in a higher role edits it (it goes for approval)."})
    denoms = request.data.get("denominations") or {}
    try:
        counted = sum((Decimal(k) * int(v or 0) for k, v in denoms.items() if k in DENOMS), Decimal("0"))
    except (ValueError, ArithmeticError):
        raise ValidationError({"denominations": "Counts must be whole numbers."})
    n = _close_numbers(branch, day)
    for k in ("unpaid_kiosk_orders", "app_sales", "tips"):
        n.pop(k, None)
    fields = dict(n, counted_cash=money(counted), denominations=denoms,
                  over_short=money(counted - n["expected_cash"]),
                  cash_to_deposit=money(max(Decimal("0"), counted + n["safe_drops"] - branch.opening_float)),
                  notes=request.data.get("notes", ""), closed_by=request.user)
    close = DailyClose.objects.create(branch=branch, date=day, **fields)
    audit.log(request.user, "created", "daily close", close, summary=f"Closed {branch.name} {day}: counted ${close.counted_cash}, over/short ${close.over_short}")
    if abs(close.over_short) >= Decimal("5"):
        word = "over" if close.over_short > 0 else "short"
        notify(users_at_level(SUPERVISOR), f"Drawer {word} ${abs(close.over_short)} at {branch.name}",
               f"{day} closed by {a.name}.", "/manage/cash", exclude=a.user)
    return Response(DailyCloseSerializer(close).data, status=201)


@mgmt_api(["PATCH"])
def close_edit(request, pk):
    a = request.actor
    c = get_object_or_404(DailyClose.objects.select_related("branch", "closed_by"), pk=pk)
    check_branch(a, c.branch_id)
    if not can_edit_entry_of(a, c.closed_by):
        raise PermissionDenied("You can't edit your own closing. Someone in a higher role must make the change.")
    denoms = request.data.get("denominations")
    payload = {}
    if denoms is not None:
        try:
            payload["denominations"] = {k: int(v or 0) for k, v in denoms.items() if k in DENOMS}
        except (ValueError, AttributeError):
            raise ValidationError({"denominations": "Counts must be whole numbers."})
    if "notes" in request.data:
        payload["notes"] = request.data.get("notes", "")
    if not payload:
        raise ValidationError({"detail": "Nothing to change."})
    counted = sum((Decimal(k) * v for k, v in payload.get("denominations", {}).items()), Decimal("0"))
    cr = changes.submit(a, "close.edit", target=c, branch=c.branch_id, payload=payload, reason=_reason(request),
                        before={"denominations": c.denominations, "notes": c.notes, "counted_cash": str(c.counted_cash)},
                        summary=f"Fix closing {c.branch.name} {c.date}" + (f": counted ${counted:.2f}" if denoms is not None else ""))
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)


@mgmt_api(["GET"])
def daily_closes(request):
    a = request.actor
    require(a, MANAGER, "see closings")
    start, end = _dates(request)
    qs = scope(DailyClose.objects.select_related("branch", "closed_by"), a, branch_param=_branch_param(request))
    return Response(DailyCloseSerializer(qs.filter(date__gte=start, date__lte=end), many=True).data)


@mgmt_api(["GET", "POST"])
def deposits(request):
    a = request.actor
    require(a, MANAGER, "record deposits")
    if request.method == "POST":
        s = BankDepositSerializer(data=request.data, context=_ctx(request))
        s.is_valid(raise_exception=True)
        check_branch(a, s.validated_data["branch"].id)
        avail = safe_cash(s.validated_data["branch"])
        cash_part = _deposit_cash(s.validated_data)
        if cash_part > avail:
            raise ValidationError({"amount": f"Only ${max(avail, Decimal('0'))} cash is in the safe "
                                             f"(closed days + safe drops − earlier deposits). You can't move ${cash_part}."})
        dep = s.save(deposited_by=request.user, slip=request.FILES.get("slip"))
        what = "Deposit" if dep.kind == "deposit" else f"Cash taken out by {dep.taken_by} ({dep.get_purpose_display()})"
        audit.log(request.user, "created", "bank deposit", dep, summary=f"{what} ${dep.amount} on {dep.date}")
        notify(users_at_level(SUPERADMIN), f"{'Bank deposit' if dep.kind == 'deposit' else 'Cash taken out'} ${dep.amount} — {dep.branch.name}",
               f"Recorded by {a.name}.", "/manage/cash", exclude=a.user)
        return Response(BankDepositSerializer(dep, context=_ctx(request)).data, status=201)
    start, end = _dates(request)
    qs = scope(BankDeposit.objects.select_related("branch", "deposited_by", "verified_by"), a,
               branch_param=_branch_param(request)).filter(date__gte=start, date__lte=end)
    data = BankDepositSerializer(qs, many=True, context=_ctx(request)).data
    if request.query_params.get("with_safe"):
        b = _branch_param(request) or a.branch_id
        safe = None
        if b:
            check_branch(a, b)
            safe = str(max(safe_cash(get_object_or_404(Branch, pk=b)), Decimal("0")))
        return Response({"items": data, "in_safe": safe})
    return Response(data)


@mgmt_api(["PATCH"])
def deposit_edit(request, pk):
    """Only super admins and admins change deposits; a super admin's change needs the admin."""
    a = request.actor
    require(a, SUPERADMIN, "change bank deposits")
    d = get_object_or_404(BankDeposit, pk=pk)
    check_branch(a, d.branch_id)
    s = BankDepositSerializer(d, data=request.data, partial=True, context=_ctx(request))
    s.is_valid(raise_exception=True)
    new = {"amount": s.validated_data.get("amount", d.amount),
           "cash_amount": s.validated_data.get("cash_amount", d.cash_amount),
           "check_amount": s.validated_data.get("check_amount", d.check_amount)}
    avail = safe_cash(d.branch, exclude_deposit=d.pk)
    if _deposit_cash(new) > avail:
        raise ValidationError({"amount": f"Only ${max(avail, Decimal('0'))} cash is in the safe for this deposit."})
    payload = jsonable({k: v for k, v in s.validated_data.items() if k != "branch"})
    cr = changes.submit(a, "deposit.edit", target=d, branch=d.branch_id, payload=payload, file=request.FILES.get("slip"),
                        before=audit.snapshot(d, list(payload.keys())), reason=_reason(request),
                        summary=f"Edit deposit {d.date} ${d.amount} ({d.branch.name})")
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data)


@mgmt_api(["POST"])
def deposit_verify(request, pk):
    a = request.actor
    require(a, SUPERVISOR, "verify deposits")
    d = get_object_or_404(BankDeposit, pk=pk)
    check_branch(a, d.branch_id)
    d.verified_by, d.verified_at = request.user, timezone.now()
    d.save(update_fields=["verified_by", "verified_at"])
    audit.log(request.user, "verified", "bank deposit", d, summary=f"Verified deposit ${d.amount} on {d.date}")
    return Response(BankDepositSerializer(d, context=_ctx(request)).data)


# =================================================================== notifications

@mgmt_api(["GET"])
def notifications(request):
    qs = Notification.objects.filter(recipient=request.user)
    if request.query_params.get("unread") == "1":
        qs = qs.filter(is_read=False)
    return Response({"unread": Notification.objects.filter(recipient=request.user, is_read=False).count(),
                     "items": NotificationSerializer(qs[:100], many=True).data})


@mgmt_api(["POST"])
def notification_mark(request, pk):
    n = get_object_or_404(Notification, pk=pk, recipient=request.user)
    n.is_read = bool(request.data.get("read", True))
    n.save(update_fields=["is_read"])
    return Response(NotificationSerializer(n).data)


@mgmt_api(["POST"])
def notifications_read_all(request):
    Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
    return Response({"ok": True})


# =================================================================== reports

@mgmt_api(["GET"])
def summary(request):
    """Branch dashboard: sales, purchases, labor, cash. Managers: own branch; supervisors+: both or one."""
    a = request.actor
    require(a, MANAGER, "see reports")
    start, end = _dates(request)
    b = _branch_param(request)
    orders = scope(Order.objects.all(), a, branch_param=b)
    out = {"sales": reports.sales_summary(orders, start, end),
           "purchases": reports.purchases_summary(scope(Purchase.objects.all(), a, branch_param=b), start, end)}
    profiles = scope(StaffProfile.objects.select_related("user", "branch"), a, branch_param=b) \
        .exclude(status__in=["pending", "rejected"])
    out["labor"] = reports.s(reports.labor_cost(TimeEntry.objects.filter(staff__in=profiles), profiles, start, end))
    closes = scope(DailyClose.objects.all(), a, branch_param=b).filter(date__gte=start, date__lte=end)
    out["cash"] = {"closes": closes.count(),
                   "over_short": reports.s(closes.aggregate(t=Sum("over_short"))["t"]),
                   "to_deposit": reports.s(closes.aggregate(t=Sum("cash_to_deposit"))["t"])}
    if a.multi_branch and not b:
        out["branches"] = [
            {"id": br.id, "name": br.name,
             **{k: v for k, v in reports.sales_summary(Order.objects.filter(branch=br), start, end).items()
                if k in ("orders", "gross", "net", "average_order", "discounts")}}
            for br in (Branch.objects.filter(is_active=True) if a.branch_ids is None
                       else Branch.objects.filter(is_active=True, pk__in=a.branch_ids))
        ]
    return Response(out)


@mgmt_api(["GET"])
def profit_and_loss(request):
    """Super admin & admin: final report — revenue, costs, labor, profit, margins, deposits, per branch."""
    a = request.actor
    require(a, SUPERADMIN, "see profit & loss")
    start, end = _dates(request)

    def pnl(name, orders, purchases, profiles, entries, f=None):
        from .views_bills import app_days_total, bills_total
        sales = reports.sales_summary(orders, start, end)
        pur = reports.purchases_summary(purchases, start, end)
        labor = reports.labor_cost(entries, profiles, start, end)
        bills, bills_tax = bills_total(start, end, f if f is not None else {"branch__isnull": True})
        app = app_days_total(start, end, f) if f is not None else app_days_total(start, end, {"pk__in": []})
        app_sales = app["s"] - app["adj"]
        net = Decimal(sales["net"]) + app_sales
        cogs, exp = Decimal(pur["cogs"]), Decimal(pur["expenses"])
        app_fees = Decimal(sales["app_fees"]) + app["f"]
        gross_profit = net - cogs
        profit = gross_profit - exp - bills - labor - app_fees
        pct = lambda x: str((x / net * 100).quantize(Decimal("0.1"))) if net else "0.0"
        return {
            "name": name, "orders": sales["orders"] + app["n"], "gross_sales": reports.s(Decimal(sales["gross"]) + app["s"] + app["t"]),
            "discounts": sales["discounts"], "refunds": sales["refunds"]["total"], "net_sales": reports.s(net),
            "app_sales": reports.s(app_sales), "tax_collected": reports.s(Decimal(sales["tax"]) + app["t"] - app["app_t"]),
            "cogs": pur["cogs"], "expenses": pur["expenses"], "bills": reports.s(bills), "labor": reports.s(labor),
            "app_fees": reports.s(app_fees), "tips": sales["tips"], "by_app": sales["by_app"],
            "gross_profit": reports.s(gross_profit), "net_profit": reports.s(profit),
            "profit_margin": pct(profit), "food_cost_pct": pct(cogs), "labor_cost_pct": pct(labor),
            "prime_cost_pct": pct(cogs + labor),
            "by_category": pur["by_category"], "by_day": sales["by_day"],
        }

    def cash(block, f):
        """Cash closings & deposits for a branch filter (f=None → head office, which handles no cash)."""
        deps = BankDeposit.objects.none() if f is None else BankDeposit.objects.filter(**f, date__gte=start, date__lte=end)
        closes = DailyClose.objects.none() if f is None else DailyClose.objects.filter(**f, date__gte=start, date__lte=end)
        block.update({
            "cash_to_deposit": reports.s(closes.aggregate(t=Sum("cash_to_deposit"))["t"]),
            "deposited": reports.s(deps.aggregate(t=Sum("amount"))["t"]),
            "deposits_unverified": deps.filter(verified_at__isnull=True).count(),
            "over_short": reports.s(closes.aggregate(t=Sum("over_short"))["t"]),
        })
        return block

    staff = StaffProfile.objects.exclude(status__in=["pending", "rejected"])
    blocks = [cash(pnl(b.name, Order.objects.filter(branch=b), Purchase.objects.filter(branch=b),
                       staff.filter(branch=b), TimeEntry.objects.filter(staff__branch=b), {"branch": b}), {"branch": b})
              for b in Branch.objects.filter(is_active=True)]
    # Salaried supervisors / super admins / admins aren't tied to one branch → "Head office" column,
    # so every column adds up to the total.
    hq = staff.filter(branch__isnull=True)
    from .models import Bill
    if hq.exists() or Bill.objects.filter(branch__isnull=True).exists():
        blocks.append(cash(pnl("Head office", Order.objects.none(), Purchase.objects.none(), hq,
                               TimeEntry.objects.filter(staff__in=hq)), None))
    total = cash(pnl("All branches", Order.objects.all(), Purchase.objects.all(), staff, TimeEntry.objects.all(), {}), {})
    return Response({"from": start.isoformat(), "to": end.isoformat(), "total": total, "branches": blocks})
