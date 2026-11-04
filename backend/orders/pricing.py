"""Server-side price calculation. Never trust prices sent by the browser."""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from rest_framework.exceptions import ValidationError

from menu.models import MenuItem, Option

CENT = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(v).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class PricedLine:
    item: MenuItem
    quantity: int
    options: list = field(default_factory=list)  # list[Option]
    unit_price: Decimal = Decimal("0")

    @property
    def line_total(self) -> Decimal:
        return money(self.unit_price * self.quantity)

    def options_snapshot(self):
        return [
            {"group": o.group.name, "name": o.name, "price_delta": str(o.price_delta)}
            for o in self.options
        ]


def price_cart(cart_items: list[dict]) -> list[PricedLine]:
    """cart_items: [{"item_id": 1, "quantity": 2, "option_ids": [3, 4]}]"""
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

        unit = money(item.price + sum((o.price_delta for o in chosen), Decimal("0")))
        lines.append(PricedLine(item=item, quantity=int(ci["quantity"]), options=chosen, unit_price=unit))
    return lines


def totals(lines: list[PricedLine], fulfillment: str) -> dict:
    subtotal = money(sum((l.line_total for l in lines), Decimal("0")))
    delivery_fee = money(settings.DELIVERY_FEE) if fulfillment == "delivery" else Decimal("0.00")
    tax = money(subtotal * Decimal(settings.TAX_RATE))
    total = money(subtotal + delivery_fee + tax)
    return {"subtotal": subtotal, "delivery_fee": delivery_fee, "tax": tax, "total": total}


def to_cents(v: Decimal) -> int:
    return int((money(v) * 100).to_integral_value())
