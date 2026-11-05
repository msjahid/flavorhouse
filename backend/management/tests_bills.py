"""Monthly bills, delivery-app days & payouts, cash limits, sales by employee, taxes paid."""
import datetime
from decimal import Decimal

from django.utils import timezone

from orders.models import DeliveryPartner

from .models import AppPayout, AppSalesDay, Bill, BankDeposit, CashDrop
from . import tests_roles

Base = tests_roles.RoleWiseTests
del tests_roles


class BillsAppsTests(Base):  # noqa: F821
    def bill(self, eid, **extra):
        body = {"category": "electric", "provider": "Con Edison", "bill_month": timezone.localdate().replace(day=1).isoformat(),
                "amount": "300.00", "tax": "24.50", "branch": self.a.id, **extra}
        return self.c(eid).post("/api/manage/bills/", body, format="json")

    # ------------------------------------------------------------ bills: role-wise add & edit
    def test_bills_role_wise(self):
        self.assertEqual(self.bill("emp1").status_code, 403)
        cr = self.bill("mgr1").json()
        self.assertEqual(cr["need_role"], "Supervisor")
        self.assertFalse(Bill.objects.exists())
        self.assertEqual(self.bill("mgr1").status_code, 201)          # a 2nd submission waits too (dupes are checked on saved bills)
        self.approve("sup1", cr["id"])
        b = Bill.objects.get()
        self.assertEqual((b.total, b.submitted_by, b.approved_by), (Decimal("324.50"), self.mgr.user, self.sup.user))
        self.assertEqual(self.bill("mgr1").status_code, 400)          # same bill for the month already saved
        # managers can't edit; supervisor edits a manager's bill → super admin approves
        self.assertEqual(self.c("mgr1").patch(f"/api/manage/bills/{b.id}/", {"amount": "310", "change_reason": "x"}, format="json").status_code, 403)
        self.assertEqual(self.c("sup1").patch(f"/api/manage/bills/{b.id}/", {"amount": "310"}, format="json").status_code, 400)  # reason
        cr = self.c("sup1").patch(f"/api/manage/bills/{b.id}/", {"amount": "310", "is_paid": True, "paid_on": timezone.localdate().isoformat(),
                                                              "paid_with": "autopay", "change_reason": "Bill corrected"}, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.approve("sa1", cr["id"])
        b.refresh_from_db()
        self.assertEqual((b.total, b.is_paid), (Decimal("334.50"), True))
        # a supervisor's own bill: only a super admin+ can edit it, and that goes to the admin
        cr = self.bill("sup1", category="trash", provider="Waste Management", amount="90").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.approve("sa1", cr["id"])
        t = Bill.objects.get(category="trash")
        self.assertEqual(self.c("sup2").patch(f"/api/manage/bills/{t.id}/", {"amount": "95", "change_reason": "x"}, format="json").status_code, 403)
        cr = self.c("sa1").patch(f"/api/manage/bills/{t.id}/", {"amount": "95", "change_reason": "x"}, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")
        # admin adds directly
        self.assertEqual(self.bill("adm1", category="internet", provider="Spectrum").json()["status"], "approved")
        r = self.c("mgr1").get("/api/manage/bills/").json()
        self.assertEqual(len(r["items"]), 3)
        self.assertEqual(len(r["categories"]), 3)
        self.assertEqual(self.c("mgr2").get("/api/manage/bills/").json()["items"], [])   # other store
        # bills come off profit
        pnl = self.c("sa1").get("/api/manage/reports/pnl/", {"period": "month"}).json()["total"]
        self.assertEqual(Decimal(pnl["bills"]), Bill.objects.filter(branch=self.a).aggregate(t=__import__("django.db.models", fromlist=["Sum"]).Sum("total"))["t"])

    # ------------------------------------------------------------ cash: no taking out more than there is
    def test_cash_limits(self):
        mgr = self.c("mgr1")
        r = mgr.post("/api/manage/cash/drops/", {"branch": self.a.id, "kind": "safe_drop", "amount": "250"}, format="json")
        self.assertEqual(r.status_code, 400)                  # drawer only has the $200 float
        self.assertEqual(mgr.post("/api/manage/cash/drops/", {"branch": self.a.id, "kind": "safe_drop", "amount": "150"}, format="json").status_code, 201)
        dep = {"branch": self.a.id, "amount": "200.00", "date": timezone.localdate().isoformat()}
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", dep, format="multipart").status_code, 400)   # safe has $150
        self.assertEqual(mgr.get("/api/manage/cash/deposits/", {"branch": self.a.id, "with_safe": 1}).json()["in_safe"], "150.00")
        dep["amount"] = "150.00"
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", dep, format="multipart").status_code, 201)
        dep["amount"] = "1.00"
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", dep, format="multipart").status_code, 400)
        # checks don't come out of the safe's cash
        dep.update(amount="80.00", cash_amount="0", check_amount="80.00", check_count=1)
        self.assertEqual(mgr.post("/api/manage/cash/deposits/", dep, format="multipart").status_code, 201, )
        self.assertEqual(BankDeposit.objects.count(), 2)

    # ------------------------------------------------------------ delivery apps: daily sales & payouts
    def test_app_days_and_payouts(self):
        ue = DeliveryPartner.objects.get(name="Uber Eats")
        day = (timezone.localdate() - datetime.timedelta(days=1)).isoformat()
        body = {"partner": ue.id, "branch": self.a.id, "date": day, "orders": 12, "sales": "240.00", "tax": "19.20", "fees": "72.00", "tax_by_app": True}
        self.assertEqual(self.c("mgr1").post("/api/manage/delivery-apps/days/", body, format="json").status_code, 403)   # supervisors and up
        self.assertEqual(self.c("mgr1").get("/api/manage/delivery-apps/ledger/").status_code, 403)
        cr = self.c("sup1").post("/api/manage/delivery-apps/days/", body, format="json").json()
        self.assertEqual(cr["need_role"], "Super admin")
        self.assertEqual(self.c("sup2").post("/api/manage/delivery-apps/days/", body, format="json").status_code, 400)   # already waiting
        self.approve("sa1", cr["id"])
        d = AppSalesDay.objects.get()
        self.assertEqual(d.expected, Decimal("168.00"))           # 240 − 72 fees (the app pays the tax)
        cr = self.c("sup1").post("/api/manage/delivery-apps/payouts/", {"partner": ue.id, "branch": self.a.id, "amount": "150.00",
                                                                     "received_on": timezone.localdate().isoformat()}, format="json").json()
        self.approve("sa1", cr["id"])
        led = self.c("sup1").get("/api/manage/delivery-apps/ledger/", {"period": "month"}).json()
        self.assertEqual((led["total"]["expected"], led["total"]["received"], led["total"]["balance"]), ("168.00", "150.00", "18.00"))
        self.assertEqual(led["daily"][0]["with_tax"], "259.20")
        # only a higher rank than the submitter edits
        self.assertEqual(self.c("sup2").patch(f"/api/manage/delivery-apps/days/{d.id}/", {"fees": "70", "change_reason": "x"}, format="json").status_code, 403)
        cr = self.c("sa1").patch(f"/api/manage/delivery-apps/days/{d.id}/", {"fees": "70", "change_reason": "Report fixed"}, format="json").json()
        self.assertEqual(cr["need_role"], "Admin")
        self.approve("adm1", cr["id"])
        self.assertEqual(AppSalesDay.objects.get().fees, Decimal("70.00"))
        p = AppPayout.objects.get()
        self.assertEqual(self.c("adm1").patch(f"/api/manage/delivery-apps/payouts/{p.id}/", {"amount": "170", "change_reason": "x"}, format="json").json()["status"], "approved")
        # app sales show in the tax report: tax the app pays isn't "your" tax; channel filter
        today = timezone.localdate()
        tax = self.c("sa1").get("/api/manage/reports/tax/", {"from": today.replace(day=1).isoformat(), "to": today.isoformat(),
                                                              "group": "month", "channel": "apps"}).json()
        self.assertEqual(Decimal(tax["total"]["app_tax"]), Decimal("19.20"))
        self.assertEqual(Decimal(tax["total"]["net_tax"]), Decimal("0.00"))
        self.assertEqual([c["key"] for c in tax["by_channel"]], ["store", "online", "apps"])

    # ------------------------------------------------------------ sales by employee
    def test_staff_sales(self):
        mgr = self.c("mgr1")
        self.sale(self.c("emp1"))
        self.sale(self.c("emp1"))
        appr = mgr.post("/api/pos/authorize/", {"action": "discount", "percent": 10, "employee_id": "mgr1", "password": tests_roles_pw()}, format="json")
        r = self.sale(mgr, discount_percent=10, discount_reason="Regular", approval=appr.json().get("approval"))
        self.assertEqual(r.status_code, 201, r.content)
        rep = mgr.get("/api/manage/reports/staff-sales/", {"period": "today"}).json()
        emp = next(x for x in rep["by_employee"] if x["employee_id"] == "EMP1")
        boss = next(x for x in rep["by_employee"] if x["employee_id"] == "MGR1")
        self.assertEqual((emp["orders"], emp["discounts"]), (2, 0))
        self.assertEqual(boss["discounts"], 1)
        self.assertEqual({r["role"] for r in rep["by_role"]}, {"employee", "manager"})
        self.assertEqual(len(mgr.get("/api/manage/reports/staff-sales/", {"period": "today", "discounted": 1}).json()["rows"]), 1)
        self.assertEqual(self.c("emp1").get("/api/manage/reports/staff-sales/").status_code, 403)

    # ------------------------------------------------------------ taxes you paid
    def test_taxes_paid(self):
        self.bill("adm1")
        today = timezone.localdate()
        paid = self.c("sa1").get("/api/manage/reports/tax/", {"from": today.replace(day=1).isoformat(), "to": today.isoformat()}).json()["paid"]
        self.assertEqual(paid["utility_tax"], "24.50")
        self.assertEqual(paid["utilities"][0]["name"], "Electricity")


def tests_roles_pw():
    from .tests_roles import PW
    return PW
