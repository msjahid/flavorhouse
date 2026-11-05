"""Customers, menu options, salary paid/unpaid, role-wise messages, owners, POS order day range."""
import datetime
from decimal import Decimal

from django.utils import timezone

from menu.models import MenuItem, OptionGroup
from orders.models import Customer, Order

from .models import ChangeRequest, Message, MessageRecipient, Owner, OwnerDraw, PayStatement, TimeEntry
from . import tests_roles

Base = tests_roles.RoleWiseTests
del tests_roles


class ExtraTests(Base):  # noqa: F821
    # ------------------------------------------------------------ POS orders list uses the register's day
    def test_orders_local_day_range(self):
        mgr = self.c("mgr1")
        self.assertEqual(self.sale(mgr).status_code, 201)
        now = timezone.now()
        start, end = (now - datetime.timedelta(hours=1)).isoformat(), (now + datetime.timedelta(hours=1)).isoformat()
        r = mgr.get("/api/pos/orders/", {"start": start, "end": end}).json()
        self.assertEqual(len(r), 1)
        r = mgr.get("/api/pos/orders/", {"start": (now + datetime.timedelta(hours=2)).isoformat(),
                                         "end": (now + datetime.timedelta(hours=3)).isoformat()}).json()
        self.assertEqual(len(r), 0)

    # ------------------------------------------------------------ customers
    def test_customers(self):
        mgr = self.c("mgr1")
        self.sale(mgr, customer_name="Zoe Park", customer_phone="(512) 555-0100")
        self.sale(mgr, customer_name="zoe", customer_phone="+1 512-555-0100")
        self.sale(mgr, customer_name="Adam Lee", customer_email="ADAM@x.com")
        self.sale(self.c("mgr2"), customer_name="Bea Uptown", customer_email="bea@x.com")
        self.assertEqual(Customer.objects.count(), 3)
        r = mgr.get("/api/manage/customers/").json()
        self.assertEqual([x["name"] for x in r["items"]], ["Adam Lee", "Zoe Park"])   # A–Z, own store only
        zoe = next(x for x in r["items"] if x["name"] == "Zoe Park")
        self.assertEqual(zoe["orders"], 2)
        self.assertFalse(r["can_edit"])
        d = mgr.get(f"/api/manage/customers/{zoe['id']}/").json()
        self.assertEqual(d["items"][0]["name"], "Bottled Water")
        self.assertEqual(d["items"][0]["quantity"], 4)
        self.assertEqual(mgr.patch(f"/api/manage/customers/{zoe['id']}/", {"name": "Z"}, format="json").status_code, 403)
        self.assertEqual(self.c("sa1").patch(f"/api/manage/customers/{zoe['id']}/", {"name": "Z"}, format="json").status_code, 403)
        r = self.c("adm1").patch(f"/api/manage/customers/{zoe['id']}/", {"name": "Zoe P.", "notes": "VIP"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Customer.objects.get(pk=zoe["id"]).notes, "VIP")
        self.assertEqual(mgr.get("/api/manage/customers/", {"letter": "z"}).json()["count"], 1)

    # ------------------------------------------------------------ menu item options
    def test_menu_options_role_wise(self):
        item = MenuItem.objects.get(name="Bone-In Wings")
        groups = [{"name": "Size", "required": True, "max_select": 1,
                   "options": [{"name": "6 pc", "price_delta": "0"}, {"name": "10 pc", "price_delta": "5.50"}]},
                  {"name": "Dip", "max_select": 2, "options": [{"name": "Ranch", "price_delta": "0.75"}]}]
        sup = self.c("sup1")
        self.assertEqual(self.c("mgr1").patch(f"/api/manage/menu/items/{item.id}/", {"option_groups": groups}, format="json").status_code, 403)
        cr = sup.patch(f"/api/manage/menu/items/{item.id}/", {"option_groups": groups}, format="json").json()
        self.assertEqual(cr["status"], "pending")
        self.assertEqual(self.approve("sa1", cr["id"]).status_code, 200)
        self.assertEqual([g.name for g in item.option_groups.all()], ["Size", "Dip"])
        self.assertEqual(OptionGroup.objects.get(item=item, name="Size").options.get(name="10 pc").price_delta, Decimal("5.50"))
        bad = self.c("adm1").patch(f"/api/manage/menu/items/{item.id}/", {"option_groups": [{"name": "X", "options": []}]}, format="json")
        self.assertEqual(bad.status_code, 400)

    # ------------------------------------------------------------ salary paid / unpaid
    def test_salary_paid_unpaid_chain(self):
        last_mon = timezone.localdate() - datetime.timedelta(days=timezone.localdate().weekday() + 7)
        t = timezone.make_aware(datetime.datetime.combine(last_mon, datetime.time(9)))
        TimeEntry.objects.create(staff=self.emp, branch=self.a, clock_in=t, clock_out=t + datetime.timedelta(hours=8))
        mgr = self.c("mgr1")
        rows = mgr.get("/api/manage/salary/").json()["rows"]
        me = next(r for r in rows if r["employee_id"] == "EMP1")
        self.assertEqual(me["weeks"][0]["status"], "running")
        past = next(w for w in me["weeks"] if w["from"] == last_mon.isoformat())
        self.assertEqual(past["status"], "unpaid")
        self.assertEqual(past["hours"], "8.00")
        # can't mark the running week, or your own pay
        self.assertEqual(mgr.post("/api/manage/salary/mark/", {"staff": self.emp.id, "from": timezone.localdate().isoformat(), "paid": True}, format="json").status_code, 400)
        self.assertEqual(mgr.post("/api/manage/salary/mark/", {"staff": self.mgr.id, "from": last_mon.isoformat(), "paid": True}, format="json").status_code, 403)
        cr = mgr.post("/api/manage/salary/mark/", {"staff": self.emp.id, "from": last_mon.isoformat(), "paid": True,
                                                    "pay_method": "check", "reference": "1042"}, format="json").json()
        self.assertEqual(cr["need_role"], "Supervisor")
        rows = mgr.get("/api/manage/salary/").json()["rows"]
        past = next(w for w in next(r for r in rows if r["employee_id"] == "EMP1")["weeks"] if w["from"] == last_mon.isoformat())
        self.assertIsNotNone(past["pending"])
        self.assertEqual(self.approve("sup1", cr["id"]).status_code, 200)
        st = PayStatement.objects.get(staff=self.emp, period_start=last_mon)
        self.assertTrue(st.is_paid)
        self.assertEqual(st.reference, "1042")
        # employee sees it on their profile
        weeks = self.c("emp1").get("/api/manage/me/earnings/").json()["weeks"]
        self.assertEqual(next(w for w in weeks if w["from"] == last_mon.isoformat())["status"], "paid")
        # admin marks unpaid directly
        cr = self.c("adm1").post("/api/manage/salary/mark/", {"staff": self.emp.id, "from": last_mon.isoformat(), "paid": False}, format="json").json()
        self.assertEqual(cr["status"], "approved")
        st.refresh_from_db()
        self.assertFalse(st.is_paid)

    # ------------------------------------------------------------ role-wise messages
    def test_message_roles(self):
        def ids(eid):
            return {p["id"] for p in self.c(eid).get("/api/manage/messages/contacts/").json()["people"]}
        emp = ids("emp1")
        self.assertIn(self.mgr.user_id, emp)
        self.assertIn(self.sup.user_id, emp)
        self.assertNotIn(self.sa.user_id, emp)
        self.assertNotIn(self.adm.user_id, emp)
        mgr = ids("mgr1")
        self.assertTrue({self.sup.user_id, self.sa.user_id, self.emp.user_id} <= mgr)
        self.assertNotIn(self.adm.user_id, mgr)
        self.assertNotIn(self.mgr_b.user_id, mgr)
        sup = ids("sup1")
        self.assertTrue({self.sa.user_id, self.adm.user_id} <= sup)
        # employee → super admin is blocked
        r = self.c("emp1").post("/api/manage/messages/", {"subject": "Hi", "body": "x", "to": [self.sa.user_id]}, format="json")
        self.assertEqual(r.status_code, 403)
        # admin writes to the employee; the employee may reply
        m = self.c("adm1").post("/api/manage/messages/", {"subject": "Welcome", "body": "Hi!", "to": [self.emp.user_id]}, format="json").json()
        r = self.c("emp1").post("/api/manage/messages/", {"subject": "Re: Welcome", "body": "Thanks", "to": [self.adm.user_id], "reply_to": m["id"]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        # team view: supervisors see employee/manager messages in their stores, managers can't
        self.c("emp1").post("/api/manage/messages/", {"subject": "Late", "body": "10 min late", "to": [self.mgr.user_id]}, format="json")
        team = self.c("sup1").get("/api/manage/messages/", {"box": "team"}).json()["items"]
        self.assertIn("Late", [x["subject"] for x in team])
        self.assertEqual(self.c("mgr1").get("/api/manage/messages/", {"box": "team"}).status_code, 403)
        late = Message.objects.get(subject="Late")
        self.assertEqual(self.c("sa1").get(f"/api/manage/messages/{late.id}/").status_code, 200)
        self.assertFalse(MessageRecipient.objects.filter(message=late, user=self.sa.user).exists())

    # ------------------------------------------------------------ vendor purchase history
    def test_vendor_history(self):
        sa = self.c("sa1")
        self.assertEqual(self.buy(sa, branch=self.a.id).status_code, 201)
        sysco = next(v for v in sa.get("/api/manage/vendors/").json() if v["name"] == "Sysco")
        self.assertEqual(sysco["purchases"], 1)
        self.assertEqual(sysco["spent_total"], "100.00")
        self.assertEqual(len(sa.get("/api/manage/purchases/", {"vendor": sysco["id"]}).json()), 1)
        self.assertEqual(len(sa.get("/api/manage/purchases/", {"vendor": 99999}).json()), 0)

    # ------------------------------------------------------------ split payments at the register
    def test_split_payment_cash_and_two_cards(self):
        mgr = self.c("mgr1")
        quote = self.sale(mgr, qty=10).json()        # find the total for 10 waters first
        total = Decimal(quote["total"])
        cash, card1 = Decimal("5.00"), Decimal("4.00")
        card2 = total - cash - card1
        body = {"items": [{"item_id": self.water.id, "quantity": 10}], "fulfillment": "pickup",
                "payments": [{"method": "cash", "amount": str(cash), "tendered": "20.00"},
                             {"method": "card", "amount": str(card1), "card_last4": "4242"},
                             {"method": "card", "amount": str(card2), "card_last4": "1111"}]}
        r = mgr.post("/api/pos/orders/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        o = r.json()
        self.assertEqual(o["payment_method"], "split")
        self.assertEqual(len(o["payments"]), 3)
        self.assertEqual(Decimal(o["change_given"]), Decimal("15.00"))
        bad = {**body, "payments": body["payments"][:2]}
        self.assertEqual(mgr.post("/api/pos/orders/", bad, format="json").status_code, 400)   # doesn't add up
        # the drawer only expects the cash part; card shows the card parts
        n = self.c("sup1").get("/api/manage/cash/close/", {"branch": self.a.id, "date": timezone.localdate().isoformat()}).json()["numbers"]
        self.assertEqual(Decimal(n["cash_sales"]), total + cash)       # first sale was all cash
        self.assertEqual(Decimal(n["card_sales"]), card1 + card2)
        # day totals for the Orders tab
        s = mgr.get("/api/pos/orders/summary/").json()
        self.assertEqual(s["orders"], 2)
        self.assertEqual(Decimal(s["sales"]), total * 2)
        self.assertEqual(s["split_orders"], 1)
        r = mgr.post(f"/api/pos/orders/{o['id']}/refund/", {"reason": "Wrong order"}, format="json")
        self.assertIn("4242", r.json()["message"])
        s = mgr.get("/api/pos/orders/summary/").json()
        self.assertEqual(Decimal(s["refunds"]["total"]), total)
        self.assertEqual(Decimal(s["net"]), total)

    # ------------------------------------------------------------ pay every 2 weeks, paid in parts
    def test_biweekly_and_split_salary(self):
        from .models import PaySettings
        adm = self.c("adm1")
        today = timezone.localdate()
        monday = today - datetime.timedelta(days=today.weekday())
        r = adm.post("/api/manage/salary/settings/", {"frequency": "biweekly", "anchor": (monday - datetime.timedelta(days=28)).isoformat()}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.c("sup1").post("/api/manage/salary/settings/", {"frequency": "weekly"}, format="json").status_code, 403)
        cfg = PaySettings.get()
        cur, _ = cfg.period_of(today)
        prev = cur - datetime.timedelta(days=14)
        for k in (0, 7):   # one 10 h shift in each week of the previous period
            t = timezone.make_aware(datetime.datetime.combine(prev + datetime.timedelta(days=k), datetime.time(9)))
            TimeEntry.objects.create(staff=self.emp, branch=self.a, clock_in=t, clock_out=t + datetime.timedelta(hours=10))
        # an older weekly record inside that period (made before switching) is folded in
        PayStatement.objects.create(staff=self.emp, period_start=prev, period_end=prev + datetime.timedelta(days=6),
                                    gross_pay=Decimal("150"), paid_amount=Decimal("150"), is_paid=True, status="approved",
                                    payments=[{"method": "cash", "amount": "150.00", "reference": ""}])
        rows = self.c("sup1").get("/api/manage/salary/").json()["rows"]
        w = next(x for x in next(r for r in rows if r["employee_id"] == "EMP1")["weeks"] if x["from"] == prev.isoformat())
        self.assertEqual(w["to"], (prev + datetime.timedelta(days=13)).isoformat())
        self.assertEqual(w["hours"], "20.00")
        self.assertEqual(w["status"], "partial")
        self.assertEqual(w["paid_amount"], "150.00")
        gross = Decimal(w["gross_pay"])
        # supervisor pays the rest in two parts → super admin approves
        parts = [{"method": "check", "amount": "50.00", "reference": "1201"},
                 {"method": "direct_deposit", "amount": str(gross - Decimal("50.00"))}]
        too_much = [{"method": "cash", "amount": str(gross + 1)}]
        sup = self.c("sup1")
        self.assertEqual(sup.post("/api/manage/salary/mark/", {"staff": self.emp.id, "from": prev.isoformat(), "paid": True, "payments": too_much}, format="json").status_code, 400)
        cr = sup.post("/api/manage/salary/mark/", {"staff": self.emp.id, "from": prev.isoformat(), "paid": True, "payments": parts}, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.assertEqual(self.approve("sa1", cr["id"]).status_code, 200)
        sts = PayStatement.objects.filter(staff=self.emp, period_start__gte=prev, period_end__lte=prev + datetime.timedelta(days=13))
        self.assertEqual(sts.count(), 1)             # the weekly record was merged
        st = sts.get()
        self.assertTrue(st.is_paid)
        self.assertEqual(len(st.payments), 2)
        w = next(x for x in self.c("emp1").get("/api/manage/me/earnings/").json()["weeks"] if x["from"] == prev.isoformat())
        self.assertEqual(w["status"], "paid")
        self.assertEqual(w["pay_method"], "Check + Direct deposit")

    # ------------------------------------------------------------ cash left to deposit / take out
    def test_cash_position_and_takeouts(self):
        from .models import DailyClose
        mgr = self.c("mgr1")
        yesterday = timezone.localdate() - datetime.timedelta(days=1)
        z = Decimal("0")
        DailyClose.objects.create(branch=self.a, date=yesterday, cash_to_deposit=Decimal("500"), counted_cash=Decimal("700"),
                                  opening_float=Decimal("200"), expected_cash=Decimal("700"), closed_by=self.mgr.user,
                                  cash_sales=Decimal("500"), cash_refunds=z, paid_outs=z, paid_ins=z, safe_drops=z,
                                  card_sales=z, online_sales=z, total_sales=Decimal("500"), over_short=z)
        pos = mgr.get("/api/manage/cash/position/", {"branch": self.a.id}).json()[0]
        self.assertEqual(pos["held"], "500.00")
        # deposit: cash + checks must add up, and checks need a count
        bad = {"branch": self.a.id, "amount": "300", "cash_amount": "250", "check_amount": "40"}
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", bad, format="json").status_code, 400)
        ok = {"branch": self.a.id, "amount": "300", "cash_amount": "250", "check_amount": "50", "check_count": 2,
              "method": "night_drop", "bag_number": "B-1001", "counted_by": "Jamie"}
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", ok, format="json").status_code, 201)
        # take-out needs who and why
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", {"branch": self.a.id, "kind": "takeout", "amount": "100"}, format="json").status_code, 400)
        r = mgr.post("/api/manage/cash/deposits/", {"branch": self.a.id, "kind": "takeout", "amount": "100", "method": "hand",
                                                     "taken_by": "Owner", "purpose": "owner"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        pos = mgr.get("/api/manage/cash/position/", {"branch": self.a.id}).json()[0]
        self.assertEqual(pos["held"], "150.00")        # 500 − 250 cash deposited − 100 taken out
        self.assertEqual(pos["deposited"], "250.00")
        self.assertEqual(pos["taken_out"], "100.00")
        self.assertEqual(pos["months"][0]["to_deposit"], "500.00" if yesterday.month == timezone.localdate().month else "0.00")

    # ------------------------------------------------------------ sales tax
    def test_tax_report_and_filing(self):
        mgr = self.c("mgr1")
        o1 = self.sale(mgr, qty=10).json()
        o2 = self.sale(mgr, qty=5).json()
        self.c("mgr1").post(f"/api/pos/orders/{o2['id']}/refund/", {"reason": "wrong order"}, format="json")
        self.assertEqual(mgr.get("/api/manage/reports/tax/").status_code, 403)
        sa = self.c("sa1")
        today = timezone.localdate()
        r = sa.get("/api/manage/reports/tax/", {"group": "day", "from": today.isoformat(), "to": today.isoformat()}).json()
        t = r["total"]
        self.assertEqual(t["orders"], 2)
        self.assertEqual(Decimal(t["with_tax"]), Decimal(o1["total"]) + Decimal(o2["total"]))
        self.assertEqual(Decimal(t["tax"]), Decimal(o1["tax"]) + Decimal(o2["tax"]))
        self.assertEqual(Decimal(t["without_tax"]), Decimal(t["with_tax"]) - Decimal(t["tax"]))
        self.assertEqual(Decimal(t["net_tax"]), Decimal(o1["tax"]))           # the refund gives its tax back
        self.assertFalse(r["can_edit_status"])
        body = {"period_start": today.replace(day=1).isoformat(), "period_end": today.isoformat(), "status": "paid",
                "filed_on": today.isoformat(), "paid_on": today.isoformat(), "amount_paid": o1["tax"], "confirmation": "TX-123"}
        self.assertEqual(sa.post("/api/manage/tax/filings/", body, format="json").status_code, 403)
        adm = self.c("adm1")
        self.assertEqual(adm.post("/api/manage/tax/filings/", {**body, "paid_on": ""}, format="json").status_code, 400)
        f = adm.post("/api/manage/tax/filings/", body, format="json").json()
        self.assertEqual(f["status"], "paid")
        self.assertEqual(Decimal(f["tax_due"]), Decimal(o1["tax"]))
        self.assertEqual(len(sa.get("/api/manage/tax/filings/").json()), 1)

    # ------------------------------------------------------------ employees: today only
    def test_employee_sees_today_only(self):
        mgr = self.c("mgr1")
        old = Order.objects.get(pk=self.sale(mgr).json()["id"])
        Order.objects.filter(pk=old.pk).update(created_at=timezone.now() - datetime.timedelta(days=2), status="completed")
        new = self.sale(mgr).json()
        emp = self.c("emp1")
        ids = [o["id"] for o in emp.get("/api/pos/orders/", {"date": (timezone.localdate() - datetime.timedelta(days=2)).isoformat()}).json()]
        self.assertEqual(ids, [new["id"]])
        self.assertEqual(emp.get(f"/api/pos/orders/{old.pk}/").status_code, 404)
        self.assertEqual(emp.get("/api/pos/orders/summary/").status_code, 403)
        self.assertEqual(len(mgr.get("/api/pos/orders/", {"date": "all"}).json()), 2)

    # ------------------------------------------------------------ owners
    def test_owners_admin_only(self):
        self.assertEqual(self.c("sa1").get("/api/manage/owners/").status_code, 403)
        adm = self.c("adm1")
        r = adm.post("/api/manage/owners/", {"name": "Kishoara", "share_percent": "60"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(adm.post("/api/manage/owners/", {"name": "Partner", "share_percent": "50"}, format="json").status_code, 400)
        adm.post("/api/manage/owners/", {"name": "Partner", "share_percent": "40"}, format="json")
        k = Owner.objects.get(name="Kishoara")
        r = adm.post("/api/manage/owners/draws/", {"owner": k.id, "amount": "500", "date": timezone.localdate().isoformat(), "method": "bank_transfer"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.sale(self.c("mgr1"), qty=10)
        split = adm.get("/api/manage/owners/split/").json()
        month = split["months"][-1]
        mine = next(o for o in month["owners"] if o["owner"] == k.id)
        self.assertEqual(mine["taken"], "500.00")
        self.assertEqual(Decimal(mine["share"]), (Decimal(month["net_profit"]) * Decimal("0.6")).quantize(Decimal("0.01")))
        self.assertEqual(split["share_total"], "100.00")
        self.assertEqual(OwnerDraw.objects.count(), 1)


# Only run the new tests here (the base class's tests run in tests_roles).
for _n in [n for n in dir(Base) if n.startswith("test_")]:
    if _n not in ExtraTests.__dict__:
        setattr(ExtraTests, _n, None)
del Base
