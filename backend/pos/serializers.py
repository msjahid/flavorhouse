from rest_framework import serializers

from menu.serializers import AbsoluteImageField, OptionGroupSerializer
from menu.models import Category, MenuItem
from orders.models import Order, OrderItem, OrderPayment
from orders.serializers import CartItemInputSerializer


# ---------- Menu (one call loads everything the register needs) ----------

class PosMenuItemSerializer(serializers.ModelSerializer):
    image = AbsoluteImageField(read_only=True)
    option_groups = OptionGroupSerializer(many=True, read_only=True)

    class Meta:
        model = MenuItem
        fields = ["id", "name", "slug", "price", "image", "emoji", "is_available", "option_groups"]


class PosCategorySerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "emoji", "items"]

    def get_items(self, obj):
        items = obj.items.all().prefetch_related("option_groups__options")
        return PosMenuItemSerializer(items, many=True, context=self.context).data


# ---------- Orders ----------

class PosOrderInputSerializer(serializers.Serializer):
    items = CartItemInputSerializer(many=True)
    fulfillment = serializers.ChoiceField(choices=[("dine_in", "Dine-in"), ("pickup", "Takeaway"), ("delivery", "Delivery (app courier)")])
    customer_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    customer_phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    customer_email = serializers.EmailField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    payment_method = serializers.ChoiceField(choices=[("cash", "Cash"), ("card", "Card")], required=False)
    cash_received = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    payments = serializers.ListField(child=serializers.DictField(), required=False)


class PosOrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["id", "name", "options", "unit_price", "regular_price", "promotion", "quantity", "line_total"]


class OrderPaymentSerializer(serializers.ModelSerializer):
    method_display = serializers.CharField(source="get_method_display", read_only=True)

    class Meta:
        model = OrderPayment
        fields = ["id", "method", "method_display", "amount", "tendered", "change", "card_last4"]


class PosOrderSerializer(serializers.ModelSerializer):
    payments = OrderPaymentSerializer(many=True, read_only=True)
    number = serializers.CharField(read_only=True)
    short_number = serializers.CharField(read_only=True)
    items = PosOrderItemSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    fulfillment_display = serializers.CharField(source="get_fulfillment_display", read_only=True)
    payment_method_display = serializers.CharField(source="get_payment_method_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", default=None, read_only=True)
    discount_approved_by_name = serializers.SerializerMethodField()
    refunded_by_name = serializers.SerializerMethodField()
    partner = serializers.SerializerMethodField()
    partner_payout = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "public_id", "number", "short_number", "status", "status_display", "source",
            "fulfillment", "fulfillment_display", "payment_method", "payment_method_display",
            "customer_name", "customer_email", "customer_phone", "delivery_address", "notes",
            "subtotal", "delivery_fee", "tax", "total", "cash_received", "change_given",
            "items", "created_by_name", "created_at", "paid_at", "refunded_at", "ready_at",
            "branch", "branch_name", "discount_percent", "discount_amount", "discount_reason",
            "discount_approved_by_name", "refunded_by_name", "refund_reason", "promo_discount", "promotions",
            "payments", "tip", "partner", "partner_ref", "partner_commission", "partner_collects_tax", "partner_payout",
        ]

    def get_partner(self, obj):
        p = obj.partner
        return {"id": p.id, "name": p.name, "emoji": p.emoji, "color": p.color} if p else None

    @staticmethod
    def _name(u):
        return (u.get_full_name() or u.username) if u else None

    def get_created_by_name(self, obj):
        return self._name(obj.created_by)

    def get_discount_approved_by_name(self, obj):
        return self._name(obj.discount_approved_by)

    def get_refunded_by_name(self, obj):
        return self._name(obj.refunded_by)


class StatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["preparing", "ready", "out_for_delivery", "completed", "cancelled"])


class KioskOrderInputSerializer(serializers.Serializer):
    items = CartItemInputSerializer(many=True)
    fulfillment = serializers.ChoiceField(choices=[("dine_in", "Eat here"), ("pickup", "Take away")])
    customer_name = serializers.CharField(max_length=40)


class PayInputSerializer(serializers.Serializer):
    payment_method = serializers.ChoiceField(choices=[("cash", "Cash"), ("card", "Card")], required=False)
    cash_received = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    payments = serializers.ListField(child=serializers.DictField(), required=False)
