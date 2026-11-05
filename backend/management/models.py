"""Back office: branches, staff & roles, time clock, purchases, cash handling, notifications."""
import datetime
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

User = settings.AUTH_USER_MODEL


class Branch(models.Model):
    name = models.CharField(max_length=80, unique=True)
    code = models.SlugField(max_length=20, unique=True, help_text="Short code, e.g. 'downtown'")
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    state = models.CharField(max_length=2, blank=True, help_text="US state, e.g. NY")
    min_wage = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("7.25"),
        help_text="Minimum hourly wage for this location (federal is $7.25; many states/cities are higher).",
    )
    tipped_min_wage = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("2.13"),
        help_text="Minimum cash wage for tipped employees (federal is $2.13).",
    )
    opening_float = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("200.00"),
                                        help_text="Cash left in the drawer at the start of each day")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "branches"

    def __str__(self):
        return self.name


class Role(models.TextChoices):
    EMPLOYEE = "employee", "Employee"
    MANAGER = "manager", "Manager"
    SUPERVISOR = "supervisor", "Supervisor"
    SUPERADMIN = "superadmin", "Super admin"
    ADMIN = "admin", "Admin"


LEVEL = {Role.EMPLOYEE: 1, Role.MANAGER: 2, Role.SUPERVISOR: 3, Role.SUPERADMIN: 4, Role.ADMIN: 5}
DISCOUNT_LIMIT = {1: 0, 2: 25, 3: 50, 4: 75, 5: 100}   # max discount % per level


class StaffProfile(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for verification"
        ACTIVE = "active", "Active"
        REJECTED = "rejected", "Rejected"
        INACTIVE = "inactive", "Inactive"

    class PayType(models.TextChoices):
        HOURLY = "hourly", "Hourly"
        TIPPED = "tipped", "Hourly (tipped)"
        SALARY = "salary", "Salary (weekly)"

    class PayMethod(models.TextChoices):
        CASH = "cash", "Cash"
        CHECK = "check", "Check"
        DIRECT_DEPOSIT = "direct_deposit", "Direct deposit"

    class Employment(models.TextChoices):
        FULL_TIME = "full_time", "Full-time"
        PART_TIME = "part_time", "Part-time"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="staff")
    employee_id = models.CharField(max_length=20, unique=True, help_text="Used to sign in, e.g. E1001")
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.EMPLOYEE)
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True, related_name="staff",
                               help_text="Required for employees and managers")
    assigned_branches = models.ManyToManyField(
        Branch, blank=True, related_name="overseers",
        help_text="Stores a supervisor / super admin can access (admins see every store)")
    branches = models.ManyToManyField(Branch, blank=True, related_name="area_staff",
                                      help_text="Stores a supervisor / super admin is responsible for")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    # Personal / contact (no SSN stored — keep tax documents with your payroll provider)
    preferred_name = models.CharField(max_length=60, blank=True)
    photo = models.ImageField(upload_to="staff/", blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.CharField("Street address", max_length=255, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=2, blank=True)
    zip_code = models.CharField(max_length=10, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    emergency_contact = models.CharField(max_length=120, blank=True)
    emergency_phone = models.CharField(max_length=30, blank=True)
    job_title = models.CharField(max_length=60, blank=True, help_text="e.g. Cashier, Cook")
    employment_type = models.CharField(max_length=10, choices=Employment.choices, default=Employment.PART_TIME)
    hire_date = models.DateField(default=timezone.localdate)
    i9_verified = models.BooleanField("I-9 completed", default=False)
    w4_on_file = models.BooleanField("W-4 on file", default=False)

    # Pay
    pay_type = models.CharField(max_length=10, choices=PayType.choices, default=PayType.HOURLY)
    hourly_rate = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0"))
    weekly_salary = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("0"))
    pay_method = models.CharField(max_length=16, choices=PayMethod.choices, default=PayMethod.CHECK)
    notes = models.TextField(blank=True)

    # Verification trail
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["employee_id"]

    @property
    def level(self) -> int:
        return LEVEL[self.role]

    @property
    def name(self) -> str:
        return self.user.get_full_name() or self.user.username

    def __str__(self):
        return f"{self.employee_id} · {self.name} ({self.get_role_display()})"


class TimeEntry(models.Model):
    staff = models.ForeignKey(StaffProfile, on_delete=models.CASCADE, related_name="time_entries")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="time_entries")
    clock_in = models.DateTimeField()
    clock_out = models.DateTimeField(null=True, blank=True)
    tips = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0"))
    note = models.CharField(max_length=255, blank=True)
    edited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["-clock_in"]
        verbose_name_plural = "time entries"

    @property
    def hours(self) -> Decimal:
        end = self.clock_out or timezone.now()
        return Decimal((end - self.clock_in).total_seconds() / 3600).quantize(Decimal("0.01"))


