from rest_framework import serializers

from .models import Order, OrderItem


class CartItemInputSerializer(serializers.Serializer):
    item_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1, max_value=50)
    option_ids = serializers.ListField(child=serializers.IntegerField(), required=False, default=list)


class CheckoutInputSerializer(serializers.Serializer):
    customer_name = serializers.CharField(max_length=120)
    customer_email = serializers.EmailField()
    customer_phone = serializers.CharField(max_length=30)
    fulfillment = serializers.ChoiceField(choices=Order.Fulfillment.choices)
    delivery_address = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=500)
    items = CartItemInputSerializer(many=True)

    def validate(self, data):
        if data["fulfillment"] == Order.Fulfillment.DELIVERY and not data.get("delivery_address", "").strip():
            raise serializers.ValidationError({"delivery_address": "Delivery address is required."})
        return data


class QuoteInputSerializer(serializers.Serializer):
    fulfillment = serializers.ChoiceField(choices=Order.Fulfillment.choices, default="pickup")
    items = CartItemInputSerializer(many=True)


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["name", "options", "unit_price", "quantity", "line_total"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    number = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Order
        fields = [
            "public_id", "number", "status", "status_display", "fulfillment",
            "customer_name", "customer_email", "delivery_address",
            "subtotal", "delivery_fee", "tax", "total", "items", "created_at", "paid_at",
        ]
