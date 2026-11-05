import datetime
import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from menu.models import MenuItem
from orders.models import Order

from .auth import hash_key
from .models import Branch, DayOpen, Notification, Purchase, StaffProfile, Terminal, TimeEntry

PW = "pass12345"


def person(eid, role, branch=None, rate=15, **extra):
    u = get_user_model().objects.create_user(eid, password=PW, first_name=eid.title())
    return StaffProfile.objects.create(user=u, employee_id=eid.upper(), role=role, branch=branch,
                                       status="active", hourly_rate=rate, **extra)


@override_settings(TAX_RATE="0.08")
class BackOfficeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)
        Branch.objects.update(is_active=False)  # the default "Main" branch from the upgrade migration
        cls.a = Branch.objects.create(name="Downtown", code="downtown", min_wage=Decimal("15.00"))
        cls.b = Branch.objects.create(name="Uptown", code="uptown", min_wage=Decimal("15.00"))
        cls.emp = person("emp1", "employee", cls.a)
        cls.mgr = person("mgr1", "manager", cls.a)
        cls.mgr_b = person("mgr2", "manager", cls.b)
        cls.sup = person("sup1", "supervisor")
        cls.sup2 = person("sup2", "supervisor")
        cls.sa = person("sa1", "superadmin")
        cls.adm = person("adm1", "admin")
        cls.water = MenuItem.objects.get(name="Bottled Water")  # 1.49
        for b in (cls.a, cls.b):   # a registered register at each store, and the day started
            Terminal.objects.create(branch=b, name="Front", key_hash=hash_key(f"dev-{b.code}"))
            DayOpen.objects.create(branch=b, date=timezone.localdate(), opening_float=Decimal("200.00"))
        for p in (cls.sup, cls.sup2, cls.sa):
            p.assigned_branches.set([cls.a, cls.b])

    def client_for(self, eid, device=None):
        c = APIClient()
        prof = StaffProfile.objects.get(employee_id=eid.upper())
        key = device or (f"dev-{prof.branch.code}" if prof.branch else "dev-downtown")
        r = c.post("/api/pos/login/", {"employee_id": eid, "password": PW, "device_key": key}, format="json")
        assert r.status_code == 200, r.content
        c.credentials(HTTP_AUTHORIZATION=f"Token {r.json()['token']}", HTTP_X_DEVICE_KEY=key)
        c.user_info = r.json()["user"]
        return c

    def sale(self, c, pct=0, approval=None, branch=None, method="cash", qty=10):
        body = {"items": [{"item_id": self.water.id, "quantity": qty}], "fulfillment": "pickup",
                "payment_method": method, "discount_percent": pct, "discount_reason": "Regular customer" if pct else ""}
        if approval:
            body["approval"] = approval
        if branch:
            body["branch_id"] = branch
        return c.post("/api/pos/orders/", body, format="json")

    # ------------------------------------------------------------ sign in & branch
    def test_login_with_employee_id_returns_role_and_branch(self):
        c = self.client_for("emp1")
        self.assertEqual(c.user_info["role"], "employee")
        self.assertEqual(c.user_info["discount_limit"], 0)
        self.assertFalse(c.user_info["can_refund"])
        self.assertEqual(c.user_info["branch"]["name"], "Downtown")
        self.assertEqual(len(self.client_for("sup1").user_info["branches"]), 2)

    def test_employee_sale_goes_to_own_branch(self):
        r = self.sale(self.client_for("emp1"), branch=self.b.id)  # tries the other branch
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["branch_name"], "Downtown")

    def test_supervisor_must_pick_branch(self):
        c = self.client_for("sup1")
        self.assertEqual(self.sale(c).status_code, 400)
        self.assertEqual(self.sale(c, branch=self.b.id).json()["branch_name"], "Uptown")

    # ------------------------------------------------------------ discounts
    def test_discount_limits_per_role(self):
        self.assertEqual(self.sale(self.client_for("emp1"), pct=10).status_code, 403)
        self.assertEqual(self.sale(self.client_for("mgr1"), pct=25).status_code, 201)
        self.assertEqual(self.sale(self.client_for("mgr1"), pct=30).status_code, 403)
        self.assertEqual(self.sale(self.client_for("sup1"), pct=50, branch=self.a.id).status_code, 201)
        self.assertEqual(self.sale(self.client_for("sup1"), pct=51, branch=self.a.id).status_code, 403)
        self.assertEqual(self.sale(self.client_for("sa1"), pct=75, branch=self.a.id).status_code, 201)
        self.assertEqual(self.sale(self.client_for("sa1"), pct=80, branch=self.a.id).status_code, 403)
        self.assertEqual(self.sale(self.client_for("adm1"), pct=100, branch=self.a.id).status_code, 201)

    def test_discount_math(self):
        o = self.sale(self.client_for("mgr1"), pct=20).json()
        # 10 × 1.49 = 14.90; −20% = 2.98 → 11.92; tax 8% = 0.95; total 12.87
        self.assertEqual(Decimal(o["discount_amount"]), Decimal("2.98"))
        self.assertEqual(Decimal(o["tax"]), Decimal("0.95"))
        self.assertEqual(Decimal(o["total"]), Decimal("12.87"))

    def test_manager_override_for_employee_discount(self):
        emp = self.client_for("emp1")
        r = emp.post("/api/pos/authorize/", {"action": "discount", "percent": 20, "employee_id": "mgr1",
                                             "password": PW, "branch_id": self.a.id}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        o = self.sale(emp, pct=20, approval=r.json()["approval"])
        self.assertEqual(o.status_code, 201, o.content)
        self.assertEqual(o.json()["discount_approved_by_name"], "Mgr1")
        # approval for 20% can't be reused for 25%
        self.assertEqual(self.sale(emp, pct=25, approval=r.json()["approval"]).status_code, 403)
        # manager can't approve above 25%
        r = emp.post("/api/pos/authorize/", {"action": "discount", "percent": 40, "employee_id": "mgr1",
                                             "password": PW}, format="json")
        self.assertEqual(r.status_code, 403)
        # wrong password
        r = emp.post("/api/pos/authorize/", {"action": "discount", "percent": 10, "employee_id": "mgr1",
                                             "password": "nope"}, format="json")
        self.assertEqual(r.status_code, 400)
        # other branch's manager can't approve here
        r = emp.post("/api/pos/authorize/", {"action": "discount", "percent": 10, "employee_id": "mgr2",
                                             "password": PW, "branch_id": self.a.id}, format="json")
        self.assertEqual(r.status_code, 403)

    # ------------------------------------------------------------ refunds
    def test_refund_rules(self):
        emp = self.client_for("emp1")
        oid = self.sale(emp).json()["id"]
        r = emp.post(f"/api/pos/orders/{oid}/refund/", {}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["code"], "approval_required")
        tok = emp.post("/api/pos/authorize/", {"action": "refund", "employee_id": "mgr1", "password": PW},
                       format="json").json()["approval"]
        r = emp.post(f"/api/pos/orders/{oid}/refund/", {"approval": tok, "reason": "Cold food"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["order"]["refunded_by_name"], "Mgr1")

    def test_branch_isolation(self):
        oid = self.sale(self.client_for("mgr2")).json()["id"]   # Uptown
        mgr_a = self.client_for("mgr1")
        self.assertEqual(mgr_a.get(f"/api/pos/orders/{oid}/").status_code, 403)
        self.assertEqual(len(mgr_a.get("/api/pos/orders/").json()), 0)
        self.assertEqual(len(self.client_for("sup1").get("/api/pos/orders/").json()), 1)
        self.assertEqual(mgr_a.get(f"/api/manage/reports/summary/?branch={self.b.id}").status_code, 403)

    # ------------------------------------------------------------ staff & verification
    def new_staff(self, c, eid, role="employee", branch=None, rate="16.00", **extra):
        body = {"employee_id": eid, "first_name": "New", "last_name": "Person", "password": "start123",
                "role": role, "branch": branch, "pay_type": "hourly", "hourly_rate": rate,
                "pay_method": "direct_deposit", **extra}
        return c.post("/api/manage/staff/", body, format="json")

    def test_manager_adds_employee_supervisor_verifies(self):
        mgr = self.client_for("mgr1")
        r = self.new_staff(mgr, "e9", branch=self.a.id)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["status"], "pending")
        sid = r.json()["id"]
        # can't sign in yet
        r = APIClient().post("/api/pos/login/", {"employee_id": "E9", "password": "start123"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertIn("verified", r.json()["detail"])
        # supervisor was notified, and sees it in approvals
        self.assertTrue(Notification.objects.filter(recipient=self.sup.user, title__icontains="verify").exists())
        sup = self.client_for("sup1")
        self.assertEqual(sup.get("/api/manage/approvals/").json()["count"], 1)
        # manager can't verify
        self.assertEqual(mgr.post(f"/api/manage/staff/{sid}/approve/").status_code, 403)
        self.assertEqual(sup.post(f"/api/manage/staff/{sid}/approve/").status_code, 200)
        # by default (one private POS link) employees sign in on any device
        r = APIClient().post("/api/pos/login/", {"employee_id": "e9", "password": "start123"}, format="json")
        self.assertEqual(r.status_code, 200)
        # with REQUIRE_REGISTERED_DEVICE on: only a registered device of their own store
        from django.test import override_settings
        override = override_settings(REQUIRE_REGISTERED_DEVICE=True)
        override.enable()
        self.addCleanup(override.disable)
        r = APIClient().post("/api/pos/login/", {"employee_id": "e9", "password": "start123"}, format="json")
        self.assertEqual(r.json()["code"], "device_not_registered")
        r = APIClient().post("/api/pos/login/", {"employee_id": "e9", "password": "start123", "device_key": "dev-uptown"}, format="json")
        self.assertEqual(r.status_code, 403)
        r = APIClient().post("/api/pos/login/", {"employee_id": "e9", "password": "start123", "device_key": "dev-downtown"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Notification.objects.filter(recipient=self.mgr.user, title__icontains="verified").exists())

    def test_manager_only_adds_employees_to_own_store(self):
        mgr = self.client_for("mgr1")
        r = self.new_staff(mgr, "m9", role="manager", branch=self.b.id).json()
        self.assertEqual((r["role"], r["branch"]), ("employee", self.a.id))

    def test_min_wage_enforced(self):
        r = self.new_staff(self.client_for("mgr1"), "e7", branch=self.a.id, rate="12.00")
        self.assertEqual(r.status_code, 400)
        self.assertIn("minimum wage", str(r.json()))

    def test_new_manager_needs_superadmin(self):
        sup = self.client_for("sup1")
        r = self.new_staff(sup, "m5", role="manager", branch=self.a.id)
        self.assertEqual(r.json()["status"], "pending")
        sid = r.json()["id"]
        self.assertEqual(self.client_for("sup2").post(f"/api/manage/staff/{sid}/approve/").status_code, 403)
        self.assertEqual(self.client_for("sa1").post(f"/api/manage/staff/{sid}/approve/").status_code, 200)

    def test_superadmin_adds_supervisor_needs_admin(self):
        r = self.new_staff(self.client_for("sa1"), "s5", role="supervisor", assigned_branches=[self.a.id])
        self.assertEqual(r.json()["status"], "pending")
        self.assertIsNone(r.json()["branch"])
        self.assertEqual([x["name"] for x in r.json()["stores"]], ["Downtown"])
        sid = r.json()["id"]
        self.assertEqual(self.client_for("sa1").post(f"/api/manage/staff/{sid}/approve/").status_code, 403)
        self.assertEqual(self.client_for("adm1").post(f"/api/manage/staff/{sid}/approve/").status_code, 200)

    def test_manager_sees_only_branch_employees(self):
        ids = {s["employee_id"] for s in self.client_for("mgr1").get("/api/manage/staff/").json()}
        self.assertEqual(ids, {"EMP1", "MGR1"})

    # ------------------------------------------------------------ purchases
    def buy(self, c, branch=None, total="40.00", category="meat"):
        body = {"category": category, "vendor": "Sysco", "reason": "Weekend wings", "invoice_number": "INV-1",
                "lines": [{"name": "Chicken wings", "quantity": 2, "unit": "case", "unit_cost": total}],
                "tax": "0"}
        if branch:
            body["branch"] = branch
        return c.post("/api/manage/purchases/", body, format="json")

    def test_purchase_approval_chain(self):
        r = self.buy(self.client_for("mgr1"))
        self.assertEqual(r.status_code, 201, r.content)
        p = r.json()
        self.assertEqual((p["status"], p["total"], p["needs_role"]), ("pending", "80.00", "Supervisor"))
        self.assertTrue(Notification.objects.filter(recipient=self.sup.user).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.adm.user).exists())
        self.assertEqual(self.client_for("mgr1").post(f"/api/manage/purchases/{p['id']}/approve/").status_code, 403)
        self.assertEqual(self.client_for("sup1").post(f"/api/manage/purchases/{p['id']}/reject/").status_code, 400)
        self.assertEqual(self.client_for("sup1").post(f"/api/manage/purchases/{p['id']}/approve/").status_code, 200)

        # supervisor's purchase needs a super admin
        p2 = self.buy(self.client_for("sup1"), branch=self.b.id).json()
        self.assertEqual(p2["needs_role"], "Super admin")
        self.assertEqual(self.client_for("sup2").post(f"/api/manage/purchases/{p2['id']}/approve/").status_code, 403)
        self.assertEqual(self.client_for("sa1").post(f"/api/manage/purchases/{p2['id']}/approve/").status_code, 200)

        # super admin: auto-approved, admin notified
        Notification.objects.all().delete()
        p3 = self.buy(self.client_for("sa1"), branch=self.a.id).json()
        self.assertEqual(p3["status"], "approved")
        self.assertEqual(list(Notification.objects.values_list("recipient__username", flat=True)), ["adm1"])

    def test_employee_cannot_see_purchases(self):
        self.assertEqual(self.buy(self.client_for("emp1")).status_code, 403)

    # ------------------------------------------------------------ notifications
    def test_notifications_read_unread(self):
        self.buy(self.client_for("mgr1"))
        adm = self.client_for("adm1")
        n = adm.get("/api/manage/notifications/").json()
        self.assertEqual(n["unread"], 1)
        nid = n["items"][0]["id"]
        adm.post(f"/api/manage/notifications/{nid}/", {"read": True}, format="json")
        self.assertEqual(adm.get("/api/manage/notifications/").json()["unread"], 0)
        adm.post(f"/api/manage/notifications/{nid}/", {"read": False}, format="json")
        self.assertEqual(adm.get("/api/manage/notifications/").json()["unread"], 1)

    # ------------------------------------------------------------ time clock & payroll
    def test_clock_and_overtime(self):
        emp = self.client_for("emp1")
        self.assertTrue(emp.post("/api/pos/clock/").json()["clocked_in"])
        self.assertFalse(emp.post("/api/pos/clock/", {"tips": "12.50"}, format="json").json()["clocked_in"])
        TimeEntry.objects.all().delete()
        monday = timezone.localdate() - datetime.timedelta(days=timezone.localdate().weekday())
        tz = timezone.get_current_timezone()
        for d in range(5):  # 5 × 9 h = 45 h → 5 h overtime
            start = datetime.datetime.combine(monday + datetime.timedelta(days=d), datetime.time(9), tz)
            TimeEntry.objects.create(staff=self.emp, branch=self.a, clock_in=start,
                                     clock_out=start + datetime.timedelta(hours=9))
        r = self.client_for("mgr1").get("/api/manage/payroll/").json()
        row = next(x for x in r["rows"] if x["employee_id"] == "EMP1")
        self.assertEqual((row["hours"], row["overtime_hours"]), ("45.00", "5.00"))
        self.assertEqual(row["gross_pay"], "712.50")  # 40×15 + 5×22.50
        csv = self.client_for("mgr1").get("/api/manage/payroll/?export=csv")
        self.assertIn(b"EMP1", csv.content)

    # ------------------------------------------------------------ cash closing
    def test_daily_close_over_short(self):
        mgr = self.client_for("mgr1")
        self.sale(mgr)  # cash 14.90 + 1.19 tax = 16.09
        mgr.post("/api/manage/cash/drops/", {"branch": self.a.id, "kind": "safe_drop", "amount": "100"}, format="json")
        n = mgr.get(f"/api/manage/cash/close/?branch={self.a.id}").json()["numbers"]
        self.assertEqual(n["expected_cash"], "116.09")  # 200 float + 16.09 − 100 drop
        r = mgr.post("/api/manage/cash/close/", {"branch": self.a.id,
                                                 "denominations": {"100": 1, "10": 1, "5": 1, "1": 1}}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["over_short"], "-0.09")
        self.assertEqual(r.json()["cash_to_deposit"], "16.00")  # 116 counted + 100 dropped − 200 float
        # the day can't be closed twice
        self.assertEqual(mgr.post("/api/manage/cash/close/", {"branch": self.a.id, "denominations": {}},
                                  format="json").status_code, 400)

    # ------------------------------------------------------------ reports
    def test_reports_access_and_pnl(self):
        self.sale(self.client_for("mgr1"), qty=50)        # net 74.50
        self.buy(self.client_for("sa1"), branch=self.a.id, total="20.00")  # 40 approved COGS
        self.assertEqual(self.client_for("sup1").get("/api/manage/reports/pnl/").status_code, 403)
        self.assertEqual(self.client_for("emp1").get("/api/manage/reports/summary/").status_code, 403)
        r = self.client_for("sa1").get("/api/manage/reports/pnl/?period=month").json()
        dt = next(b for b in r["branches"] if b["name"] == "Downtown")
        self.assertEqual((dt["net_sales"], dt["cogs"], dt["gross_profit"]), ("74.50", "40.00", "34.50"))
        s = self.client_for("sup1").get("/api/manage/reports/summary/?period=month").json()
        self.assertEqual(len(s["branches"]), 2)
        self.assertEqual(s["sales"]["orders"], 1)

    def test_pnl_columns_add_up_with_head_office(self):
        self.sup.pay_type, self.sup.weekly_salary = "salary", Decimal("700")
        self.sup.hire_date = datetime.date(2026, 1, 1)
        self.sup.save()
        before = self.client_for("sa1").get("/api/manage/reports/pnl/?from=2025-12-01&to=2025-12-07").json()
        self.assertEqual(before["total"]["labor"], "0.00")   # no salary before the hire date
        r = self.client_for("sa1").get("/api/manage/reports/pnl/?from=2026-01-05&to=2026-01-11").json()
        names = [b["name"] for b in r["branches"]]
        self.assertIn("Head office", names)
        hq = next(b for b in r["branches"] if b["name"] == "Head office")
        self.assertEqual(hq["labor"], "700.00")   # one full week of salary
        self.assertEqual(sum(Decimal(b["labor"]) for b in r["branches"]), Decimal(r["total"]["labor"]))