class ApprovalStatus(models.TextChoices):
    PENDING = "pending", "Waiting for approval"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"


class Purchase(models.Model):
    class Category(models.TextChoices):
        MEAT = "meat", "Meat & poultry"
        PRODUCE = "produce", "Produce"
        DAIRY = "dairy", "Dairy & eggs"
        BAKERY = "bakery", "Bakery & dry goods"
        BEVERAGES = "beverages", "Beverages"
        SAUCES = "sauces", "Sauces & spices"
        FROZEN = "frozen", "Frozen"
        PACKAGING = "packaging", "Packaging & disposables"
        CLEANING = "cleaning", "Cleaning supplies"
        EQUIPMENT = "equipment", "Equipment & smallwares"
        REPAIRS = "repairs", "Repairs & maintenance"
        UTILITIES = "utilities", "Utilities"
        RENT = "rent", "Rent"
        MARKETING = "marketing", "Marketing"
        OTHER = "other", "Other"

    # Food & drink purchases count as cost of goods sold (COGS) in the P&L; the rest are operating expenses.
    COGS = {"meat", "produce", "dairy", "bakery", "beverages", "sauces", "frozen"}

    class PaidWith(models.TextChoices):
        REGISTER_CASH = "register_cash", "Cash from register"
        COMPANY_CARD = "company_card", "Company card"
        CHECK = "check", "Check"
        BANK_TRANSFER = "bank_transfer", "Bank transfer / ACH"
        ON_ACCOUNT = "on_account", "On account (pay later)"
        PERSONAL = "personal", "Personal money (reimburse)"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="purchases")
    vendor_ref = models.ForeignKey("Vendor", on_delete=models.SET_NULL, null=True, blank=True, related_name="purchases")
    category = models.CharField(max_length=12, choices=Category.choices)
    vendor = models.CharField(max_length=120)
    invoice_number = models.CharField(max_length=60, blank=True)
    purchase_date = models.DateField(default=timezone.localdate)
    paid_with = models.CharField(max_length=16, choices=PaidWith.choices, default=PaidWith.COMPANY_CARD)
    reason = models.TextField(help_text="Why was this bought?")
    receipt = models.FileField(upload_to="receipts/%Y/%m/", blank=True, null=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))

    status = models.CharField(max_length=10, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-purchase_date", "-id"]

    def __str__(self):
        return f"#{self.pk} {self.vendor} ${self.total}"


class PurchaseLine(models.Model):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="lines")
    name = models.CharField(max_length=120)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("1"))
    unit = models.CharField(max_length=20, blank=True, help_text="lb, case, box, each…")
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2)

    @property
    def line_total(self) -> Decimal:
        return (self.quantity * self.unit_cost).quantize(Decimal("0.01"))


