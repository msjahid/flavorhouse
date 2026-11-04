from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from menu.models import MenuItem, Option


@override_settings(TAX_RATE="0.08", DELIVERY_FEE="3.99")
class PricingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)

    def setUp(self):
        self.client = APIClient()
        self.wings = MenuItem.objects.get(name="Bone-In Wings")

    def _opt(self, group, name):
        return Option.objects.get(group__item=self.wings, group__name=group, name=name).id

    def test_menu_endpoints(self):
        r = self.client.get("/api/categories/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any(c["slug"] == "wings" for c in r.json()))
        r = self.client.get("/api/items/?category=milkshakes")
        self.assertTrue(len(r.json()) >= 1)
        r = self.client.get(f"/api/items/{self.wings.slug}/")
        self.assertEqual(r.json()["option_groups"][0]["name"], "Size")

    def test_quote_uses_server_prices(self):
        payload = {"fulfillment": "delivery", "items": [{
            "item_id": self.wings.id, "quantity": 2,
            "option_ids": [self._opt("Size", "12 pieces"), self._opt("Flavour", "Nashville Hot")],
        }]}
        r = self.client.post("/api/cart/quote/", payload, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        # (9.99 + 7.00 + 0.50) * 2 = 34.98
        self.assertEqual(Decimal(r.json()["subtotal"]), Decimal("34.98"))
        self.assertEqual(Decimal(r.json()["delivery_fee"]), Decimal("3.99"))
        self.assertEqual(Decimal(r.json()["tax"]), Decimal("2.80"))

    def test_required_option_enforced(self):
        payload = {"items": [{"item_id": self.wings.id, "quantity": 1, "option_ids": []}]}
        r = self.client.post("/api/cart/quote/", payload, format="json")
        self.assertEqual(r.status_code, 400)

    def test_foreign_option_rejected(self):
        other = Option.objects.exclude(group__item=self.wings).first()
        payload = {"items": [{"item_id": self.wings.id, "quantity": 1,
                              "option_ids": [self._opt("Size", "6 pieces"), self._opt("Flavour", "Honey BBQ"), other.id]}]}
        r = self.client.post("/api/cart/quote/", payload, format="json")
        self.assertEqual(r.status_code, 400)


@override_settings(STRIPE_SECRET_KEY="sk_test_dummy", TAX_RATE="0.08", DELIVERY_FEE="3.99")
class CheckoutTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)

    def test_checkout_creates_order_and_stripe_session(self):
        from unittest import mock
        from orders.models import Order

        water = MenuItem.objects.get(name="Bottled Water")
        fake = mock.Mock(id="cs_test_123", url="https://checkout.stripe.com/c/pay/cs_test_123")
        with mock.patch("orders.views.stripe.checkout.Session.create", return_value=fake) as create:
            r = APIClient().post("/api/checkout/", {
                "customer_name": "A", "customer_email": "a@example.com", "customer_phone": "1",
                "fulfillment": "pickup", "items": [{"item_id": water.id, "quantity": 2, "price": "0.01"}],
            }, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["checkout_url"], fake.url)
        order = Order.objects.get(stripe_session_id="cs_test_123")
        self.assertEqual(order.subtotal, Decimal("2.98"))  # client-sent price ignored
        amounts = [li["price_data"]["unit_amount"] for li in create.call_args.kwargs["line_items"]]
        self.assertEqual(amounts, [149, 24])  # item + tax (cents)
