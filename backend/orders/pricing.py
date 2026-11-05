"""Server-side price calculation. Never trust prices sent by the browser."""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from menu.models import MenuItem, Option, Promotion

CENT = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(v).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class PricedLine:
    item: MenuItem
    quantity: int
    options: list = field(default_factory=list)  # list[Option]
    unit_price: Decimal = Decimal("0")
    regular_price: Decimal | None = None   # before a promotion
    promotion: Promotion | None = None

    @property
    def savings(self) -> Decimal:
        return money((self.regular_price - self.unit_price) * self.quantity) if self.promotion else Decimal("0.00")

    @property
    def line_total(self) -> Decimal:
        return money(self.unit_price * self.quantity)

    def options_snapshot(self):
        return [
            {"group": o.group.name, "name": o.name, "price_delta": str(o.price_delta)}
            for o in self.options
        ]


def active_promotions(branch_id=None, channel: str = "online", code: str = "", when=None):
    """Offers running right now for this store and channel (website / pos / kiosk)."""
    now = timezone.localtime(when or timezone.now())
    today, t = now.date(), now.time()
    qs = Promotion.objects.filter(is_active=True).filter(
        Q(start_date__isnull=True) | Q(start_date__lte=today), Q(end_date__isnull=True) | Q(end_date__gte=today),
    ).prefetch_related("items", "branches")
    code = (code or "").strip().upper()
    out = []
    for p in qs:
        if p.days and now.weekday() not in p.days:
            continue
        if p.start_time and p.end_time:
            inside = p.start_time <= t < p.end_time if p.start_time < p.end_time else (t >= p.start_time or t < p.end_time)
            if not inside:
                continue
        if p.channels and channel not in p.channels:
            continue
        branch_ids = [b.id for b in p.branches.all()]
        if branch_ids and (branch_id is None or int(branch_id) not in branch_ids):
            continue
        if p.code and p.code.upper() != code:
            continue
        out.append(p)
    return out


def _promo_price(p: Promotion, item: MenuItem, unit: Decimal, options_delta: Decimal) -> Decimal | None:
    if p.applies_to == "category" and p.category_id != item.category_id:
        return None
    if p.applies_to == "items" and item.pk not in {i.pk for i in p.items.all()}:
        return None
    if p.kind == "percent":
        return money(unit * (Decimal("100") - p.value) / 100)
    if p.kind == "amount":
        return money(max(Decimal("0"), unit - p.value))
    if p.kind == "price":
        return money(p.value + options_delta)
    return None


def price_cart(cart_items: list[dict], ctx: dict | None = None) -> list[PricedLine]:
    """cart_items: [{"item_id": 1, "quantity": 2, "option_ids": [3, 4]}]
    ctx: {"branch_id": 1, "channel": "online|pos|kiosk", "code": "WINGS10"} — used to apply offers."""
    ctx = ctx or {}
    # Delivery-app orders: the app's prices (menu price + markup), and the store's own offers don't apply
    markup = Decimal(str(ctx.get("markup") or 0))
    promos = [] if ctx.get("channel") == "partner" else \
        active_promotions(ctx.get("branch_id"), ctx.get("channel", "online"), ctx.get("code", ""))
    if not cart_items:
        raise ValidationError({"items": "Your cart is empty."})

    lines: list[PricedLine] = []
    for idx, ci in enumerate(cart_items):
        try:
            item = MenuItem.objects.prefetch_related("option_groups__options").get(
                pk=ci["item_id"], is_available=True, category__is_active=True
            )
        except MenuItem.DoesNotExist:
            raise ValidationError({"items": f"Item #{idx + 1} is no longer available."})

        option_ids = set(ci.get("option_ids") or [])
        chosen = list(
            Option.objects.filter(pk__in=option_ids, group__item=item, is_available=True).select_related("group")
        )
        if len(chosen) != len(option_ids):
            raise ValidationError({"items": f"Invalid options for {item.name}."})

        for group in item.option_groups.all():
            count = sum(1 for o in chosen if o.group_id == group.id)
            minimum = max(group.min_select, 1 if group.required else 0)
            if count < minimum:
                raise ValidationError({"items": f"Please choose {group.name} for {item.name}."})
            if count > group.max_select:
                raise ValidationError({"items": f"Too many {group.name} choices for {item.name} (max {group.max_select})."})

        delta = sum((o.price_delta for o in chosen), Decimal("0"))
        unit = money(item.price + delta)
        if markup:
            unit = money(unit * (Decimal("100") + markup) / 100)
        line = PricedLine(item=item, quantity=int(ci["quantity"]), options=chosen, unit_price=unit)
        best = None
        for p in promos:  # the customer always gets the best matching offer
            price = _promo_price(p, item, unit, delta)
            if price is not None and price < unit and (best is None or price < best[0]):
                best = (price, p)
        if best:
            line.regular_price, line.unit_price, line.promotion = unit, best[0], best[1]
        lines.append(line)
    return lines


def promo_summary(lines: list[PricedLine]) -> tuple[Decimal, list]:
    """Total saved by offers + [{"name", "amount"}] for the order record."""
    by = {}
    for l in lines:
        if l.promotion:
            by[l.promotion.name] = by.get(l.promotion.name, Decimal("0")) + l.savings
    return money(sum(by.values(), Decimal("0"))), [{"name": k, "amount": str(money(v))} for k, v in by.items()]


def totals(lines: list[PricedLine], fulfillment: str, discount_percent: Decimal | int = 0) -> dict:
    """Subtotal → minus discount → plus tax (on the discounted amount) and delivery fee."""
    subtotal = money(sum((l.line_total for l in lines), Decimal("0")))
    pct = Decimal(str(discount_percent or 0))
    discount = money(subtotal * pct / 100)
    delivery_fee = money(settings.DELIVERY_FEE) if fulfillment == "delivery" else Decimal("0.00")
    tax = money((subtotal - discount) * Decimal(settings.TAX_RATE))
    total = money(subtotal - discount + delivery_fee + tax)
    return {"subtotal": subtotal, "discount_amount": discount, "delivery_fee": delivery_fee, "tax": tax, "total": total}


def to_cents(v: Decimal) -> int:
    return int((money(v) * 100).to_integral_value())