class CashDrop(models.Model):
    """Cash removed from the drawer during the day (to the safe) or paid out."""

    class Kind(models.TextChoices):
        SAFE_DROP = "safe_drop", "Drop to safe"
        PAID_OUT = "paid_out", "Paid out (petty cash)"
        PAID_IN = "paid_in", "Paid in (cash added)"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="cash_drops")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.SAFE_DROP)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.CharField(max_length=255, blank=True)
    made_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    witnessed_by = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class DailyClose(models.Model):
    """End-of-day closing: count the drawer, compare with what the system expects."""

    edited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="closes")
    date = models.DateField()
    opening_float = models.DecimalField(max_digits=10, decimal_places=2)
    cash_sales = models.DecimalField(max_digits=10, decimal_places=2)
    cash_refunds = models.DecimalField(max_digits=10, decimal_places=2)
    paid_outs = models.DecimalField(max_digits=10, decimal_places=2, help_text="Paid-outs + register-cash purchases")
    paid_ins = models.DecimalField(max_digits=10, decimal_places=2)
    safe_drops = models.DecimalField(max_digits=10, decimal_places=2)
    expected_cash = models.DecimalField(max_digits=10, decimal_places=2)
    counted_cash = models.DecimalField(max_digits=10, decimal_places=2)
    denominations = models.JSONField(default=dict, blank=True)  # {"100": 2, "20": 5, "0.25": 12, ...}
    over_short = models.DecimalField(max_digits=10, decimal_places=2)
    card_sales = models.DecimalField(max_digits=10, decimal_places=2)
    online_sales = models.DecimalField(max_digits=10, decimal_places=2)
    total_sales = models.DecimalField(max_digits=10, decimal_places=2)
    cash_to_deposit = models.DecimalField(max_digits=10, decimal_places=2,
                                          help_text="Counted cash + safe drops − next day's float")
    notes = models.TextField(blank=True)
    closed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        unique_together = [("branch", "date")]


class BankDeposit(models.Model):
    """Money leaving the store's safe: a bank deposit, or cash taken out (owner, payroll cash, change order…)."""
    class Kind(models.TextChoices):
        DEPOSIT = "deposit", "Bank deposit"
        TAKEOUT = "takeout", "Cash taken out"

    class Method(models.TextChoices):
        TELLER = "teller", "Bank teller (branch)"
        NIGHT_DROP = "night_drop", "Night drop"
        ATM = "atm", "ATM deposit"
        ARMORED = "armored", "Armored car pickup"
        HAND = "hand", "Handed to a person"
        OTHER = "other", "Other"

    class Purpose(models.TextChoices):
        OWNER = "owner", "Owner took it"
        PAYROLL = "payroll", "Cash wages / tips payout"
        VENDOR = "vendor", "Paid a vendor in cash"
        CHANGE = "change", "Buy change (coins / small bills)"
        TRANSFER = "transfer", "Moved to another store"
        OTHER = "other", "Other"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="deposits")
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.DEPOSIT)
    method = models.CharField(max_length=12, choices=Method.choices, default=Method.TELLER)
    date = models.DateField(default=timezone.localdate)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    cash_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Bills & coins")
    check_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    check_count = models.PositiveSmallIntegerField(default=0)
    bag_number = models.CharField(max_length=40, blank=True, help_text="Deposit bag / seal #")
    counted_by = models.CharField(max_length=80, blank=True, help_text="Second person who counted it")
    taken_by = models.CharField(max_length=80, blank=True, help_text="Who took the cash (take-outs)")
    purpose = models.CharField(max_length=10, choices=Purpose.choices, blank=True)
    bank_name = models.CharField(max_length=80, blank=True)
    account_last4 = models.CharField(max_length=4, blank=True, help_text="Last 4 digits only")
    slip_number = models.CharField(max_length=60, blank=True)
    slip = models.FileField(upload_to="deposits/%Y/%m/", blank=True, null=True)
    covers_from = models.DateField(null=True, blank=True, help_text="Sales days this deposit covers")
    covers_to = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    deposited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    verified_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


class Notification(models.Model):
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=160)
    body = models.CharField(max_length=500, blank=True)
    link = models.CharField(max_length=200, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]



