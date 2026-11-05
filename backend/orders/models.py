import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models

from menu.models import MenuItem


def phone_key(v: str) -> str:
    """Digits only, last 10 (US numbers), so (512) 555-0142 and +1 512 555 0142 match."""
    d = "".join(c for c in (v or "") if c.isdigit())
    return d[-10:] if len(d) >= 7 else ""


class Customer(models.Model):
    """A customer, built from orders that carry an email or phone. Only admins edit."""
    name = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True, db_index=True)
    phone = models.CharField(max_length=30, blank=True)
    phone_digits = models.CharField(max_length=15, blank=True, db_index=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["name", "email"]

    def __str__(self):
        return self.name or self.email or self.phone

    def save(self, *a, **kw):
        self.email = (self.email or "").strip().lower()
        self.phone_digits = phone_key(self.phone)
        super().save(*a, **kw)

    @classmethod
    def for_contact(cls, name="", email="", phone=""):
        email, digits = (email or "").strip().lower(), phone_key(phone)
        if not email and not digits:
            return None
        c = (email and cls.objects.filter(email=email).first()) or (digits and cls.objects.filter(phone_digits=digits).first())
        if not c:
            return cls.objects.create(name=(name or "").strip()[:120], email=email, phone=(phone or "").strip()[:30])
        changed = False
        if not c.name and name:
            c.name, changed = name.strip()[:120], True
        if not c.email and email:
            c.email, changed = email, True
        if not c.phone and phone:
            c.phone, changed = phone.strip()[:30], True
        if changed:
            c.save()
        return c


class DeliveryPartner(models.Model):
    """A delivery / ordering app the restaurant sells through: Uber Eats, DoorDash, Grubhub… (admin adds more)."""
    name = models.CharField(max_length=60, unique=True)
    emoji = models.CharField(max_length=8, blank=True, default="🛵")
    color = models.CharField(max_length=9, default="#111111", help_text="Brand colour, e.g. #06C167")
    commission_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"),
                                             help_text="What the app keeps from each order (on the food subtotal)")
    markup_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"),
                                         help_text="Menu prices on this app are this much higher than in store")
    collects_tax = models.BooleanField(default=True, help_text="The app collects and pays the sales tax "
                                       "(marketplace facilitator) — so it isn't part of the tax you pay")
    payout_schedule = models.CharField(max_length=60, blank=True, help_text="e.g. Weekly on Monday")
    account_id = models.CharField(max_length=60, blank=True, help_text="Your store / merchant ID on the app")
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class TipSettings(models.Model):
    """Tip prompt on the customer screen (one row). Admin edits."""
    enabled = models.BooleanField(default=True)
    percents = models.JSONField(default=list, blank=True)   # e.g. [2, 5]
    allow_custom = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1, defaults={"percents": [2, 5, 10, 20]})
        return obj


