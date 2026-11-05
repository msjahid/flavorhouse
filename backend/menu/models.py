from decimal import Decimal

from django.db import models
from django.utils.text import slugify


class Category(models.Model):
    """Menu section, e.g. Wings, Burgers, Drinks, Milkshakes, Cakes."""

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=90, unique=True, blank=True)
    description = models.CharField(max_length=255, blank=True)
    image = models.ImageField(upload_to="categories/", blank=True, null=True)
    emoji = models.CharField(max_length=8, blank=True, help_text="Shown when no image is uploaded")
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class MenuItem(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="items")
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=8, decimal_places=2)
    image = models.ImageField(upload_to="menu/", blank=True, null=True)
    emoji = models.CharField(max_length=8, blank=True)
    is_available = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    is_spicy = models.BooleanField(default=False)
    is_vegetarian = models.BooleanField(default=False)
    calories = models.PositiveIntegerField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category__sort_order", "sort_order", "name"]

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or "item"
            slug, n = base, 2
            while MenuItem.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{n}"
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class OptionGroup(models.Model):
    """A choice the customer makes for an item, e.g. 'Flavour', 'Size', 'Extras'."""

    item = models.ForeignKey(MenuItem, on_delete=models.CASCADE, related_name="option_groups")
    name = models.CharField(max_length=80)
    required = models.BooleanField(default=False)
    min_select = models.PositiveIntegerField(default=0)
    max_select = models.PositiveIntegerField(default=1, help_text="1 = single choice")
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return f"{self.item.name} — {self.name}"


class Option(models.Model):
    group = models.ForeignKey(OptionGroup, on_delete=models.CASCADE, related_name="options")
    name = models.CharField(max_length=80)
    price_delta = models.DecimalField(max_digits=6, decimal_places=2, default=Decimal("0.00"))
    is_available = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name



class Promotion(models.Model):
    """Happy hour, day offers, promo codes. Applied automatically when the rules match."""

    class Kind(models.TextChoices):
        PERCENT = "percent", "% off"
        AMOUNT = "amount", "$ off each item"
        PRICE = "price", "Special price (each item)"

    class AppliesTo(models.TextChoices):
        ALL = "all", "Whole menu"
        CATEGORY = "category", "One category"
        ITEMS = "items", "Chosen items"

    name = models.CharField(max_length=80, help_text="Shown to customers, e.g. 'Wing Wednesday'")
    description = models.CharField(max_length=200, blank=True)
    kind = models.CharField(max_length=8, choices=Kind.choices, default=Kind.PERCENT)
    value = models.DecimalField(max_digits=8, decimal_places=2)
    applies_to = models.CharField(max_length=8, choices=AppliesTo.choices, default=AppliesTo.CATEGORY)
    category = models.ForeignKey(Category, on_delete=models.CASCADE, null=True, blank=True, related_name="promotions")
    items = models.ManyToManyField(MenuItem, blank=True, related_name="promotions")
    days = models.JSONField(default=list, blank=True, help_text="0=Mon … 6=Sun; empty = every day")
    start_time = models.TimeField(null=True, blank=True, help_text="Happy hour start (empty = all day)")
    end_time = models.TimeField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    branches = models.ManyToManyField("management.Branch", blank=True, related_name="promotions",
                                      help_text="Empty = every store")
    channels = models.JSONField(default=list, blank=True, help_text='["online","pos","kiosk"]; empty = everywhere')
    code = models.CharField(max_length=30, blank=True, help_text="Optional promo code customers must enter online")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_active", "name"]

    def __str__(self):
        return self.name
