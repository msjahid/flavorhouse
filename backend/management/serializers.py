from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    AuditLog,
    BankDeposit,
    Branch,
    ChangeRequest,
    DayOpen,
    JobTitle,
    MenuBoard,
    Message,
    PayStatement,
    Terminal,
    Vendor,
    CashDrop,
    DailyClose,
    Notification,
    Purchase,
    PurchaseLine,
    StaffProfile,
    TimeEntry,
)


def _name(u):
    return (u.get_full_name() or u.username) if u else None


def _file_url(request, f):
    if not f:
        return None
    url = f.url
    return url if url.startswith("http") or not request else request.build_absolute_uri(url)


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = ["id", "name", "code", "address", "phone", "state", "min_wage", "tipped_min_wage",
                  "opening_float", "is_active"]


class StaffSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(source="user.first_name")
    last_name = serializers.CharField(source="user.last_name", allow_blank=True, required=False)
    email = serializers.EmailField(source="user.email", allow_blank=True, required=False)
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    name = serializers.CharField(read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)
    pay_type_display = serializers.CharField(source="get_pay_type_display", read_only=True)
    pay_method_display = serializers.CharField(source="get_pay_method_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    stores = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = [
            "id", "employee_id", "first_name", "last_name", "email", "password", "name", "preferred_name", "photo_url",
            "role", "role_display", "branch", "branch_name", "stores", "status", "status_display",
            "phone", "address", "city", "state", "zip_code", "date_of_birth", "emergency_contact", "emergency_phone",
            "job_title", "employment_type", "hire_date", "i9_verified", "w4_on_file",
            "pay_type", "pay_type_display", "hourly_rate", "weekly_salary", "pay_method", "pay_method_display",
            "notes", "created_by_name", "reviewed_by_name", "reviewed_at", "review_note", "created_at",
        ]
        read_only_fields = ["status", "reviewed_at", "review_note", "created_at"]

    def get_created_by_name(self, o):
        return _name(o.created_by)

    def get_reviewed_by_name(self, o):
        return _name(o.reviewed_by)

    def get_stores(self, o):
        return [{"id": b.id, "name": b.name} for b in o.assigned_branches.all()]

    def get_photo_url(self, o):
        return _file_url(self.context.get("request"), o.photo)

    def validate_employee_id(self, v):
        v = v.strip().upper()
        qs = StaffProfile.objects.filter(employee_id__iexact=v)
        User = get_user_model()
        uq = User.objects.filter(username__iexact=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
            uq = uq.exclude(pk=self.instance.user_id)
        if qs.exists() or uq.exists():
            raise serializers.ValidationError("This employee ID is already used.")
        return v

    def validate(self, data):
        role = data.get("role", getattr(self.instance, "role", None))
        branch = data.get("branch", getattr(self.instance, "branch", None))
        if role in ("employee", "manager") and not branch:
            raise serializers.ValidationError({"branch": "Employees and managers must belong to a branch."})
        if role in ("supervisor", "superadmin", "admin"):
            data["branch"] = None  # they cover every branch
        pay_type = data.get("pay_type", getattr(self.instance, "pay_type", "hourly"))
        rate = data.get("hourly_rate", getattr(self.instance, "hourly_rate", Decimal("0")))
        salary = data.get("weekly_salary", getattr(self.instance, "weekly_salary", Decimal("0")))
        b = branch or Branch.objects.filter(is_active=True).order_by("id").first()
        if pay_type == "hourly" and b and rate < b.min_wage:
            raise serializers.ValidationError(
                {"hourly_rate": f"Below the minimum wage for {b.name} (${b.min_wage}/hr)."})
        if pay_type == "tipped" and b and rate < b.tipped_min_wage:
            raise serializers.ValidationError(
                {"hourly_rate": f"Below the tipped minimum cash wage for {b.name} (${b.tipped_min_wage}/hr)."})
        if pay_type == "salary" and salary <= 0:
            raise serializers.ValidationError({"weekly_salary": "Enter the weekly salary."})
        if not self.instance and not data.get("password"):
            raise serializers.ValidationError({"password": "Set a starting password (6+ characters)."})
        return data

    def create(self, data):
        u = data.pop("user", {})
        password = data.pop("password")
        user = get_user_model().objects.create_user(
            username=data["employee_id"], password=password, first_name=u.get("first_name", ""),
            last_name=u.get("last_name", ""), email=u.get("email", ""),
        )
        return StaffProfile.objects.create(user=user, **data)

    def update(self, inst, data):
        u = data.pop("user", {})
        password = data.pop("password", None)
        for k, v in u.items():
            setattr(inst.user, k, v)
        if "employee_id" in data:
            inst.user.username = data["employee_id"]
        if password:
            inst.user.set_password(password)
        inst.user.save()
        for k, v in data.items():
            setattr(inst, k, v)
        inst.save()
        return inst


class TimeEntrySerializer(serializers.ModelSerializer):
    hours = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)
    staff_name = serializers.CharField(source="staff.name", read_only=True)
    employee_id = serializers.CharField(source="staff.employee_id", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    edited_by_name = serializers.SerializerMethodField()
    staff_level = serializers.SerializerMethodField()

    def get_staff_level(self, o):
        from .models import LEVEL
        return LEVEL[o.staff.role]

    class Meta:
        model = TimeEntry
        fields = ["id", "staff", "staff_name", "employee_id", "staff_level", "branch", "branch_name", "clock_in", "clock_out",
                  "hours", "tips", "note", "edited_by_name"]

    def get_edited_by_name(self, o):
        return _name(o.edited_by)

    def validate(self, data):
        cin = data.get("clock_in", getattr(self.instance, "clock_in", None))
        cout = data.get("clock_out", getattr(self.instance, "clock_out", None))
        if cin and cout and cout <= cin:
            raise serializers.ValidationError({"clock_out": "Clock-out must be after clock-in."})
        return data


class PurchaseLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseLine
        fields = ["id", "name", "quantity", "unit", "unit_cost", "line_total"]


class PurchaseSerializer(serializers.ModelSerializer):
    lines = PurchaseLineSerializer(many=True, read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    paid_with_display = serializers.CharField(source="get_paid_with_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    receipt_url = serializers.SerializerMethodField()
    needs_role = serializers.SerializerMethodField()
    submitted_by_level = serializers.SerializerMethodField()

    class Meta:
        model = Purchase
        fields = ["id", "branch", "branch_name", "vendor_ref", "submitted_by", "submitted_by_level", "category", "category_display", "vendor", "invoice_number",
                  "purchase_date", "paid_with", "paid_with_display", "reason", "receipt_url",
                  "subtotal", "tax", "total", "lines", "status", "status_display",
                  "submitted_by_name", "reviewed_by_name", "reviewed_at", "review_note", "created_at", "needs_role"]

    def get_submitted_by_name(self, o):
        return _name(o.submitted_by)

    def get_reviewed_by_name(self, o):
        return _name(o.reviewed_by)

    def get_receipt_url(self, o):
        return _file_url(self.context.get("request"), o.receipt)

    def get_submitted_by_level(self, o):
        from .access import level_of
        return level_of(o.submitted_by) if o.submitted_by else 1

    def get_needs_role(self, o):
        if o.status != "pending":
            return None
        from .access import PURCHASE_APPROVER_LEVEL, actor_for
        a = actor_for(o.submitted_by) if o.submitted_by else None
        lvl = PURCHASE_APPROVER_LEVEL.get(a.level if a else 2, 3)
        return {3: "Supervisor", 4: "Super admin", 5: "Admin"}.get(lvl)


class CashDropSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    made_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CashDrop
        fields = ["id", "branch", "branch_name", "kind", "kind_display", "amount", "note", "witnessed_by",
                  "made_by_name", "created_at"]
        read_only_fields = ["created_at"]

    def get_made_by_name(self, o):
        return _name(o.made_by)

    def validate_amount(self, v):
        if v <= 0:
            raise serializers.ValidationError("Amount must be more than 0.")
        return v


class DailyCloseSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    closed_by_name = serializers.SerializerMethodField()
    closed_by_level = serializers.SerializerMethodField()
    edited_by_name = serializers.SerializerMethodField()

    def get_closed_by_level(self, o):
        from .access import level_of
        return level_of(o.closed_by) if o.closed_by else 1

    def get_edited_by_name(self, o):
        return _name(o.edited_by)

    class Meta:
        model = DailyClose
        fields = "__all__"

    def get_closed_by_name(self, o):
        return _name(o.closed_by)


class BankDepositSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    deposited_by_name = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    slip_url = serializers.SerializerMethodField()

    class Meta:
        model = BankDeposit
        fields = ["id", "branch", "branch_name", "kind", "kind_display", "method", "method_display", "date", "amount",
                  "cash_amount", "check_amount", "check_count", "bag_number", "counted_by", "taken_by", "purpose",
                  "purpose_display", "bank_name", "account_last4", "slip_number",
                  "slip_url", "covers_from", "covers_to", "note", "deposited_by_name", "verified_by_name",
                  "verified_at", "created_at"]
        read_only_fields = ["verified_at", "created_at"]

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    method_display = serializers.CharField(source="get_method_display", read_only=True)
    purpose_display = serializers.CharField(source="get_purpose_display", read_only=True)

    def validate(self, d):
        inst = self.instance
        g = lambda k: d.get(k, getattr(inst, k, None) if inst else None)  # noqa: E731
        kind = g("kind") or "deposit"
        amount = g("amount")
        cash, checks = g("cash_amount"), g("check_amount")
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount": "The amount must be above 0."})
        if cash is not None or checks is not None:
            if (cash or 0) + (checks or 0) != amount:
                raise serializers.ValidationError({"amount": f"Cash ${cash or 0} + checks ${checks or 0} must equal the total ${amount}."})
        if (checks or 0) > 0 and not g("check_count"):
            raise serializers.ValidationError({"check_count": "How many checks?"})
        if kind == "takeout":
            if not (g("taken_by") or "").strip():
                raise serializers.ValidationError({"taken_by": "Who took the cash?"})
            if not g("purpose"):
                raise serializers.ValidationError({"purpose": "Why was it taken out?"})
        acct = g("account_last4") or ""
        if acct and (len(acct) != 4 or not acct.isdigit()):
            raise serializers.ValidationError({"account_last4": "Only the last 4 digits."})
        return d

    def get_deposited_by_name(self, o):
        return _name(o.deposited_by)

    def get_verified_by_name(self, o):
        return _name(o.verified_by)

    def get_slip_url(self, o):
        return _file_url(self.context.get("request"), o.slip)

    def validate_account_last4(self, v):
        if v and (not v.isdigit() or len(v) != 4):
            raise serializers.ValidationError("Enter only the last 4 digits.")
        return v


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "title", "body", "link", "is_read", "created_at"]


class ChangeRequestSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    action = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)
    need_role = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ChangeRequest
        fields = ["id", "kind", "label", "action", "target_id", "branch", "branch_name", "summary", "payload", "before",
                  "file_url", "reason", "need_level", "need_role", "status", "submitted_by_name", "reviewed_by_name",
                  "reviewed_at", "review_note", "result_id", "created_at"]

    def get_label(self, o):
        from .changes import HANDLERS
        h = HANDLERS.get(o.kind)
        return h.label if h else o.kind

    def get_action(self, o):
        return {"create": "New", "edit": "Change", "delete": "Delete"}.get(o.kind.split(".")[-1], "Change")

    def get_submitted_by_name(self, o):
        return _name(o.submitted_by)

    def get_reviewed_by_name(self, o):
        return _name(o.reviewed_by)

    def get_need_role(self, o):
        return {2: "Manager", 3: "Supervisor", 4: "Super admin", 5: "Admin"}.get(o.need_level)

    def get_file_url(self, o):
        return _file_url(self.context.get("request"), o.file)


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "action", "model", "object_id", "branch", "branch_name", "summary", "changes",
                  "actor_name", "approved_by_name", "created_at"]

    def get_actor_name(self, o):
        return _name(o.actor)

    def get_approved_by_name(self, o):
        return _name(o.approved_by)


