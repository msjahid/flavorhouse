from rest_framework import serializers

from .models import Category, MenuItem, Option, OptionGroup


class AbsoluteImageField(serializers.ImageField):
    """Return a full URL for images (works for local media and S3)."""

    def to_representation(self, value):
        if not value:
            return None
        url = value.url
        if url.startswith("http"):
            return url
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url


class OptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Option
        fields = ["id", "name", "price_delta"]


class OptionGroupSerializer(serializers.ModelSerializer):
    options = serializers.SerializerMethodField()

    class Meta:
        model = OptionGroup
        fields = ["id", "name", "required", "min_select", "max_select", "options"]

    def get_options(self, obj):
        return OptionSerializer(obj.options.filter(is_available=True), many=True).data


class MenuItemListSerializer(serializers.ModelSerializer):
    image = AbsoluteImageField(read_only=True)
    category = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    has_options = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "slug", "description", "price", "image", "emoji",
            "category", "is_featured", "is_spicy", "is_vegetarian", "calories", "has_options",
        ]

    def get_has_options(self, obj):
        return obj.option_groups.exists()


class MenuItemDetailSerializer(MenuItemListSerializer):
    option_groups = OptionGroupSerializer(many=True, read_only=True)

    class Meta(MenuItemListSerializer.Meta):
        fields = MenuItemListSerializer.Meta.fields + ["option_groups"]


class CategorySerializer(serializers.ModelSerializer):
    image = AbsoluteImageField(read_only=True)
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "image", "emoji", "item_count"]

    def get_item_count(self, obj):
        return obj.items.filter(is_available=True).count()
