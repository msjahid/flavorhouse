"""Upgrade existing installs: create a first branch, attach old orders to it, and give
existing POS staff accounts an employee profile so they can keep signing in."""
from django.db import migrations


def forwards(apps, schema_editor):
    Branch = apps.get_model("management", "Branch")
    StaffProfile = apps.get_model("management", "StaffProfile")
    Order = apps.get_model("orders", "Order")
    User = apps.get_model("auth", "User")

    branch = Branch.objects.order_by("id").first()
    if branch is None:
        branch = Branch.objects.create(name="Main", code="main")
    Order.objects.filter(branch__isnull=True).update(branch=branch)

    for u in User.objects.filter(is_staff=True, is_superuser=False):
        if not StaffProfile.objects.filter(user=u).exists():
            StaffProfile.objects.create(
                user=u, employee_id=u.username[:20], role="employee", branch=branch, status="active",
            )


class Migration(migrations.Migration):
    dependencies = [
        ("management", "0001_initial"),
        ("orders", "0004_order_branch_order_discount_amount_and_more"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