class VendorSerializer(serializers.ModelSerializer):
    payment_terms_display = serializers.CharField(source="get_payment_terms_display", read_only=True)

    class Meta:
        model = Vendor
        fields = ["id", "name", "contact_name", "phone", "email", "website", "address", "city", "state", "zip_code",
                  "account_number", "payment_terms", "payment_terms_display", "w9_on_file", "categories", "notes",
                  "is_active", "created_at"]
        read_only_fields = ["created_at"]

    def validate_state(self, v):
        return (v or "").upper()[:2]


class JobTitleSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobTitle
        fields = ["id", "name"]


class DayOpenSerializer(serializers.ModelSerializer):
    opened_by_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = DayOpen
        fields = ["id", "branch", "branch_name", "date", "opening_float", "denominations", "note", "opened_by_name", "created_at"]

    def get_opened_by_name(self, o):
        return _name(o.opened_by)


class TerminalSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    registered_by_name = serializers.SerializerMethodField()
    last_user_name = serializers.SerializerMethodField()

    class Meta:
        model = Terminal
        fields = ["id", "branch", "branch_name", "name", "registered_by_name", "created_at", "last_seen",
                  "last_user_name", "is_active"]

    def get_registered_by_name(self, o):
        return _name(o.registered_by)

    def get_last_user_name(self, o):
        return _name(o.last_user)


class PayStatementSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="staff.name", read_only=True)
    employee_id = serializers.CharField(source="staff.employee_id", read_only=True)
    pay_method_display = serializers.CharField(source="get_pay_method_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PayStatement
        fields = ["id", "staff", "staff_name", "employee_id", "period_start", "period_end", "is_paid", "regular_hours",
                  "overtime_hours", "rate", "regular_pay", "overtime_pay", "tips", "gross_pay", "paid_on",
                  "pay_method", "pay_method_display", "reference", "note", "status", "created_by_name",
                  "reviewed_by_name", "reviewed_at", "created_at"]

    def get_created_by_name(self, o):
        return _name(o.created_by)

    def get_reviewed_by_name(self, o):
        return _name(o.reviewed_by)


class MenuBoardSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)

    class Meta:
        model = MenuBoard
        fields = ["id", "name", "branch", "branch_name", "title", "subtitle", "theme", "columns", "categories",
                  "show_qr", "show_flavours", "show_offers", "ticker", "is_active", "layout", "orientation", "featured",
                  "updated_at"]
        read_only_fields = ["updated_at"]

    def validate_featured(self, v):
        if not isinstance(v, list) or any(not isinstance(x, int) for x in v) or len(v) > 6:
            raise serializers.ValidationError("Choose up to 6 items.")
        return v

    def validate_columns(self, v):
        if not 1 <= v <= 4:
            raise serializers.ValidationError("Choose 1 to 4 columns.")
        return v


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    to = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()
    read = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ["id", "subject", "body", "sender_name", "to", "attachments", "read", "reply_to", "created_at"]

    def get_sender_name(self, o):
        return _name(o.sender) or "System"

    def get_to(self, o):
        names = [_name(r.user) for r in o.recipients.all()]
        return names[:30] + ([f"+{len(names) - 30} more"] if len(names) > 30 else [])

    def get_attachments(self, o):
        req = self.context.get("request")
        return [{"id": a.id, "name": a.name, "size": a.size, "url": _file_url(req, a.file)} for a in o.attachments.all()]

    def get_read(self, o):
        me = self.context.get("me")
        r = next((r for r in o.recipients.all() if r.user_id == getattr(me, "pk", None)), None)
        return True if r is None else r.read_at is not None
