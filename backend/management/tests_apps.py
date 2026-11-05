"""Delivery apps (Uber Eats, DoorDash, Grubhub…), tips and the customer screen."""
from decimal import Decimal

from django.utils import timezone

from orders.models import DeliveryPartner, Order, TipSettings

from . import tests_roles

Base = tests_roles.RoleWiseTests
del tests_roles


class AppTests(Base):  # noqa: F821
    def app_order(self, c, partner, ref="A1B2", **extra):
        body = {"items": [{"item_id": self.water.id, "quantity": 2}], "fulfillment": "delivery",
                "partner": partner.id, "partner_ref": ref, "customer_name": "Sam K.", **extra}
        return c.post("/api/pos/orders/", body, format="json")

    def test_seeded_apps_and_admin_only_edits(self):
        names = [a["name"] for a in self.c("mgr1").get("/api/manage/delivery-apps/").json()["apps"]]
        self.assertEqual(names, ["Uber Eats", "DoorDash", "Grubhub"])
        self.assertEqual(self.c("emp1").get("/api/manage/delivery-apps/").status_code, 403)
        body = {"name": "Postmates", "commission_percent": "25", "markup_percent": "10", "color": "#000000"}
        self.assertEqual(self.c("sa1").post("/api/manage/delivery-apps/", body, format="json").status_code, 403)
        r = self.c("adm1").post("/api/manage/delivery-apps/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.c("adm1").post("/api/manage/delivery-apps/", body, format="json").status_code, 400)  # duplicate
        pid = r.json()["id"]
        self.assertEqual(self.c("adm1").patch(f"/api/manage/delivery-apps/{pid}/", {"color": "red"}, format="json").status_code, 400)
        self.assertEqual(self.c("adm1").patch(f"/api/manage/delivery-apps/{pid}/", {"is_active": False}, format="json").json()["is_active"], False)
        # Turned-off apps don't show on the register
        self.assertNotIn("Postmates", [p["name"] for p in self.c("emp1").get("/api/pos/menu/").json()["partners"]])

    def test_app_order_prices_fees_and_tax(self):
        ue = DeliveryPartner.objects.get(name="Uber Eats")
        ue.markup_percent = Decimal("20")
        ue.save()
        emp = self.c("emp1")
        self.assertEqual(self.app_order(emp, ue, ref="").status_code, 400)                      # app order # required
        r = self.app_order(emp, ue)
        self.assertEqual(r.status_code, 201, r.content)
        o = Order.objects.get(pk=r.json()["id"])
        unit = (self.water.price * Decimal("1.2")).quantize(Decimal("0.01"))
        self.assertEqual(o.items.first().unit_price, unit)                                       # app prices = menu + 20%
        self.assertEqual(o.payment_method, "partner")
        self.assertEqual(o.source, "partner")
        self.assertEqual(o.delivery_fee, Decimal("0.00"))
        self.assertEqual(o.partner_commission, (o.subtotal * Decimal("0.30")).quantize(Decimal("0.01")))
        self.assertTrue(o.partner_collects_tax)
        self.assertEqual(o.partner_payout, o.total - o.partner_commission - o.tax)
        self.assertEqual(self.app_order(emp, ue).status_code, 400)                               # same app order twice
        # Quote shows the app price too
        q = emp.post("/api/cart/quote/", {"items": [{"item_id": self.water.id, "quantity": 1}], "fulfillment": "pickup",
                                          "partner": ue.id}, format="json").json()
        self.assertEqual(Decimal(q["subtotal"]), unit)
        # Not in the cash drawer; app fee comes off profit; tax the app pays is not "your" tax
        self.sale(self.c("mgr1"))
        close = self.c("mgr1").get("/api/manage/cash/close/", {"branch": self.a.id}).json()
        numbers = close.get("numbers", close)
        self.assertEqual(Decimal(numbers["app_sales"]), o.total)
        today = timezone.localdate().isoformat()
        tax = self.c("sa1").get("/api/manage/reports/tax/", {"from": today, "to": today, "group": "day"}).json()["total"]
        self.assertEqual(Decimal(tax["app_tax"]), o.tax)
        self.assertEqual(Decimal(tax["net_tax"]), Decimal(tax["tax_collected"]) - o.tax)
        rep = self.c("mgr1").get("/api/manage/reports/delivery-apps/", {"period": "today"}).json()
        ue_row = next(a for a in rep["apps"] if a["name"] == "Uber Eats")
        self.assertEqual(ue_row["orders"], 1)
        self.assertEqual(Decimal(ue_row["payout"]), o.partner_payout)
        self.assertEqual(self.c("emp1").get("/api/manage/reports/delivery-apps/").status_code, 403)

    def test_tip_with_split_payment(self):
        mgr = self.c("mgr1")
        q = mgr.post("/api/cart/quote/", {"items": [{"item_id": self.water.id, "quantity": 2}], "fulfillment": "pickup"}, format="json").json()
        total = Decimal(q["total"])
        tip = Decimal("1.00")
        # Payments must cover total + tip
        bad = mgr.post("/api/pos/orders/", {"items": [{"item_id": self.water.id, "quantity": 2}], "fulfillment": "pickup", "tip": "1.00", "payments": [{"method": "card", "amount": str(total)}]}, format="json")
        self.assertEqual(bad.status_code, 400)
        r = mgr.post("/api/pos/orders/", {"items": [{"item_id": self.water.id, "quantity": 2}], "fulfillment": "pickup", "tip": "1.00",
                      "payments": [{"method": "cash", "amount": "1.00", "tendered": "5.00"}, {"method": "card", "amount": str(total)}]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        o = Order.objects.get(pk=r.json()["id"])
        self.assertEqual((o.tip, o.total), (tip, total))                 # tip is not part of the sale
        self.assertEqual(self.sale(mgr, tip=str(total + 1)).status_code, 400)
        s = mgr.get("/api/pos/orders/summary/").json()
        self.assertEqual(s["tips"], "1.00")
        self.assertEqual(Decimal(s["sales"]), total)

    def test_customer_screen_tip_prompt(self):
        TipSettings.objects.update(percents=[2, 5], allow_custom=True, enabled=True)
        from rest_framework.test import APIClient
        reg = APIClient()                         # the register's browser (whoever is signed in)
        reg.credentials(HTTP_X_SCREEN_ID="reg-browser-123456")
        r = reg.post("/api/pos/display/", {"state": {"mode": "tip", "request_id": "x1", "base": "50.00"}}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["tips"]["percents"], [2.0, 5.0])
        # The customer screen: same screen ID, nobody signed in
        screen = APIClient()
        screen.credentials(HTTP_X_SCREEN_ID="reg-browser-123456")
        self.assertEqual(screen.get("/api/pos/display/").json()["state"]["mode"], "tip")
        self.assertEqual(screen.post("/api/pos/display/tip/", {"request_id": "x1", "choice": "percent", "percent": 10}, format="json").status_code, 400)
        self.assertEqual(screen.post("/api/pos/display/tip/", {"request_id": "old", "choice": "none"}, format="json").status_code, 400)
        a = screen.post("/api/pos/display/tip/", {"request_id": "x1", "choice": "percent", "percent": 5}, format="json").json()
        self.assertEqual(a["tip_answer"]["tip"], "2.50")
        self.assertEqual(reg.get("/api/pos/display/").json()["tip_answer"]["tip"], "2.50")
        # No screen ID → nothing; another register's screen sees nothing of this one
        self.assertEqual(APIClient().get("/api/pos/display/").status_code, 400)
        other = APIClient()
        other.credentials(HTTP_X_SCREEN_ID="another-register-99")
        self.assertEqual(other.get("/api/pos/display/").json()["state"], {})
        # Custom amount; a new question clears the old answer
        reg.post("/api/pos/display/", {"state": {"mode": "tip", "request_id": "x2", "base": "20.00"}}, format="json")
        self.assertEqual(reg.get("/api/pos/display/").json()["tip_answer"], {})
        self.assertEqual(screen.post("/api/pos/display/tip/", {"request_id": "x2", "choice": "custom", "amount": "3"}, format="json").json()["tip_answer"]["tip"], "3.00")

    def test_tip_settings_admin_only(self):
        self.assertEqual(self.c("sa1").put("/api/manage/tips/", {"percents": [10]}, format="json").status_code, 403)
        adm = self.c("adm1")
        self.assertEqual(adm.put("/api/manage/tips/", {"percents": []}, format="json").status_code, 400)
        r = adm.put("/api/manage/tips/", {"percents": [5, 2, 3], "allow_custom": False}, format="json").json()
        self.assertEqual((r["percents"], r["allow_custom"]), ([2, 3, 5], False))

    def test_customer_screen_header_allowed_by_cors(self):
        """The screen and register send X-Screen-Id from the website's origin — the browser must be allowed to."""
        from django.conf import settings
        from rest_framework.test import APIClient
        origin = (getattr(settings, "CORS_ALLOWED_ORIGINS", None) or ["http://localhost:3000"])[0]
        r = APIClient().options("/api/pos/display/", HTTP_ORIGIN=origin, HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
                                HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-screen-id")
        self.assertIn("x-screen-id", r.get("access-control-allow-headers", "").lower())