class JobTitle(models.Model):
    DEFAULTS = ["Cashier", "Line cook", "Prep cook", "Grill cook", "Fry cook", "Dishwasher", "Server", "Host",
                "Busser", "Porter / Cleaner", "Delivery driver", "Shift lead", "Baker", "Barista", "Store manager"]
    name = models.CharField(max_length=60, unique=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Vendor(models.Model):
    class Terms(models.TextChoices):
        COD = "cod", "Cash on delivery"
        CARD = "card", "Card at purchase"
        PREPAID = "prepaid", "Prepaid"
        NET7 = "net7", "Net 7"
        NET15 = "net15", "Net 15"
        NET30 = "net30", "Net 30"

    name = models.CharField(max_length=120, unique=True)
    contact_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    website = models.CharField(max_length=200, blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=2, blank=True)
    zip_code = models.CharField(max_length=10, blank=True)
    account_number = models.CharField(max_length=60, blank=True, help_text="Your customer account # with the vendor")
    payment_terms = models.CharField(max_length=10, choices=Terms.choices, default=Terms.CARD)
    w9_on_file = models.BooleanField("W-9 on file", default=False)
    categories = models.CharField(max_length=200, blank=True, help_text="What you buy here, e.g. meat, produce")
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class DayOpen(models.Model):
    """Start of day: the opening cash counted into the drawer."""
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="day_opens")
    date = models.DateField()
    opening_float = models.DecimalField(max_digits=10, decimal_places=2)
    denominations = models.JSONField(default=dict, blank=True)
    note = models.CharField(max_length=255, blank=True)
    opened_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        unique_together = [("branch", "date")]


class Terminal(models.Model):
    """A registered store device. Employees can only sign in / clock in on these."""
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="terminals")
    name = models.CharField(max_length=80, help_text="e.g. Front register, Kitchen tablet")
    key_hash = models.CharField(max_length=128, unique=True)
    registered_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    last_user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["branch", "name"]


class ChangeRequest(models.Model):
    """Any add/edit that needs the next role up to approve it ("role-wise" approval)."""
    kind = models.CharField(max_length=40)          # e.g. "purchase.edit", "vendor.create"
    target_id = models.PositiveIntegerField(null=True, blank=True)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    summary = models.CharField(max_length=255)
    payload = models.JSONField(default=dict)        # new values
    before = models.JSONField(default=dict, blank=True)   # old values (for edits)
    file = models.FileField(upload_to="changes/%Y/%m/", blank=True, null=True)
    reason = models.CharField(max_length=255, blank=True)
    need_level = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=10, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)
    result_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class AuditLog(models.Model):
    """Who changed what, when — for every record in the system."""
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    action = models.CharField(max_length=20)        # created / updated / deleted / approved / rejected / ...
    model = models.CharField(max_length=40)         # e.g. "purchase"
    object_id = models.PositiveIntegerField(null=True)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    summary = models.CharField(max_length=255)
    changes = models.JSONField(default=dict, blank=True)   # {field: [old, new]}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["model", "object_id"])]


class Message(models.Model):
    sender = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="sent_messages")
    subject = models.CharField(max_length=200)
    body = models.TextField()
    reply_to = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="replies")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class MessageRecipient(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="recipients")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="inbox")
    read_at = models.DateTimeField(null=True, blank=True)
    archived = models.BooleanField(default=False)

    class Meta:
        unique_together = [("message", "user")]


class MessageAttachment(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="messages/%Y/%m/")
    name = models.CharField(max_length=200)
    size = models.PositiveIntegerField(default=0)


class PayStatement(models.Model):
    """A paid pay period, shown to the employee as their earnings history."""
    staff = models.ForeignKey(StaffProfile, on_delete=models.CASCADE, related_name="pay_statements")
    period_start = models.DateField()
    period_end = models.DateField()
    regular_hours = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0"))
    overtime_hours = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0"))
    rate = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal("0"))
    regular_pay = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    overtime_pay = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tips = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    gross_pay = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    is_paid = models.BooleanField(default=False)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    payments = models.JSONField(default=list, blank=True, help_text='[{"method": "cash", "amount": "200.00", "reference": ""}]')
    paid_on = models.DateField(null=True, blank=True)
    pay_method = models.CharField(max_length=16, choices=StaffProfile.PayMethod.choices, default="check")
    reference = models.CharField(max_length=60, blank=True, help_text="Check # / transfer reference")
    note = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=10, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-period_start"]
        unique_together = [("staff", "period_start", "period_end")]


