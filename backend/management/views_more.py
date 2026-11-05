"""Back office (part 2): vendors, job titles, approvals & history, menu / offers / TV screens,
pay statements, devices, messages and each person's own profile."""
import datetime
import json
from decimal import Decimal

from django.db import transaction
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from menu.models import Category, MenuItem, Promotion
from menu.serializers import AbsoluteImageField
from orders.pricing import active_promotions, money

from . import audit, changes, reports
from .access import ADMIN, MANAGER, SUPERADMIN, SUPERVISOR, check_branch, notify, require, scope
from .models import (
    LEVEL,
    AuditLog,
    Branch,
    ChangeRequest,
    JobTitle,
    MenuBoard,
    Message,
    MessageAttachment,
    MessageRecipient,
    PayStatement,
    Role,
    StaffProfile,
    Terminal,
    TimeEntry,
    Vendor,
)
from .serializers import (
    AuditLogSerializer,
    ChangeRequestSerializer,
    JobTitleSerializer,
    MenuBoardSerializer,
    MessageSerializer,
    PayStatementSerializer,
    StaffSerializer,
    TerminalSerializer,
    VendorSerializer,
    _file_url,
)
from .views import _can_manage, _ctx, _dates, _reason, _staff_scope, jsonable, mgmt_api


def _data(request):
    return request.data.copy() if hasattr(request.data, "copy") else dict(request.data)


def _cr(request, cr, code=200):
    return Response(ChangeRequestSerializer(cr, context=_ctx(request)).data, status=code)


# =================================================================== vendors

