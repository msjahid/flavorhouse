from django.urls import path

from . import views

urlpatterns = [
    path("categories/", views.CategoryListView.as_view(), name="category-list"),
    path("items/", views.MenuItemListView.as_view(), name="item-list"),
    path("items/<slug:slug>/", views.MenuItemDetailView.as_view(), name="item-detail"),
]