class MenuBoard(models.Model):
    """A TV menu screen layout. Several per store are allowed."""
    class Theme(models.TextChoices):
        DARK = "dark", "Dark"
        LIGHT = "light", "Light"
        FLAME = "flame", "Flame red"

    name = models.CharField(max_length=80)
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, null=True, blank=True, related_name="boards",
                               help_text="Empty = available at every store")
    title = models.CharField(max_length=80, blank=True)
    subtitle = models.CharField(max_length=120, blank=True)
    theme = models.CharField(max_length=8, choices=Theme.choices, default=Theme.DARK)
    columns = models.PositiveSmallIntegerField(default=3)
    categories = models.JSONField(default=list, blank=True, help_text="Category slugs in order; empty = all")
    show_qr = models.BooleanField(default=True)
    show_flavours = models.BooleanField(default=True)
    show_offers = models.BooleanField(default=True)
    ticker = models.CharField(max_length=200, blank=True, help_text="Scrolling message at the bottom")
    layout = models.CharField(max_length=10, default="list",
                              choices=[("list", "Classic price list"), ("cards", "Photo cards"), ("featured", "Featured item + list")])
    orientation = models.CharField(max_length=10, default="landscape",
                                   choices=[("landscape", "Landscape (wide TV)"), ("portrait", "Portrait (TV on its side)")])
    featured = models.JSONField(default=list, blank=True, help_text="Menu item ids shown big on the 'featured' layout")
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["branch__name", "name"]


class Owner(models.Model):
    """A business owner and their share of the profit. Admin only."""
    name = models.CharField(max_length=120)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="owner_records")
    share_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-share_percent", "name"]

    def __str__(self):
        return f"{self.name} ({self.share_percent}%)"


class OwnerDraw(models.Model):
    """Money an owner took out of the business."""
    class Method(models.TextChoices):
        CASH = "cash", "Cash from store"
        CHECK = "check", "Check"
        TRANSFER = "bank_transfer", "Bank transfer"
        OTHER = "other", "Other"

    owner = models.ForeignKey(Owner, on_delete=models.PROTECT, related_name="draws")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="owner_draws")
    date = models.DateField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=16, choices=Method.choices, default=Method.TRANSFER)
    reference = models.CharField(max_length=60, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]


class PaySettings(models.Model):
    """How often staff are paid. One row."""
    FREQUENCIES = [("weekly", "Every week"), ("biweekly", "Every 2 weeks")]
    frequency = models.CharField(max_length=10, choices=FREQUENCIES, default="weekly")
    anchor = models.DateField(default=datetime.date(2026, 1, 5), help_text="A Monday that starts a pay period")
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get(cls):
        return cls.objects.first() or cls.objects.create()

    @property
    def days(self) -> int:
        return 14 if self.frequency == "biweekly" else 7

    def period_of(self, day: datetime.date) -> tuple[datetime.date, datetime.date]:
        anchor = self.anchor - datetime.timedelta(days=self.anchor.weekday())   # always a Monday
        n = (day - anchor).days // self.days
        start = anchor + datetime.timedelta(days=n * self.days)
        return start, start + datetime.timedelta(days=self.days - 1)


class TaxFiling(models.Model):
    """Sales-tax filing status for a period (e.g. a month or quarter). Only the admin changes it."""
    class Status(models.TextChoices):
        OPEN = "open", "Not filed"
        FILED = "filed", "Filed, not paid"
        PAID = "paid", "Filed & paid (clean)"

    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, null=True, blank=True, related_name="tax_filings",
                               help_text="Empty = all stores together")
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    tax_due = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"), help_text="Tax collected for the period when saved")
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    filed_on = models.DateField(null=True, blank=True)
    paid_on = models.DateField(null=True, blank=True)
    confirmation = models.CharField(max_length=80, blank=True, help_text="State confirmation / payment reference")
    note = models.CharField(max_length=255, blank=True)
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start"]
        unique_together = [("branch", "period_start", "period_end")]