class DisplayState(models.Model):
    """What the customer-facing screen next to a register shows, and the tip the customer picked."""
    key = models.CharField(max_length=40, unique=True)   # "t<terminal id>" or "u<user id>"
    state = models.JSONField(default=dict, blank=True)
    tip_answer = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Awaiting payment"
        UNPAID = "unpaid", "Pay at counter"
        PAID = "paid", "Paid"
        PREPARING = "preparing", "Preparing"
        READY = "ready", "Ready for pickup"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for delivery"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        REFUNDED = "refunded", "Refunded"

    class Fulfillment(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY = "delivery", "Delivery"
        DINE_IN = "dine_in", "Dine-in"

    class Source(models.TextChoices):
        ONLINE = "online", "Website"
        POS = "pos", "Counter (POS)"
        KIOSK = "kiosk", "Self-order kiosk"
        PARTNER = "partner", "Delivery app"

    class PaymentMethod(models.TextChoices):
        STRIPE = "stripe", "Online (Stripe)"
        CASH = "cash", "Cash"
        CARD = "card", "Card (counter)"
        SPLIT = "split", "Split (cash + card)"
        PARTNER = "partner", "Paid through delivery app"

    # Statuses that count as a real sale in reports
    SALE_STATUSES = ["paid", "preparing", "ready", "out_for_delivery", "completed"]

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    fulfillment = models.CharField(max_length=10, choices=Fulfillment.choices, default=Fulfillment.PICKUP)

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.ONLINE, db_index=True)
    payment_method = models.CharField(max_length=10, choices=PaymentMethod.choices, default=PaymentMethod.STRIPE, blank=True)
    cash_received = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    change_given = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="pos_orders"
    )

    branch = models.ForeignKey("management.Branch", on_delete=models.PROTECT, null=True, blank=True,
                               related_name="orders")
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="orders")
    customer_name = models.CharField(max_length=120, blank=True)
    customer_email = models.EmailField(blank=True)
    customer_phone = models.CharField(max_length=30, blank=True)
    delivery_address = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    promo_discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    promotions = models.JSONField(default=list, blank=True)   # [{"id": 1, "name": "Wing Wednesday", "amount": "3.00"}]
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    discount_reason = models.CharField(max_length=160, blank=True)
    discount_approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                             blank=True, related_name="+")
    delivery_fee = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tax = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    tip = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"),
                              help_text="Not part of the sale or taxed; paid on top of the total")

    partner = models.ForeignKey(DeliveryPartner, on_delete=models.PROTECT, null=True, blank=True, related_name="orders")
    partner_ref = models.CharField(max_length=40, blank=True, help_text="Order # on the delivery app")
    partner_commission = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    partner_collects_tax = models.BooleanField(default=False)

    stripe_session_id = models.CharField(max_length=255, blank=True, db_index=True)
    stripe_payment_intent = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    refunded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="+")
    refund_reason = models.CharField(max_length=255, blank=True)
    ready_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    @property
    def short_number(self) -> str:
        """Short number customers hear / see on the status board, e.g. '42'."""
        return str(self.pk % 1000 or 1000) if self.pk else ""

    @property
    def partner_payout(self) -> Decimal:
        """What the delivery app should pay the restaurant for this order."""
        if not self.partner_id:
            return Decimal("0")
        return self.total - self.partner_commission - (self.tax if self.partner_collects_tax else Decimal("0"))

    @property
    def number(self) -> str:
        return f"FH-{self.pk:05d}" if self.pk else "FH-new"

    def __str__(self):
        return f"{self.number} — {self.customer_name or 'Walk-in'}"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey(MenuItem, on_delete=models.SET_NULL, null=True)
    # Snapshots so the order history stays correct if the menu changes later.
    name = models.CharField(max_length=120)
    options = models.JSONField(default=list, blank=True)  # [{"group": "Flavour", "name": "BBQ", "price_delta": "0.00"}]
    unit_price = models.DecimalField(max_digits=8, decimal_places=2)
    regular_price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True,
                                        help_text="Unit price before a promotion")
    promotion = models.CharField(max_length=80, blank=True)
    quantity = models.PositiveIntegerField(default=1)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)

    def options_display(self) -> str:
        return ", ".join(o["name"] for o in self.options)

    def __str__(self):
        return f"{self.quantity} × {self.name}"


class OrderPayment(models.Model):
    """One part of a counter payment: some cash, one card, another card…"""
    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        CARD = "card", "Card"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="payments")
    method = models.CharField(max_length=8, choices=Method.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2, help_text="Amount of the order paid this way")
    tendered = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Cash handed over")
    change = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0"))
    card_last4 = models.CharField(max_length=4, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


def method_totals(orders) -> dict:
    """Money taken per method for these orders: {"cash": x, "card": y, "stripe": z}.
    Split orders count each part; older orders (no parts) count their single method."""
    from django.db.models import Sum
    out = {"cash": Decimal("0"), "card": Decimal("0"), "stripe": Decimal("0"), "partner": Decimal("0")}
    for r in OrderPayment.objects.filter(order__in=orders).values("method").annotate(t=Sum("amount")):
        out[r["method"]] = out.get(r["method"], Decimal("0")) + (r["t"] or 0)
    for r in orders.filter(payments__isnull=True).values("payment_method").annotate(t=Sum("total")):
        if r["payment_method"]:
            out[r["payment_method"]] = out.get(r["payment_method"], Decimal("0")) + (r["t"] or 0)
    return out
