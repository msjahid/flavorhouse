from django.contrib import admin

from .models import Order, OrderItem


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    can_delete = False
    readonly_fields = ["name", "options_display", "unit_price", "quantity", "line_total"]
    fields = readonly_fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["number", "branch", "customer_name", "source", "fulfillment", "payment_method", "status", "total", "created_at"]
    list_filter = ["branch", "status", "source", "payment_method", "fulfillment", "created_at"]
    list_editable = ["status"]
    search_fields = ["customer_name", "customer_email", "customer_phone", "stripe_session_id"]
    readonly_fields = ["public_id", "subtotal", "delivery_fee", "tax", "total",
                       "stripe_session_id", "stripe_payment_intent", "created_at", "paid_at", "refunded_at",
                       "cash_received", "change_given", "created_by"]
    inlines = [OrderItemInline]