class Bill(models.Model):
    """A monthly bill: electricity, gas, water, trash, internet… Added role-wise (manager → supervisor → super admin → admin)."""
    class Category(models.TextChoices):
        ELECTRIC = "electric", "Electricity"
        GAS = "gas", "Gas"
        WATER = "water", "Water & sewer"
        TRASH = "trash", "Trash & recycling"
        INTERNET = "internet", "Internet"
        PHONE = "phone", "Phone"
        RENT = "rent", "Rent / lease"
        INSURANCE = "insurance", "Insurance"
        PEST = "pest", "Pest control"
        GREASE = "grease", "Grease trap & hood cleaning"
        SECURITY = "security", "Alarm & security"
        CARD_FEES = "card_fees", "Card processing fees"
        SOFTWARE = "software", "POS / software"
        MUSIC = "music", "Music / TV license"
        LINEN = "linen", "Linen & uniforms"
        OTHER = "other", "Other"

    class PaidWith(models.TextChoices):
        AUTOPAY = "autopay", "Autopay / bank transfer"
        CARD = "card", "Company card"
        CHECK = "check", "Check"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True, related_name="bills",
                               help_text="Empty = the whole company / head office")
    category = models.CharField(max_length=12, choices=Category.choices)
    provider = models.CharField(max_length=120, help_text="e.g. Con Edison, Waste Management, Spectrum")
    account_number = models.CharField(max_length=30, blank=True)
    bill_month = models.DateField(help_text="The month the bill is for (stored as the 1st)")
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, help_text="Before tax")
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"), help_text="Taxes & surcharges on the bill")
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    usage = models.CharField(max_length=60, blank=True, help_text="e.g. 2,340 kWh · 18 CCF")
    is_paid = models.BooleanField(default=False)
    paid_on = models.DateField(null=True, blank=True)
    paid_with = models.CharField(max_length=8, choices=PaidWith.choices, blank=True)
    reference = models.CharField(max_length=60, blank=True, help_text="Check # / confirmation #")
    file = models.FileField(upload_to="bills/%Y/%m/", blank=True, null=True)
    note = models.CharField(max_length=255, blank=True)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-bill_month", "category"]

    def save(self, *a, **kw):
        self.bill_month = self.bill_month.replace(day=1)
        self.total = (self.amount or Decimal("0")) + (self.tax or Decimal("0"))
        super().save(*a, **kw)


class AppSalesDay(models.Model):
    """One day of sales on a delivery app (Uber Eats, DoorDash…) for one store, from the app's merchant report."""
    partner = models.ForeignKey("orders.DeliveryPartner", on_delete=models.PROTECT, related_name="days")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="app_days")
    date = models.DateField()
    orders = models.PositiveIntegerField(default=0)
    sales = models.DecimalField(max_digits=10, decimal_places=2, help_text="Food sales before tax")
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    fees = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"), help_text="Commission & app fees")
    adjustments = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"),
                                      help_text="Refunds / error charges (enter as a positive number)")
    tax_by_app = models.BooleanField(default=True, help_text="The app collects and pays this tax")
    note = models.CharField(max_length=255, blank=True)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "partner"]
        unique_together = [("partner", "branch", "date")]

    @property
    def expected(self) -> Decimal:
        """What the app owes the store for the day."""
        return self.sales + (Decimal("0") if self.tax_by_app else self.tax) - self.fees - self.adjustments


class AppPayout(models.Model):
    """Money received from a delivery app (bank deposit from Uber Eats, DoorDash…)."""
    partner = models.ForeignKey("orders.DeliveryPartner", on_delete=models.PROTECT, related_name="payouts")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="app_payouts")
    received_on = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    covers_from = models.DateField(null=True, blank=True)
    covers_to = models.DateField(null=True, blank=True)
    reference = models.CharField(max_length=60, blank=True, help_text="Payout / transfer ID")
    note = models.CharField(max_length=255, blank=True)
    submitted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="+")
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-received_on", "-id"]
