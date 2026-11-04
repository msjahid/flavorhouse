from django.contrib import admin
from django.utils.html import format_html

from .models import Category, MenuItem, Option, OptionGroup


def thumb(obj):
    if obj.image:
        return format_html('<img src="{}" style="height:48px;width:48px;object-fit:cover;border-radius:8px"/>', obj.image.url)
    return obj.emoji or "—"


thumb.short_description = "Image"


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = [thumb, "name", "slug", "sort_order", "is_active"]
    list_display_links = ["name"]
    list_editable = ["sort_order", "is_active"]
    prepopulated_fields = {"slug": ("name",)}


class OptionInline(admin.TabularInline):
    model = Option
    extra = 1


@admin.register(OptionGroup)
class OptionGroupAdmin(admin.ModelAdmin):
    list_display = ["name", "item", "required", "min_select", "max_select"]
    list_filter = ["item__category"]
    search_fields = ["name", "item__name"]
    inlines = [OptionInline]


class OptionGroupInline(admin.StackedInline):
    model = OptionGroup
    extra = 0
    show_change_link = True
    fields = ["name", "required", "min_select", "max_select", "sort_order"]


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = [thumb, "name", "category", "price", "is_available", "is_featured"]
    list_display_links = ["name"]
    list_editable = ["price", "is_available", "is_featured"]
    list_filter = ["category", "is_available", "is_featured", "is_spicy", "is_vegetarian"]
    search_fields = ["name", "description"]
    prepopulated_fields = {"slug": ("name",)}
    inlines = [OptionGroupInline]
