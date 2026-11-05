from django.db.models import Q
from rest_framework import generics

from .models import Category, MenuItem
from django.db.models import Prefetch
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import CategorySerializer, MenuItemDetailSerializer, MenuItemListSerializer


class CategoryListView(generics.ListAPIView):
    queryset = Category.objects.filter(is_active=True)
    serializer_class = CategorySerializer
    pagination_class = None


class MenuItemListView(generics.ListAPIView):
    """GET /api/items/?category=wings&featured=true&search=bbq"""

    serializer_class = MenuItemListSerializer
    pagination_class = None

    def get_queryset(self):
        qs = (
            MenuItem.objects.filter(is_available=True, category__is_active=True)
            .select_related("category")
            .prefetch_related("option_groups")
        )
        params = self.request.query_params
        if category := params.get("category"):
            qs = qs.filter(category__slug=category)
        if params.get("featured") in ("1", "true"):
            qs = qs.filter(is_featured=True)
        if search := params.get("search"):
            qs = qs.filter(Q(name__icontains=search) | Q(description__icontains=search))
        return qs


class MenuItemDetailView(generics.RetrieveAPIView):
    queryset = MenuItem.objects.filter(is_available=True).prefetch_related("option_groups__options")
    serializer_class = MenuItemDetailSerializer
    lookup_field = "slug"


@api_view(["GET"])
def full_menu(request):
    """Whole menu in one call (categories → available items → option groups).
    Used by the TV menu board and the printable menu card."""
    items = MenuItem.objects.filter(is_available=True).prefetch_related("option_groups__options")
    cats = Category.objects.filter(is_active=True).prefetch_related(Prefetch("items", queryset=items))
    ctx = {"request": request}
    return Response([
        {**CategorySerializer(c, context=ctx).data,
         "items": MenuItemDetailSerializer(c.items.all(), many=True, context=ctx).data}
        for c in cats
    ])