@mgmt_api(["GET", "POST"])
def vendors(request):
    a = request.actor
    require(a, MANAGER, "see vendors")
    if request.method == "GET":
        qs = Vendor.objects.all() if request.query_params.get("all") == "1" else Vendor.objects.filter(is_active=True)
        from django.db.models import Count, Max, Sum
        from .models import Purchase
        today = timezone.localdate()
        bought = scope(Purchase.objects.filter(status="approved", vendor_ref__isnull=False), a)
        stats = {r["vendor_ref"]: r for r in bought.values("vendor_ref").annotate(
            n=Count("id"), all_time=Sum("total"), last=Max("purchase_date"),
            month=Sum("total", filter=Q(purchase_date__year=today.year, purchase_date__month=today.month)),
            year=Sum("total", filter=Q(purchase_date__year=today.year)))}
        out = []
        for v in VendorSerializer(qs, many=True).data:
            st = stats.get(v["id"], {})
            out.append({**v, "purchases": st.get("n", 0), "spent_total": str(st.get("all_time") or "0.00"),
                        "spent_month": str(st.get("month") or "0.00"), "spent_year": str(st.get("year") or "0.00"),
                        "last_purchase": st.get("last")})
        return Response(out)
    s = VendorSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    cr = changes.submit(a, "vendor.create", payload=jsonable(s.validated_data), summary=f"New vendor: {s.validated_data['name']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def vendor_detail(request, pk):
    a = request.actor
    v = get_object_or_404(Vendor, pk=pk)
    s = VendorSerializer(v, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    cr = changes.submit(a, "vendor.edit", target=v, payload=payload, before=audit.snapshot(v, payload.keys()),
                        reason=_why(request), summary=f"Edit vendor: {v.name}")
    return _cr(request, cr)


# =================================================================== job titles

@mgmt_api(["GET", "POST"])
def job_titles(request):
    if request.method == "POST":
        require(request.actor, SUPERADMIN, "add job titles")
        name = (request.data.get("name") or "").strip()[:60]
        if not name:
            raise ValidationError({"name": "Type a job title."})
        t, made = JobTitle.objects.get_or_create(name=name, defaults={"created_by": request.user})
        if made:
            audit.log(request.user, "created", "job title", t, summary=f"Job title '{name}'")
        return Response(JobTitleSerializer(t).data, status=201)
    return Response(JobTitleSerializer(JobTitle.objects.all(), many=True).data)


# =================================================================== approvals (change requests) & history

@mgmt_api(["GET"])
def change_list(request):
    """?status=pending|approved|rejected  &mine=1 (things I submitted)."""
    a = request.actor
    qs = ChangeRequest.objects.select_related("submitted_by", "reviewed_by", "branch")
    if request.query_params.get("mine") == "1":
        qs = qs.filter(submitted_by=request.user)
    elif a.level < ADMIN:
        qs = qs.filter(Q(submitted_by=request.user) | Q(branch_id__in=a.branch_ids or []) | Q(branch__isnull=True, need_level__lte=a.level))
    if st := request.query_params.get("status"):
        qs = qs.filter(status=st)
    if k := request.query_params.get("kind"):
        qs = qs.filter(kind__startswith=k)
    return Response(ChangeRequestSerializer(qs[:300], many=True, context=_ctx(request)).data)


@mgmt_api(["POST"])
def change_review(request, pk, decision):
    cr = get_object_or_404(ChangeRequest, pk=pk)
    cr = changes.review(request.actor, cr, decision == "approve", request.data.get("note") or "")
    return _cr(request, cr)


@mgmt_api(["GET"])
def history(request):
    """Everything that happened, newest first. ?model=purchase&object_id=12&branch=&from=&to=&q="""
    a = request.actor
    require(a, MANAGER, "see history")
    qs = AuditLog.objects.select_related("actor", "approved_by", "branch")
    if a.level < ADMIN:
        qs = qs.filter(Q(branch_id__in=a.branch_ids or []) | Q(actor=request.user))
    p = request.query_params
    if b := p.get("branch"):
        check_branch(a, b)
        qs = qs.filter(branch_id=b)
    if m := p.get("model"):
        qs = qs.filter(model=m)
    if oid := p.get("object_id"):
        qs = qs.filter(object_id=oid)
    if p.get("from") or p.get("period"):
        start, end = _dates(request)
        qs = qs.filter(created_at__date__gte=start, created_at__date__lte=end)
    if q := p.get("q", "").strip():
        qs = qs.filter(Q(summary__icontains=q) | Q(actor__first_name__icontains=q) | Q(actor__username__icontains=q))
    return Response(AuditLogSerializer(qs[:500], many=True).data)


# =================================================================== menu (supervisor and up, role-wise approval)

class ManageItemSerializer(serializers.ModelSerializer):
    image = AbsoluteImageField(read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    option_groups = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = ["id", "name", "category", "category_name", "price", "description", "emoji", "image", "is_available",
                  "is_featured", "is_spicy", "is_vegetarian", "calories", "sort_order", "option_groups"]

    def get_option_groups(self, o):
        return [{"id": g.id, "name": g.name, "required": g.required, "min_select": g.min_select, "max_select": g.max_select,
                 "options": [{"id": x.id, "name": x.name, "price_delta": str(x.price_delta), "is_available": x.is_available}
                             for x in g.options.all()]}
                for g in o.option_groups.all()]


def _option_groups(request):
    """Validate the option groups sent with a menu item (JSON text in a form, or a list)."""
    raw = request.data.get("option_groups")
    if raw in (None, ""):
        return None
    try:
        groups = json.loads(raw) if isinstance(raw, str) else raw
        out = []
        for g in groups:
            name = str(g.get("name") or "").strip()
            opts = [{"id": o.get("id"), "name": str(o.get("name") or "").strip(), "price_delta": str(Decimal(str(o.get("price_delta") or 0))),
                     "is_available": o.get("is_available", True) is not False} for o in (g.get("options") or []) if str(o.get("name") or "").strip()]
            if not name or not opts:
                raise ValueError
            mx = max(1, int(g.get("max_select") or 1))
            out.append({"id": g.get("id"), "name": name[:80], "required": bool(g.get("required")),
                        "min_select": min(mx, int(g.get("min_select") or (1 if g.get("required") else 0))), "max_select": mx, "options": opts})
        return out
    except (TypeError, ValueError, ArithmeticError, AttributeError):
        raise ValidationError({"option_groups": "Each option group needs a name and at least one option with a price (0 is fine)."})


class ManageCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "emoji", "sort_order", "is_active"]
        read_only_fields = ["slug"]


@mgmt_api(["GET"])
def menu_manage(request):
    require(request.actor, MANAGER, "see the menu")
    cats = Category.objects.prefetch_related(Prefetch("items", queryset=MenuItem.objects.order_by("sort_order", "name")
                                                      .prefetch_related("option_groups__options")))
    return Response([{**ManageCategorySerializer(c).data,
                      "items": ManageItemSerializer(c.items.all(), many=True, context=_ctx(request)).data} for c in cats])


def _bool_fix(data):
    for k in ("is_available", "is_featured", "is_spicy", "is_vegetarian", "is_active"):
        if k in data and isinstance(data[k], str):
            data[k] = data[k].lower() in ("1", "true", "on", "yes")
    return data


@mgmt_api(["POST"])
def menu_item_create(request):
    s = ManageItemSerializer(data=_bool_fix(_data(request)))
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    if (groups := _option_groups(request)) is not None:
        payload["option_groups"] = groups
    cr = changes.submit(request.actor, "menu_item.create", payload=payload, file=request.FILES.get("image"),
                        summary=f"New menu item: {s.validated_data['name']} ${s.validated_data['price']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def menu_item_edit(request, pk):
    item = get_object_or_404(MenuItem, pk=pk)
    s = ManageItemSerializer(item, data=_bool_fix(_data(request)), partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    before = audit.snapshot(item, payload.keys())
    if (groups := _option_groups(request)) is not None:
        payload["option_groups"] = groups
        before["option_groups"] = ManageItemSerializer(item).data["option_groups"]
    what = f" price ${item.price} → ${payload['price']}" if "price" in payload and Decimal(payload["price"]) != item.price else ""
    cr = changes.submit(request.actor, "menu_item.edit", target=item, payload=payload, file=request.FILES.get("image"),
                        before=before, reason=_why(request), summary=f"Edit {item.name}{what}")
    return _cr(request, cr)


@mgmt_api(["POST"])
def category_create(request):
    s = ManageCategorySerializer(data=_bool_fix(_data(request)))
    s.is_valid(raise_exception=True)
    cr = changes.submit(request.actor, "category.create", payload=jsonable(s.validated_data),
                        summary=f"New menu section: {s.validated_data['name']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def category_edit(request, pk):
    c = get_object_or_404(Category, pk=pk)
    s = ManageCategorySerializer(c, data=_bool_fix(_data(request)), partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    cr = changes.submit(request.actor, "category.edit", target=c, payload=payload,
                        before=audit.snapshot(c, payload.keys()), reason=_why(request), summary=f"Edit menu section: {c.name}")
    return _cr(request, cr)


def _why(request) -> str:
    return str(request.data.get("change_reason") or "")[:255]


# =================================================================== offers (promotions)

class PromotionSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", default=None, read_only=True)
    item_names = serializers.SerializerMethodField()
    branch_names = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = Promotion
        fields = ["id", "name", "description", "kind", "kind_display", "value", "applies_to", "category", "category_name",
                  "items", "item_names", "days", "start_time", "end_time", "start_date", "end_date", "branches",
                  "branch_names", "channels", "code", "is_active"]
        extra_kwargs = {"items": {"required": False}, "branches": {"required": False}}

    def get_item_names(self, o):
        return [i.name for i in o.items.all()]

    def get_branch_names(self, o):
        return [b.name for b in o.branches.all()]

    def validate(self, d):
        kind = d.get("kind", getattr(self.instance, "kind", "percent"))
        value = d.get("value", getattr(self.instance, "value", None))
        if value is None or value <= 0:
            raise serializers.ValidationError({"value": "Enter the discount."})
        if kind == "percent" and value > 100:
            raise serializers.ValidationError({"value": "A % discount can't be over 100."})
        applies = d.get("applies_to", getattr(self.instance, "applies_to", "all"))
        if applies == "category" and not d.get("category", getattr(self.instance, "category", None)):
            raise serializers.ValidationError({"category": "Choose the menu section."})
        if applies == "items" and not d.get("items") and not (self.instance and self.instance.items.exists()):
            raise serializers.ValidationError({"items": "Choose at least one item."})
        days = d.get("days")
        if days is not None and (not isinstance(days, list) or any(x not in range(7) for x in days)):
            raise serializers.ValidationError({"days": "Days must be 0 (Mon) to 6 (Sun)."})
        ch = d.get("channels")
        if ch is not None and any(c not in ("online", "pos", "kiosk") for c in ch):
            raise serializers.ValidationError({"channels": "Use online, pos and/or kiosk."})
        if "code" in d:
            d["code"] = (d["code"] or "").strip().upper()
        return d


@mgmt_api(["GET", "POST"])
def promotions(request):
    a = request.actor
    require(a, MANAGER, "see offers")
    if request.method == "GET":
        qs = Promotion.objects.select_related("category").prefetch_related("items", "branches")
        return Response(PromotionSerializer(qs, many=True).data)
    s = PromotionSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    for b in s.validated_data.get("branches", []):
        check_branch(a, b.pk)
    cr = changes.submit(a, "promotion.create", payload=jsonable(s.validated_data), summary=f"New offer: {s.validated_data['name']}")
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def promotion_detail(request, pk):
    a = request.actor
    p = get_object_or_404(Promotion, pk=pk)
    s = PromotionSerializer(p, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    before = audit.snapshot(p, [k for k in payload if k not in ("items", "branches")])
    cr = changes.submit(a, "promotion.edit", target=p, payload=payload, before=before, reason=_why(request), summary=f"Edit offer: {p.name}")
    return _cr(request, cr)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def offers_now(request):
    """Offers running right now (for the website banner and TV screens). Code-only offers are hidden."""
    ps = active_promotions(request.query_params.get("branch") or None, request.query_params.get("channel", "online"))
    return Response([{"id": p.id, "name": p.name, "description": p.description, "kind": p.kind, "value": str(p.value),
                      "applies_to": p.applies_to, "category": p.category.name if p.category else None,
                      "items": [i.name for i in p.items.all()],
                      "until": p.end_time.strftime("%-I:%M %p") if p.end_time else None} for p in ps if not p.code])


# =================================================================== TV screens

def _board_scope(a):
    qs = MenuBoard.objects.select_related("branch")
    if a.branch_ids is None:
        return qs
    return qs.filter(Q(branch_id__in=a.branch_ids) | Q(branch__isnull=True))


@mgmt_api(["GET", "POST"])
def boards(request):
    a = request.actor
    require(a, MANAGER, "manage TV screens")
    if request.method == "GET":
        return Response(MenuBoardSerializer(_board_scope(a), many=True).data)
    data = _data(request)
    if a.level == MANAGER:
        data["branch"] = a.branch_id
    s = MenuBoardSerializer(data=data)
    s.is_valid(raise_exception=True)
    b = s.validated_data.get("branch")
    if b:
        check_branch(a, b.pk)
    elif a.level < SUPERADMIN:
        raise PermissionDenied("Choose a store for this screen.")
    cr = changes.submit(a, "board.create", branch=b, payload=jsonable(s.validated_data),
                        summary=f"New TV screen: {s.validated_data['name']}" + (f" ({b.name})" if b else ""))
    return _cr(request, cr, 201)


@mgmt_api(["PATCH"])
def board_detail(request, pk):
    a = request.actor
    require(a, MANAGER, "manage TV screens")
    board = get_object_or_404(_board_scope(a), pk=pk)
    if board.branch_id is None and a.level < SUPERADMIN:
        raise PermissionDenied("Only a super admin can change screens shared by every store.")
    data = _data(request)
    if a.level == MANAGER:
        data.pop("branch", None)
    s = MenuBoardSerializer(board, data=data, partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable(s.validated_data)
    cr = changes.submit(a, "board.edit", target=board, branch=board.branch_id, payload=payload,
                        before=audit.snapshot(board, payload.keys()), reason=_why(request), summary=f"Edit TV screen: {board.name}")
    return _cr(request, cr)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def board_public(request, pk):
    b = get_object_or_404(MenuBoard, pk=pk, is_active=True)
    return Response(MenuBoardSerializer(b).data)


# =================================================================== pay statements (earnings history)

def _pay_scope(a):
    return PayStatement.objects.select_related("staff__user", "created_by", "reviewed_by").filter(staff__in=_staff_scope(a))


@mgmt_api(["GET", "POST"])
def pay_statements(request):
    """GET: list. POST (super admin / admin): record a paid pay period for everyone in the payroll."""
    a = request.actor
    require(a, MANAGER, "see pay")
    if request.method == "GET":
        qs = _pay_scope(a)
        if sid := request.query_params.get("staff"):
            qs = qs.filter(staff_id=sid)
        if st := request.query_params.get("status"):
            qs = qs.filter(status=st)
        return Response(PayStatementSerializer(qs[:500], many=True).data)

    require(a, SUPERADMIN, "record pay")
    try:
        start = datetime.date.fromisoformat(request.data["from"])
        end = datetime.date.fromisoformat(request.data["to"])
    except (KeyError, ValueError):
        raise ValidationError({"from": "Give the pay period dates."})
    profiles = _staff_scope(a).filter(status="active")
    if ids := request.data.get("staff"):
        profiles = profiles.filter(pk__in=ids)
    rows = reports.payroll(TimeEntry.objects.filter(staff__in=profiles), profiles, start, end)
    approved = a.level >= ADMIN
    made = []
    with transaction.atomic():
        for r in rows:
            if Decimal(r["gross_pay"]) <= 0 and Decimal(r["tips"]) <= 0:
                continue
            prof = profiles.get(pk=r["staff_id"])
            st, created = PayStatement.objects.get_or_create(staff=prof, period_start=start, period_end=end, defaults=dict(
                regular_hours=Decimal(r["regular_hours"]), overtime_hours=Decimal(r["overtime_hours"]), rate=prof.hourly_rate,
                regular_pay=Decimal(r["regular_pay"]), overtime_pay=Decimal(r["overtime_pay"]), tips=Decimal(r["tips"]),
                gross_pay=Decimal(r["gross_pay"]), paid_on=request.data.get("paid_on") or timezone.localdate(), is_paid=True,
                paid_amount=Decimal(r["gross_pay"]), payments=[{"method": prof.pay_method, "amount": r["gross_pay"], "reference": ""}],
                pay_method=prof.pay_method,
                created_by=request.user, status="approved" if approved else "pending",
                reviewed_by=request.user if approved else None, reviewed_at=timezone.now() if approved else None))
            if created:
                made.append(st)
    audit.log(request.user, "created", "pay statement", summary=f"Recorded pay {start}–{end} for {len(made)} people")
    if made and not approved:
        from .access import users_at_level
        notify(users_at_level(ADMIN), "Pay statements to verify", f"{len(made)} statements for {start}–{end} by {a.name}",
               "/manage/approvals", exclude=a.user)
    return Response(PayStatementSerializer(made, many=True).data, status=201)


@mgmt_api(["POST"])
def pay_review(request, pk, decision):
    a = request.actor
    require(a, ADMIN, "verify pay statements")
    st = get_object_or_404(PayStatement, pk=pk, status="pending")
    st.status = "approved" if decision == "approve" else "rejected"
    st.reviewed_by, st.reviewed_at = request.user, timezone.now()
    st.save()
    audit.log(request.user, st.status, "pay statement", st, summary=f"{st.status.title()} pay {st.period_start}–{st.period_end} for {st.staff.name}")
    return Response(PayStatementSerializer(st).data)


@mgmt_api(["PATCH"])
def pay_edit(request, pk):
    a = request.actor
    require(a, SUPERADMIN, "change pay statements")
    st = get_object_or_404(_pay_scope(a), pk=pk)
    s = PayStatementSerializer(st, data=request.data, partial=True)
    s.is_valid(raise_exception=True)
    payload = jsonable({k: v for k, v in s.validated_data.items() if k != "staff"})
    cr = changes.submit(a, "pay.edit", target=st, payload=payload, before=audit.snapshot(st, payload.keys()),
                        reason=_reason(request), summary=f"Edit pay {st.period_start}–{st.period_end} for {st.staff.name}")
    return _cr(request, cr)


# =================================================================== devices & sign-out

@mgmt_api(["GET"])
def devices(request):
    a = request.actor
    require(a, MANAGER, "see devices")
    return Response(TerminalSerializer(scope(Terminal.objects.select_related("branch", "registered_by", "last_user"), a), many=True).data)


@mgmt_api(["PATCH"])
def device_detail(request, pk):
    a = request.actor
    require(a, MANAGER, "manage devices")
    t = get_object_or_404(Terminal, pk=pk)
    check_branch(a, t.branch_id)
    t.is_active = bool(request.data.get("is_active"))
    if "name" in request.data:
        t.name = str(request.data["name"])[:80]
    t.save()
    audit.log(request.user, "updated", "device", t, summary=f"Device '{t.name}' {'enabled' if t.is_active else 'blocked'}")
    return Response(TerminalSerializer(t).data)


@mgmt_api(["POST"])
def staff_signout(request, pk):
    """Sign someone out of every device right away."""
    a = request.actor
    p = get_object_or_404(_staff_scope(a), pk=pk)
    if not _can_manage(a, p) and p.user_id != request.user.pk:
        raise PermissionDenied("You can't sign this person out.")
    from rest_framework.authtoken.models import Token
    Token.objects.filter(user=p.user).delete()
    audit.log(request.user, "signed out", "session", object_id=p.user_id, branch=p.branch_id, summary=f"Signed {p.name} out of all devices")
    return Response({"ok": True})


# =================================================================== me: profile, hours, earnings

class MyProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name", allow_blank=True, required=False)
    email = serializers.EmailField(source="user.email", allow_blank=True, required=False)
    photo_url = serializers.SerializerMethodField()
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)
    pay_method_display = serializers.CharField(source="get_pay_method_display", read_only=True)

    class Meta:
        model = StaffProfile
        fields = ["employee_id", "first_name", "last_name", "preferred_name", "email", "phone", "address", "city", "state",
                  "zip_code", "date_of_birth", "emergency_contact", "emergency_phone", "photo_url", "role_display",
                  "branch_name", "job_title", "hire_date", "pay_type", "hourly_rate", "weekly_salary", "pay_method_display"]
        read_only_fields = ["employee_id", "role_display", "branch_name", "job_title", "hire_date", "pay_type",
                            "hourly_rate", "weekly_salary", "pay_method_display"]

    def get_photo_url(self, o):
        return _file_url(self.context.get("request"), o.photo)

    def validate_state(self, v):
        return (v or "").upper()[:2]

    def validate_zip_code(self, v):
        if v and not (len(v) in (5, 10) and v[:5].isdigit()):
            raise serializers.ValidationError("Use a 5-digit ZIP (or ZIP+4).")
        return v

    def update(self, inst, data):
        u = data.pop("user", {})
        for k, v in u.items():
            setattr(inst.user, k, v)
        inst.user.save()
        return super().update(inst, data)


def _me(request):
    p = getattr(request.actor, "profile", None)
    if not p:
        raise ValidationError({"detail": "Owner accounts don't have a staff profile."})
    return p


@mgmt_api(["GET", "PATCH"])
def my_profile(request):
    p = _me(request)
    if request.method == "PATCH":
        before = audit.snapshot(p, ["phone", "address", "city", "state", "zip_code", "emergency_contact", "emergency_phone", "preferred_name"])
        s = MyProfileSerializer(p, data=_data(request), partial=True, context=_ctx(request))
        s.is_valid(raise_exception=True)
        p = s.save()
        if request.FILES.get("photo"):
            p.photo = request.FILES["photo"]
            p.save(update_fields=["photo"])
        ch = audit.diff(before, audit.snapshot(p, before.keys()))
        if request.FILES.get("photo"):
            ch["photo"] = ["", "new photo"]
        if ch:
            audit.log(request.user, "updated", "staff", p, branch=p.branch_id, summary=f"{p.name} updated their profile", changes=ch)
    return Response(MyProfileSerializer(p, context=_ctx(request)).data)


@mgmt_api(["POST"])
def my_password(request):
    old, new = request.data.get("old_password", ""), request.data.get("new_password", "")
    if not request.user.check_password(old):
        raise ValidationError({"old_password": "Current password is wrong."})
    if len(new) < 6:
        raise ValidationError({"new_password": "Use at least 6 characters."})
    request.user.set_password(new)
    request.user.save()
    audit.log(request.user, "updated", "session", object_id=request.user.pk, summary="Changed own password")
    return Response({"ok": True})


@mgmt_api(["GET"])
def my_earnings(request):
    p = _me(request)
    wk_start, wk_end = reports.week_bounds(timezone.localdate())
    row = reports.payroll(TimeEntry.objects.filter(staff=p), [p], wk_start, wk_end)[0]
    entries = TimeEntry.objects.filter(staff=p).select_related("branch")[:60]
    from .serializers import TimeEntrySerializer
    from .views_extra import salary_weeks
    return Response({
        "this_week": {**row, "from": wk_start.isoformat(), "to": wk_end.isoformat()},
        "weeks": salary_weeks([p], 12)[p.id],
        "statements": PayStatementSerializer(p.pay_statements.filter(status="approved"), many=True).data,
        "shifts": TimeEntrySerializer(entries, many=True).data,
    })


# =================================================================== messages

def _people():
    """Everyone who can receive messages: active staff, plus owner accounts that have no staff profile."""
    from django.contrib.auth import get_user_model
    out = []
    for p in StaffProfile.objects.filter(status="active").select_related("user", "branch").prefetch_related("assigned_branches"):
        covers = None if p.role == Role.ADMIN else ({p.branch_id} if p.branch_id else set(b.id for b in p.assigned_branches.all()))
        out.append({"user_id": p.user_id, "name": p.name, "role": p.role, "role_display": p.get_role_display(), "level": LEVEL[p.role],
                    "branch_id": p.branch_id, "branch": p.branch.name if p.branch else "", "covers": covers})
    have = {x["user_id"] for x in out}
    for u in get_user_model().objects.filter(is_superuser=True, is_active=True).exclude(pk__in=have):
        out.append({"user_id": u.pk, "name": u.get_full_name() or u.username, "role": "admin", "role_display": "Admin",
                    "level": ADMIN, "branch_id": None, "branch": "", "covers": None})
    return out


# Who each role may write to (besides replying to a message they received):
#   employee → their manager and supervisor        manager → their employees, supervisor, super admin
#   supervisor → their team, super admin, admin    super admin → their team and the admin       admin → everyone
CAN_WRITE = {1: {2, 3}, 2: {1, 3, 4}, 3: {1, 2, 4, 5}, 4: {1, 2, 3, 5}, 5: {1, 2, 3, 4, 5}}


def _can_write(a, person) -> bool:
    if person["user_id"] == a.user.pk or person["level"] not in CAN_WRITE.get(a.level, set()):
        return False
    if a.branch_ids is None or person["covers"] is None:
        return True
    return bool(set(a.branch_ids) & person["covers"])


def _contacts(a):
    """People and groups this person can write to."""
    people = [p for p in _people() if _can_write(a, p)]
    groups = []
    if a.level >= MANAGER:
        branches = Branch.objects.filter(is_active=True) if a.branch_ids is None else Branch.objects.filter(pk__in=a.branch_ids)
        for b in branches:
            if any(p["branch_id"] == b.id for p in people):
                groups.append({"id": f"branch:{b.id}", "name": f"Everyone at {b.name} I can message"})
        for r, label in Role.choices:
            if any(p["role"] == r for p in people):
                groups.append({"id": f"role:{r}", "name": f"All {label}s"})
    return people, groups


def _team_senders(a):
    """Supervisors and above can read their team's messages: anyone below them in their stores (admin: everyone)."""
    if a.level < SUPERVISOR:
        return []
    return [p["user_id"] for p in _people() if p["user_id"] != a.user.pk and p["level"] < a.level
            and (a.branch_ids is None or p["covers"] is None or set(a.branch_ids) & (p["covers"] or set()))]


@mgmt_api(["GET"])
def message_contacts(request):
    people, groups = _contacts(request.actor)
    return Response({"people": [{"id": p["user_id"], "name": p["name"], "role": p["role_display"], "branch": p["branch"]}
                                for p in sorted(people, key=lambda x: (-x["level"], x["name"]))],
                     "groups": groups, "can_view_team": request.actor.level >= SUPERVISOR})


@mgmt_api(["GET", "POST"])
def messages(request):
    a = request.actor
    me = request.user
    if request.method == "GET":
        box = request.query_params.get("box", "inbox")
        base = Message.objects.select_related("sender").prefetch_related("recipients__user", "attachments")
        if box == "sent":
            qs = base.filter(sender=me)
        elif box == "archived":
            qs = base.filter(recipients__user=me, recipients__archived=True)
        elif box == "team":
            if a.level < SUPERVISOR:
                raise PermissionDenied("Only supervisors and above can see team messages.")
            qs = base.filter(sender_id__in=_team_senders(a)).exclude(recipients__user=me)
        else:
            qs = base.filter(recipients__user=me, recipients__archived=False)
        unread = MessageRecipient.objects.filter(user=me, read_at__isnull=True, archived=False).count()
        return Response({"unread": unread, "items": MessageSerializer(qs.distinct().order_by("-created_at")[:200], many=True,
                                                                       context={**_ctx(request), "me": me}).data})

    subject = (request.data.get("subject") or "").strip()[:200]
    body = (request.data.get("body") or "").strip()
    if not subject or not body:
        raise ValidationError({"subject": "Write a subject and a message."})
    to = request.data.getlist("to") if hasattr(request.data, "getlist") else request.data.get("to", [])
    if isinstance(to, str):
        to = [x for x in to.split(",") if x]
    people, groups = _contacts(a)
    allowed_people = {p["user_id"] for p in people}
    # You can always reply to someone who wrote to you.
    reply_to = request.data.get("reply_to") or None
    if reply_to:
        orig = Message.objects.filter(pk=reply_to, recipients__user=me).first()
        if orig and orig.sender_id:
            allowed_people.add(orig.sender_id)
    allowed_groups = {g["id"] for g in groups}
    users = set()
    for t in to:
        t = str(t)
        if t.startswith("branch:") or t.startswith("role:"):
            if t not in allowed_groups:
                raise PermissionDenied("You can't send to that group.")
            kind, val = t.split(":", 1)
            users.update(p["user_id"] for p in people if (kind == "branch" and str(p["branch_id"]) == val) or (kind == "role" and p["role"] == val))
        elif t.isdigit() and int(t) in allowed_people:
            users.add(int(t))
        else:
            raise PermissionDenied("Your role can't message one of these people. "
                                   + {1: "Employees write to their manager or supervisor.",
                                      2: "Managers write to their employees, supervisor or super admin.",
                                      3: "Supervisors write to their team, super admin or admin."}.get(a.level, ""))
    users.discard(me.pk)
    if not users:
        raise ValidationError({"to": "Choose at least one person or group."})
    files = request.FILES.getlist("attachments")
    if sum(f.size for f in files) > 15 * 1024 * 1024:
        raise ValidationError({"attachments": "Attachments are limited to 15 MB in total."})
    with transaction.atomic():
        m = Message.objects.create(sender=me, subject=subject, body=body, reply_to_id=reply_to)
        MessageRecipient.objects.bulk_create([MessageRecipient(message=m, user_id=u) for u in users])
        for f in files:
            MessageAttachment.objects.create(message=m, file=f, name=f.name[:200], size=f.size)
    from django.contrib.auth import get_user_model
    notify(get_user_model().objects.filter(pk__in=users), f"✉️ {subject}", f"From {a.name}", "/messages")
    return Response(MessageSerializer(m, context={**_ctx(request), "me": me}).data, status=201)


@mgmt_api(["GET", "POST"])
def message_detail(request, pk):
    me = request.user
    m = get_object_or_404(Message.objects.prefetch_related("recipients__user", "attachments").distinct(),
                          Q(sender=me) | Q(recipients__user=me) | Q(sender_id__in=_team_senders(request.actor)), pk=pk)
    r = MessageRecipient.objects.filter(message=m, user=me).first()
    if request.method == "POST" and r:
        if "archived" in request.data:
            r.archived = bool(request.data["archived"])
        if request.data.get("unread"):
            r.read_at = None
        r.save()
    elif r and not r.read_at:
        r.read_at = timezone.now()
        r.save(update_fields=["read_at"])
    return Response(MessageSerializer(m, context={**_ctx(request), "me": me}).data)
