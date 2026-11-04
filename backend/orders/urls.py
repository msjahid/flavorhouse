from django.urls import path

from . import views

urlpatterns = [
    path("cart/quote/", views.quote, name="cart-quote"),
    path("checkout/", views.create_checkout_session, name="checkout"),
    path("orders/session/<str:session_id>/", views.order_by_session, name="order-by-session"),
    path("orders/<uuid:public_id>/", views.order_detail, name="order-detail"),
    path("stripe/webhook/", views.stripe_webhook, name="stripe-webhook"),
]
