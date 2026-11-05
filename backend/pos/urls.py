from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.login, name="pos-login"),
    path("logout/", views.logout, name="pos-logout"),
    path("me/", views.me, name="pos-me"),
    path("authorize/", views.authorize, name="pos-authorize"),
    path("clock/", views.clock, name="pos-clock"),
    path("day/", views.day, name="pos-day"),
    path("device/", views.device, name="pos-device"),
    path("menu/", views.menu, name="pos-menu"),
    path("items/<int:item_id>/availability/", views.toggle_item, name="pos-item-availability"),
    path("orders/summary/", views.orders_summary, name="pos-orders-summary"),
    path("orders/", views.orders, name="pos-orders"),
    path("orders/<int:order_id>/", views.order_detail, name="pos-order-detail"),
    path("orders/<int:order_id>/status/", views.order_status, name="pos-order-status"),
    path("orders/<int:order_id>/refund/", views.order_refund, name="pos-order-refund"),
    path("orders/<int:order_id>/pay/", views.order_pay, name="pos-order-pay"),
    path("kiosk/orders/", views.kiosk_order, name="pos-kiosk-order"),
    path("display/", views.display, name="pos-display"),
    path("display/tip/", views.display_tip, name="pos-display-tip"),
    path("board/", views.status_board, name="pos-status-board"),
    path("reports/daily/", views.daily_report, name="pos-daily-report"),
]
