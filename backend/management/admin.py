from django.contrib import admin

from .models import BankDeposit, Branch, CashDrop, DailyClose, Notification, Purchase, PurchaseLine, StaffProfile, TimeEntry


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "state", "min_wage", "opening_float", "is_active"]


@admin.register(StaffProfile)
class StaffProfileAdmin(admin.ModelAdmin):
    list_display = ["employee_id", "name", "role", "branch", "status", "pay_type", "hourly_rate", "pay_method"]
    list_filter = ["role", "status", "branch", "pay_type"]
    search_fields = ["employee_id", "user__first_name", "user__last_name", "user__email"]
    raw_id_fields = ["user", "created_by", "reviewed_by"]


@admin.register(TimeEntry)
class TimeEntryAdmin(admin.ModelAdmin):
    list_display = ["staff", "branch", "clock_in", "clock_out", "hours", "tips"]
    list_filter = ["branch"]


class PurchaseLineInline(admin.TabularInline):
    model = PurchaseLine
    extra = 0


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ["id", "purchase_date", "branch", "vendor", "category", "total", "status", "submitted_by"]
    list_filter = ["status", "branch", "category"]
    search_fields = ["vendor", "invoice_number", "reason"]
    inlines = [PurchaseLineInline]


@admin.register(CashDrop)
class CashDropAdmin(admin.ModelAdmin):
    list_display = ["created_at", "branch", "kind", "amount", "made_by"]
    list_filter = ["branch", "kind"]


@admin.register(DailyClose)
class DailyCloseAdmin(admin.ModelAdmin):
    list_display = ["date", "branch", "expected_cash", "counted_cash", "over_short", "total_sales", "closed_by"]
    list_filter = ["branch"]


@admin.register(BankDeposit)
class BankDepositAdmin(admin.ModelAdmin):
    list_display = ["date", "branch", "amount", "bank_name", "slip_number", "deposited_by", "verified_by"]
    list_filter = ["branch"]


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "recipient", "title", "is_read"]
