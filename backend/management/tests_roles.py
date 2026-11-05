"""Role-wise approvals, store access, devices, day start, offers, messages, profile & pay."""
import datetime
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from menu.models import Category, MenuItem, Promotion
from orders.models import Order

from .auth import hash_key
from .models import (AuditLog, BankDeposit, Branch, ChangeRequest, DailyClose, DayOpen, MessageRecipient,
                     PayStatement, Purchase, StaffProfile, Terminal, TimeEntry, Vendor)
from .tests import PW, person


@override_settings(TAX_RATE="0.08")
class RoleWiseTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)
        Branch.objects.update(is_active=False)
        cls.a = Branch.objects.create(name="Downtown", code="downtown", min_wage=Decimal("15"))
        cls.b = Branch.objects.create(name="Uptown", code="uptown", min_wage=Decimal("15"))
        cls.emp = person("emp1", "employee", cls.a)
        cls.emp_b = person("emp2", "employee", cls.b)
        cls.mgr = person("mgr1", "manager", cls.a)
        cls.mgr_b = person("mgr2", "manager", cls.b)
        cls.sup = person("sup1", "supervisor")
        cls.sup2 = person("sup2", "supervisor")
        cls.sup_a = person("supa", "supervisor")         # only Downtown
        cls.sa = person("sa1", "superadmin")
        cls.adm = person("adm1", "admin")
        for p in (cls.sup, cls.sup2, cls.sa):
            p.assigned_branches.set([cls.a, cls.b])
        cls.sup_a.assigned_branches.set([cls.a])
        for b in (cls.a, cls.b):
            Terminal.objects.create(branch=b, name="Front", key_hash=hash_key(f"dev-{b.code}"))
        cls.water = MenuItem.objects.get(name="Bottled Water")

    def setUp(self):
        for b in (self.a, self.b):
            DayOpen.objects.get_or_create(branch=b, date=timezone.localdate(), defaults={"opening_float": Decimal("200")})

    def c(self, eid, device=None):
        c = APIClient()
        prof = StaffProfile.objects.get(employee_id=eid.upper())
        key = device or f"dev-{(prof.branch or self.a).code}"
        r = c.post("/api/pos/login/", {"employee_id": eid, "password": PW, "device_key": key}, format="json")
        assert r.status_code == 200, r.content
        c.credentials(HTTP_AUTHORIZATION=f"Token {r.json()['token']}", HTTP_X_DEVICE_KEY=key)
        return c

    def approve(self, eid, cr_id, ok=True):
        return self.c(eid).post(f"/api/manage/changes/{cr_id}/{'approve' if ok else 'reject'}/", {"note": "no"}, format="json")

    def sale(self, c, branch=None, qty=2, **extra):
        body = {"items": [{"item_id": self.water.id, "quantity": qty}], "fulfillment": "pickup", "payment_method": "cash", **extra}
        if branch:
            body["branch_id"] = branch
        return c.post("/api/pos/orders/", body, format="json")

    def buy(self, c, branch=None):
        body = {"category": "meat", "vendor_ref": Vendor.objects.get(name="Sysco").id, "reason": "Stock",
                "lines": [{"name": "Wings", "quantity": 1, "unit": "case", "unit_cost": "100.00"}]}
        if branch:
            body["branch"] = branch
        return c.post("/api/manage/purchases/", body, format="json")

    # ------------------------------------------------------------ edits go up one role
    def test_purchase_edit_chain(self):
        pid = self.buy(self.c("mgr1")).json()["id"]
        edit = {"lines": [{"name": "Wings", "quantity": 2, "unit": "case", "unit_cost": "100.00"}], "change_reason": "Typo in qty"}
        self.assertEqual(self.c("mgr1").patch(f"/api/manage/purchases/{pid}/", edit, format="json").status_code, 403)
        cr = self.c("sup1").patch(f"/api/manage/purchases/{pid}/", edit, format="json").json()
        self.assertEqual((cr["status"], cr["need_role"]), ("pending", "Super admin"))
        self.assertEqual(Purchase.objects.get(pk=pid).total, Decimal("100.00"))     # unchanged until approved
        self.assertEqual(self.approve("sup2", cr["id"]).status_code, 403)          # same level can't approve
        self.assertEqual(self.approve("sa1", cr["id"]).status_code, 200)
        self.assertEqual(Purchase.objects.get(pk=pid).total, Decimal("200.00"))
        h = AuditLog.objects.filter(model="purchase", object_id=pid, action="updated").first()
        self.assertEqual(h.approved_by.username, "sa1")
        self.assertIn("lines", h.changes)

    def test_supervisor_entry_needs_superadmin_to_edit(self):
        pid = self.buy(self.c("sup1"), branch=self.a.id).json()["id"]
        edit = {"change_reason": "fix", "invoice_number": "X1"}
        self.assertEqual(self.c("sup1").patch(f"/api/manage/purchases/{pid}/", edit, format="json").status_code, 403)
        self.assertEqual(self.c("sup2").patch(f"/api/manage/purchases/{pid}/", edit, format="json").status_code, 403)
        cr = self.c("sa1").patch(f"/api/manage/purchases/{pid}/", edit, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")
        # admin's own edit applies right away
        cr = self.c("adm1").patch(f"/api/manage/purchases/{pid}/", {"change_reason": "fix", "invoice_number": "X2"}, format="json").json()
        self.assertEqual(cr["status"], "approved")
        self.assertEqual(Purchase.objects.get(pk=pid).invoice_number, "X2")

    def test_close_edit_chain(self):
        mgr = self.c("mgr1")
        cid = mgr.post("/api/manage/cash/close/", {"branch": self.a.id, "denominations": {"100": 2}}, format="json").json()["id"]
        fix = {"denominations": {"100": 2, "1": 5}, "reason": "Miscounted"}
        self.assertEqual(mgr.patch(f"/api/manage/cash/closes/{cid}/", fix, format="json").status_code, 403)
        cr = self.c("sup1").patch(f"/api/manage/cash/closes/{cid}/", fix, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.approve("sa1", cr["id"])
        self.assertEqual(DailyClose.objects.get(pk=cid).counted_cash, Decimal("205.00"))

    def test_clock_edit_chain_and_no_self_edit(self):
        e = TimeEntry.objects.create(staff=self.emp, branch=self.a, clock_in=timezone.now() - datetime.timedelta(hours=5),
                                     clock_out=timezone.now())
        m = TimeEntry.objects.create(staff=self.mgr, branch=self.a, clock_in=timezone.now() - datetime.timedelta(hours=5))
        mgr = self.c("mgr1")
        self.assertIn(mgr.patch(f"/api/manage/time/{m.id}/", {"tips": "5", "reason": "x"}, format="json").status_code, (403, 404))
        self.assertEqual(mgr.patch(f"/api/manage/time/{e.id}/", {"tips": "5"}, format="json").status_code, 400)  # reason needed
        cr = mgr.patch(f"/api/manage/time/{e.id}/", {"tips": "5.00", "reason": "Forgot tips"}, format="json").json()
        self.assertEqual(cr["need_role"], "Supervisor")
        self.approve("sup1", cr["id"])
        self.assertEqual(TimeEntry.objects.get(pk=e.id).tips, Decimal("5.00"))
        # supervisor can't change their own shifts either
        s = TimeEntry.objects.create(staff=self.sup, branch=self.a, clock_in=timezone.now())
        self.assertIn(self.c("sup1").patch(f"/api/manage/time/{s.id}/", {"tips": "1", "reason": "x"}, format="json").status_code, (403, 404))

    def test_deposit_edit_only_superadmin_up(self):
        from .models import CashDrop
        CashDrop.objects.create(branch=self.a, kind="safe_drop", amount=Decimal("1000"), made_by=self.mgr.user)  # cash in the safe
        d = BankDeposit.objects.create(branch=self.a, amount=Decimal("500"), deposited_by=self.mgr.user)
        body = {"amount": "550.00", "reason": "Slip said 550"}
        self.assertEqual(self.c("mgr1").patch(f"/api/manage/cash/deposits/{d.id}/", body, format="json").status_code, 403)
        self.assertEqual(self.c("sup1").patch(f"/api/manage/cash/deposits/{d.id}/", body, format="json").status_code, 403)
        cr = self.c("sa1").patch(f"/api/manage/cash/deposits/{d.id}/", body, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")
        self.approve("adm1", cr["id"])
        self.assertEqual(BankDeposit.objects.get(pk=d.id).amount, Decimal("550.00"))

    def test_vendor_role_wise(self):
        cr = self.c("mgr1").post("/api/manage/vendors/", {"name": "US Foods", "payment_terms": "net30", "state": "ny"}, format="json").json()
        self.assertEqual(cr["need_role"], "Supervisor")
        self.assertFalse(Vendor.objects.filter(name="US Foods").exists())
        self.approve("sup1", cr["id"])
        self.assertEqual(Vendor.objects.get(name="US Foods").state, "NY")
        cr = self.c("sa1").post("/api/manage/vendors/", {"name": "Chef Store"}, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")

    def test_menu_changes_supervisor_and_up(self):
        cat = Category.objects.get(name="Wings").id
        self.assertEqual(self.c("mgr1").post("/api/manage/menu/items/", {"name": "X", "category": cat, "price": "5"}, format="json").status_code, 403)
        cr = self.c("sup1").post("/api/manage/menu/items/", {"name": "Lemon Wings", "category": cat, "price": "9.49"}, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.approve("sa1", cr["id"])
        item = MenuItem.objects.get(name="Lemon Wings")
        cr = self.c("sa1").patch(f"/api/manage/menu/items/{item.id}/", {"price": "9.99"}, format="json").json()
        self.assertIn("price $9.49 → $9.99", cr["summary"])
        self.approve("adm1", cr["id"])
        self.assertEqual(MenuItem.objects.get(pk=item.id).price, Decimal("9.99"))

    def test_staff_pay_change_needs_approval(self):
        r = self.c("mgr1").patch(f"/api/manage/staff/{self.emp.id}/", {"hourly_rate": "18.00", "phone": "555"}, format="json").json()
        self.assertIn("approval", r["message"])
        p = StaffProfile.objects.get(pk=self.emp.id)
        self.assertEqual((p.hourly_rate, p.phone), (Decimal("15"), "555"))
        cr = ChangeRequest.objects.get(kind="staff.pay")
        self.approve("sup1", cr.id)
        self.assertEqual(StaffProfile.objects.get(pk=self.emp.id).hourly_rate, Decimal("18.00"))

    # ------------------------------------------------------------ stores
    def test_supervisor_sees_only_assigned_stores(self):
        c = self.c("supa")
        self.assertEqual([b["name"] for b in c.get("/api/manage/branches/").json()], ["Downtown"])
        self.assertEqual(c.get(f"/api/manage/reports/summary/?branch={self.b.id}").status_code, 403)
        ids = {s["employee_id"] for s in c.get("/api/manage/staff/").json()}
        self.assertIn("EMP1", ids)
        self.assertNotIn("EMP2", ids)
        # store assignment by a super admin needs the admin
        r = self.c("sa1").patch(f"/api/manage/staff/{self.sup_a.id}/", {"assigned_branches": [self.a.id, self.b.id]}, format="json").json()
        self.assertIn("approval", r["message"])
        cr = ChangeRequest.objects.get(kind="staff.stores")
        self.approve("adm1", cr.id)
        self.assertEqual(self.sup_a.assigned_branches.count(), 2)
        self.assertIn(self.c("sup1").patch(f"/api/manage/staff/{self.sup_a.id}/", {"assigned_branches": [self.a.id]},
                                           format="json").status_code, (403, 404))

    # ------------------------------------------------------------ day start, sold out, devices
    def test_day_must_be_started(self):
        DayOpen.objects.all().delete()
        r = self.sale(self.c("emp1"))
        self.assertEqual(r.json()["code"], "day_not_started")
        self.assertEqual(self.c("emp1").post("/api/pos/day/", {"denominations": {"20": 10}}, format="json").status_code, 403)
        r = self.c("mgr1").post("/api/pos/day/", {"denominations": {"20": 10, "1": 30}}, format="json").json()
        self.assertEqual(r["opening_float"], "230.00")
        self.assertEqual(self.sale(self.c("emp1")).status_code, 201)
        n = self.c("mgr1").get(f"/api/manage/cash/close/?branch={self.a.id}").json()["numbers"]
        self.assertEqual(n["opening_float"], "230.00")

    def test_sold_out_managers_only(self):
        self.assertEqual(self.c("emp1").post(f"/api/pos/items/{self.water.id}/availability/", {"is_available": False}, format="json").status_code, 403)
        self.assertEqual(self.c("mgr1").post(f"/api/pos/items/{self.water.id}/availability/", {"is_available": False}, format="json").status_code, 200)

    @override_settings(REQUIRE_REGISTERED_DEVICE=True)
    def test_devices_and_expiry(self):
        r = APIClient().post("/api/pos/login/", {"employee_id": "emp1", "password": PW, "device_key": "random"}, format="json")
        self.assertEqual(r.status_code, 403)
        # manager registers a new device; employee can then use it
        mgr = self.c("mgr1", device="anything")   # managers may sign in anywhere
        key = mgr.post("/api/pos/device/", {"name": "Back tablet"}, format="json").json()["key"]
        emp = self.c("emp1", device=key)
        self.assertEqual(emp.get("/api/pos/clock/").status_code, 200)
        # the token alone (without the device) doesn't work for an employee
        bare = APIClient()
        bare.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.get(user=self.emp.user).key}")
        self.assertEqual(bare.get("/api/pos/clock/").status_code, 401)
        # blocking the device stops it
        t = Terminal.objects.get(name="Back tablet")
        mgr.patch(f"/api/manage/devices/{t.id}/", {"is_active": False}, format="json")
        self.assertEqual(emp.get("/api/pos/clock/").status_code, 401)
        # employee sign-ins expire after a shift
        tok = Token.objects.get(user=self.emp_b.user) if Token.objects.filter(user=self.emp_b.user).exists() else None
        c2 = self.c("emp2")
        Token.objects.filter(user=self.emp_b.user).update(created=timezone.now() - datetime.timedelta(hours=15))
        self.assertEqual(c2.get("/api/pos/clock/").status_code, 401)
        # sign out everywhere
        c3 = self.c("emp1")
        self.c("mgr1").post(f"/api/manage/staff/{self.emp.id}/signout/")
        self.assertEqual(c3.get("/api/pos/clock/").status_code, 401)

    # ------------------------------------------------------------ offers
    def test_offers_applied_by_rules(self):
        now = timezone.localtime()
        drinks = Category.objects.get(name="Drinks")
        p = Promotion.objects.create(name="Drink Deal", kind="percent", value=Decimal("50"), applies_to="category",
                                     category=drinks, days=[now.weekday()])
        o = self.sale(self.c("emp1"), qty=2).json()
        self.assertEqual(o["items"][0]["unit_price"], "0.75")      # 1.49 → 50% off
        self.assertEqual(o["items"][0]["promotion"], "Drink Deal")
        self.assertEqual(o["promo_discount"], "1.48")
        p.days = [(now.weekday() + 1) % 7]
        p.save()
        self.assertEqual(self.sale(self.c("emp1")).json()["items"][0]["unit_price"], "1.49")
        # store-only offer
        p.days = []
        p.save()
        p.branches.set([self.b])
        self.assertEqual(self.sale(self.c("emp1")).json()["items"][0]["unit_price"], "1.49")
        self.assertEqual(self.sale(self.c("emp2")).json()["items"][0]["unit_price"], "0.75")
        # code-only offers apply online with the code
        p.branches.clear()
        p.code = "SAVE50"
        p.save()
        q = APIClient().post("/api/cart/quote/", {"items": [{"item_id": self.water.id, "quantity": 1}]}, format="json").json()
        self.assertEqual(q["total"], "1.61")
        q = APIClient().post("/api/cart/quote/", {"items": [{"item_id": self.water.id, "quantity": 1}], "code": "save50"}, format="json").json()
        self.assertEqual(q["lines"][0]["promotion"], "Drink Deal")

    def test_offer_created_role_wise(self):
        body = {"name": "Wing Wednesday", "kind": "percent", "value": "20", "applies_to": "category",
                "category": Category.objects.get(name="Wings").id, "days": [2], "channels": ["online", "pos"]}
        self.assertEqual(self.c("mgr1").post("/api/manage/offers/", body, format="json").status_code, 403)
        cr = self.c("sup1").post("/api/manage/offers/", body, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.approve("sa1", cr["id"])
        self.assertEqual(Promotion.objects.get(name="Wing Wednesday").days, [2])

    # ------------------------------------------------------------ TV screens
    def test_screen_manager_then_supervisor(self):
        cr = self.c("mgr1").post("/api/manage/screens/", {"name": "Counter TV", "columns": 2, "categories": ["wings"],
                                                          "branch": self.b.id}, format="json").json()
        self.assertEqual(cr["need_role"], "Supervisor")
        self.assertEqual(cr["branch"], self.a.id)       # managers only for their own store
        self.approve("sup1", cr["id"])
        sid = cr["result_id"] or self.approve("sup1", cr["id"]).json().get("result_id")
        board = self.client.get(f"/api/screens/{ChangeRequest.objects.get(pk=cr['id']).result_id}/").json()
        self.assertEqual(board["categories"], ["wings"])

    # ------------------------------------------------------------ messages
    def test_messages(self):
        emp = self.c("emp1")
        contacts = emp.get("/api/manage/messages/contacts/").json()
        names = {p["name"] for p in contacts["people"]}
        self.assertIn("Mgr1", names)
        self.assertNotIn("Emp2", names)            # other store
        self.assertEqual(contacts["groups"], [])   # employees can't mass-message
        r = emp.post("/api/manage/messages/", {"subject": "Shift swap", "body": "Can I swap Friday?", "to": [self.mgr.user_id]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(emp.post("/api/manage/messages/", {"subject": "x", "body": "y", "to": [self.emp_b.user_id]}, format="json").status_code, 403)
        mgr = self.c("mgr1")
        box = mgr.get("/api/manage/messages/").json()
        self.assertEqual(box["unread"], 1)
        mgr.get(f"/api/manage/messages/{box['items'][0]['id']}/")
        self.assertEqual(mgr.get("/api/manage/messages/").json()["unread"], 0)
        r = mgr.post("/api/manage/messages/", {"subject": "Team", "body": "Meeting at 3", "to": [f"branch:{self.a.id}"]}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(MessageRecipient.objects.filter(user=self.emp.user, message__subject="Team").exists())

    # ------------------------------------------------------------ profile & earnings
    def test_profile_and_earnings(self):
        emp = self.c("emp1")
        r = emp.patch("/api/manage/me/", {"phone": "555-1234", "city": "Springfield", "state": "ny", "zip_code": "123",
                                          "hourly_rate": "99"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = emp.patch("/api/manage/me/", {"phone": "555-1234", "state": "ny", "zip_code": "12345", "hourly_rate": "99"}, format="json").json()
        self.assertEqual((r["state"], r["hourly_rate"]), ("NY", "15.00"))   # can't change own pay
        monday = timezone.localdate() - datetime.timedelta(days=timezone.localdate().weekday() + 7)
        tz = timezone.get_current_timezone()
        TimeEntry.objects.create(staff=self.emp, branch=self.a, clock_in=datetime.datetime.combine(monday, datetime.time(9), tz),
                                 clock_out=datetime.datetime.combine(monday, datetime.time(17), tz))
        period = {"from": monday.isoformat(), "to": (monday + datetime.timedelta(days=6)).isoformat()}
        self.assertEqual(self.c("sup1").post("/api/manage/pay/", period, format="json").status_code, 403)
        made = self.c("sa1").post("/api/manage/pay/", period, format="json").json()
        st = next(x for x in made if x["employee_id"] == "EMP1")
        self.assertEqual((st["status"], st["gross_pay"]), ("pending", "120.00"))
        self.assertEqual(emp.get("/api/manage/me/earnings/").json()["statements"], [])
        self.c("adm1").post(f"/api/manage/pay/{st['id']}/approve/")
        self.assertEqual(emp.get("/api/manage/me/earnings/").json()["statements"][0]["gross_pay"], "120.00")
        # super admin's change to a pay statement needs the admin
        cr = self.c("sa1").patch(f"/api/manage/pay/{st['id']}/", {"reference": "Check 1001", "reason": "add check #"}, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")

    def test_job_titles(self):
        self.assertEqual(self.c("mgr1").post("/api/manage/job-titles/", {"name": "Expo"}, format="json").status_code, 403)
        self.assertEqual(self.c("sa1").post("/api/manage/job-titles/", {"name": "Expo"}, format="json").status_code, 201)
        self.assertIn("Expo", [t["name"] for t in self.c("mgr1").get("/api/manage/job-titles/").json()])

    def test_history_is_recorded(self):
        self.buy(self.c("mgr1"))
        h = self.c("sup1").get("/api/manage/history/?model=purchase").json()
        self.assertTrue(any("Sysco" in x["summary"] and x["actor_name"] == "Mgr1" for x in h))
