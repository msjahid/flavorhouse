"""Existing supervisors / super admins keep access to every current store; preload job titles and vendors."""
from django.db import migrations

JOB_TITLES = ["Cashier", "Line cook", "Prep cook", "Grill cook", "Fry cook", "Dishwasher", "Server", "Host",
              "Busser", "Porter / Cleaner", "Delivery driver", "Shift lead", "Baker", "Barista", "Store manager"]

VENDORS = [
    dict(name="Restaurant Depot", website="restaurantdepot.com", payment_terms="card",
         categories="Meat, produce, dairy, dry goods, packaging", notes="Membership warehouse — bring member card"),
    dict(name="Sysco", website="sysco.com", payment_terms="net15",
         categories="Meat & poultry, frozen, produce, dairy, disposables", notes="Broadline distributor — delivery"),
    dict(name="Costco Business Center", website="costcobusinessdelivery.com", payment_terms="card",
         categories="Beverages, dry goods, cleaning, paper goods"),
    dict(name="Walmart", website="walmart.com", payment_terms="card", categories="Small supplies, cleaning, emergency runs"),
]


def forwards(apps, schema_editor):
    Branch = apps.get_model("management", "Branch")
    StaffProfile = apps.get_model("management", "StaffProfile")
    JobTitle = apps.get_model("management", "JobTitle")
    Vendor = apps.get_model("management", "Vendor")
    stores = list(Branch.objects.filter(is_active=True))
    for p in StaffProfile.objects.filter(role__in=["supervisor", "superadmin"]):
        p.assigned_branches.add(*stores)
    for t in JOB_TITLES:
        JobTitle.objects.get_or_create(name=t)
    for v in VENDORS:
        Vendor.objects.get_or_create(name=v["name"], defaults=v)


class Migration(migrations.Migration):
    dependencies = [("management", "0003_vendor_dailyclose_edited_by_and_more")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
