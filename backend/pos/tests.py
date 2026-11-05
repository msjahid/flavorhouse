from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from django.utils import timezone
from management.auth import hash_key
from management.models import Branch, DayOpen, StaffProfile, Terminal
from menu.models import MenuItem, Option
from orders.models import Order


def make_staff(username, role="employee", branch=None, password="pass12345", **extra):
    user = get_user_model().objects.create_user(username, password=password, first_name=username.title())
    branch = branch if branch is not None or role in ("supervisor", "superadmin", "admin") else \
        Branch.objects.get_or_create(name="Main", code="main")[0]
    StaffProfile.objects.create(user=user, employee_id=username.upper(), role=role, branch=branch,
                                status="active", hourly_rate=15, **extra)
    if branch:
        Terminal.objects.get_or_create(branch=branch, name="Test", defaults={"key_hash": hash_key("testdev")})
        DayOpen.objects.get_or_create(branch=branch, date=timezone.localdate(), defaults={"opening_float": 200})
    return user


@override_settings(TAX_RATE="0.08", DELIVERY_FEE="3.99")
class PosTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)
        User = get_user_model()
        cls.staff = make_staff("cashier", role="manager")
        cls.customer = User.objects.create_user("bob", password="pass12345", is_staff=False)

    def setUp(self):
        self.c = APIClient()
        r = self.c.post("/api/pos/login/", {"username": "cashier", "password": "pass12345", "device_key": "testdev"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.c.credentials(HTTP_AUTHORIZATION=f"Token {r.json()['token']}", HTTP_X_DEVICE_KEY="testdev")
        self.water = MenuItem.objects.get(name="Bottled Water")      # 1.49, no options
        self.wings = MenuItem.objects.get(name="Bone-In Wings")

    def _wings_line(self):
        size = Option.objects.get(group__item=self.wings, group__name="Size", name="6 pieces").id
        flav = Option.objects.get(group__item=self.wings, group__name="Flavour", name="Honey BBQ").id
        return {"item_id": self.wings.id, "quantity": 1, "option_ids": [size, flav]}

    def test_requires_staff_login(self):
        self.assertEqual(APIClient().get("/api/pos/menu/").status_code, 401)
        r = APIClient().post("/api/pos/login/", {"username": "bob", "password": "pass12345"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = APIClient().post("/api/pos/login/", {"username": "cashier", "password": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_menu(self):
        r = self.c.get("/api/pos/menu/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any(c["slug"] == "wings" for c in r.json()["categories"]))

    def test_cash_sale_with_change(self):
        r = self.c.post("/api/pos/orders/", {
            "items": [{"item_id": self.water.id, "quantity": 2}, self._wings_line()],
            "fulfillment": "dine_in", "customer_name": "Table 4",
            "payment_method": "cash", "cash_received": "20.00",
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        o = r.json()
        # subtotal 2.98 + 9.99 = 12.97, tax 1.04, total 14.01, change 5.99
        self.assertEqual(Decimal(o["total"]), Decimal("14.01"))
        self.assertEqual(Decimal(o["change_given"]), Decimal("5.99"))
        self.assertEqual(o["status"], "paid")
        self.assertEqual(o["source"], "pos")
        self.assertEqual(o["created_by_name"], "Cashier")
        self.assertEqual(Decimal(o["delivery_fee"]), Decimal("0"))

    def test_cash_too_little_rejected(self):
        r = self.c.post("/api/pos/orders/", {
            "items": [{"item_id": self.water.id, "quantity": 1}],
            "fulfillment": "pickup", "payment_method": "cash", "cash_received": "1.00",
        }, format="json")
        self.assertEqual(r.status_code, 400)

    def test_card_sale_status_flow_and_report(self):
        r = self.c.post("/api/pos/orders/", {
            "items": [self._wings_line()], "fulfillment": "pickup", "payment_method": "card",
        }, format="json")
        oid = r.json()["id"]
        for st in ["preparing", "ready", "completed"]:
            r = self.c.post(f"/api/pos/orders/{oid}/status/", {"status": st}, format="json")
            self.assertEqual(r.json()["status"], st)

        r = self.c.get("/api/pos/orders/?status=completed")
        self.assertEqual(len(r.json()), 1)

        rep = self.c.get("/api/pos/reports/daily/").json()
        self.assertEqual(rep["orders"], 1)
        self.assertEqual(Decimal(rep["gross"]), Decimal("10.79"))  # 9.99 + 0.80 tax
        self.assertEqual(rep["by_payment"][0]["key"], "card")
        self.assertEqual(rep["top_items"][0]["name"], "Bone-In Wings")
        self.assertEqual(sum(h["count"] for h in rep["by_hour"]), 1)

    def test_refund_cash_order_excluded_from_sales(self):
        oid = self.c.post("/api/pos/orders/", {
            "items": [{"item_id": self.water.id, "quantity": 1}], "fulfillment": "pickup", "payment_method": "cash",
        }, format="json").json()["id"]
        r = self.c.post(f"/api/pos/orders/{oid}/refund/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["order"]["status"], "refunded")
        rep = self.c.get("/api/pos/reports/daily/").json()
        self.assertEqual(rep["orders"], 0)
        self.assertEqual(rep["refunds"]["count"], 1)
        # Can't refund twice
        self.assertEqual(self.c.post(f"/api/pos/orders/{oid}/refund/").status_code, 400)

    @override_settings(STRIPE_SECRET_KEY="sk_test_dummy")
    def test_refund_online_order_calls_stripe(self):
        o = Order.objects.create(customer_name="Web", customer_email="w@example.com", status="paid",
                                 branch=Branch.objects.get(code="main"),
                                 payment_method="stripe", stripe_payment_intent="pi_123", total=Decimal("5"))
        with mock.patch("pos.views.stripe.Refund.create") as refund:
            r = self.c.post(f"/api/pos/orders/{o.id}/refund/")
        self.assertEqual(r.status_code, 200, r.content)
        refund.assert_called_once_with(payment_intent="pi_123")

    def test_sold_out_toggle_blocks_sale(self):
        self.c.post(f"/api/pos/items/{self.water.id}/availability/", {"is_available": False}, format="json")
        r = self.c.post("/api/pos/orders/", {
            "items": [{"item_id": self.water.id, "quantity": 1}], "fulfillment": "pickup", "payment_method": "card",
        }, format="json")
        self.assertEqual(r.status_code, 400)


@override_settings(TAX_RATE="0.08", DELIVERY_FEE="3.99")
class KioskAndBoardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)
        make_staff("kiosk", role="employee")
        make_staff("boss", role="manager")

    def setUp(self):
        self.c = APIClient()
        token = self.c.post("/api/pos/login/", {"username": "kiosk", "password": "pass12345", "device_key": "testdev"},
                            format="json").json()["token"]
        self.c.credentials(HTTP_AUTHORIZATION=f"Token {token}", HTTP_X_DEVICE_KEY="testdev")
        self.water = MenuItem.objects.get(name="Bottled Water")

    def _manager(self):
        c = APIClient()
        t = c.post("/api/pos/login/", {"username": "BOSS", "password": "pass12345"}, format="json").json()["token"]
        c.credentials(HTTP_AUTHORIZATION=f"Token {t}")
        return c

    def _kiosk_order(self, name="Alex Smith"):
        r = self.c.post("/api/pos/kiosk/orders/", {
            "items": [{"item_id": self.water.id, "quantity": 2}], "fulfillment": "pickup", "customer_name": name,
        }, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_kiosk_requires_login(self):
        r = APIClient().post("/api/pos/kiosk/orders/", {}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_full_flow_kiosk_pay_kitchen_board(self):
        o = self._kiosk_order()
        self.assertEqual(o["status"], "unpaid")
        self.assertEqual(o["source"], "kiosk")
        self.assertEqual(o["short_number"], str(o["id"] % 1000))

        # Unpaid: not on the board, not in sales, can't go to the kitchen
        board = APIClient().get("/api/pos/board/").json()
        self.assertEqual(board["preparing"], [])
        self.assertEqual(self.c.post(f"/api/pos/orders/{o['id']}/status/", {"status": "preparing"}, format="json").status_code, 400)
        self.assertEqual(self._manager().get("/api/pos/reports/daily/").json()["orders"], 0)

        # Cashier takes cash
        r = self.c.post(f"/api/pos/orders/{o['id']}/pay/", {"payment_method": "cash", "cash_received": "5.00"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        paid = r.json()
        self.assertEqual(paid["status"], "paid")
        self.assertEqual(Decimal(paid["change_given"]), Decimal("1.78"))  # total 3.22
        self.assertEqual(self.c.post(f"/api/pos/orders/{o['id']}/pay/", {"payment_method": "card"}, format="json").status_code, 400)

        board = APIClient().get("/api/pos/board/").json()
        self.assertEqual([x["name"] for x in board["preparing"]], ["Alex"])  # first name only

        self.c.post(f"/api/pos/orders/{o['id']}/status/", {"status": "ready"}, format="json")
        board = APIClient().get("/api/pos/board/").json()
        self.assertEqual(board["preparing"], [])
        self.assertEqual(board["ready"][0]["number"], paid["short_number"])

        self.c.post(f"/api/pos/orders/{o['id']}/status/", {"status": "completed"}, format="json")
        self.assertEqual(APIClient().get("/api/pos/board/").json()["ready"], [])
        self.assertEqual(self._manager().get("/api/pos/reports/daily/").json()["orders"], 1)

    def test_unpaid_can_be_cancelled_not_refunded(self):
        o = self._kiosk_order()
        self.assertEqual(self.c.post(f"/api/pos/orders/{o['id']}/refund/").status_code, 400)
        r = self.c.post(f"/api/pos/orders/{o['id']}/status/", {"status": "cancelled"}, format="json")
        self.assertEqual(r.json()["status"], "cancelled")

    def test_board_hides_delivery_orders(self):
        Order.objects.create(customer_name="Del", status="paid", fulfillment="delivery", total=Decimal("5"))
        self.assertEqual(APIClient().get("/api/pos/board/").json()["preparing"], [])
