from django.db import migrations


def presets(apps, schema_editor):
    T = apps.get_model("orders", "TipSettings")
    t, _ = T.objects.get_or_create(pk=1, defaults={"percents": [2, 5, 10, 20]})
    if t.percents in ([2, 5], [], None):
        t.percents = [2, 5, 10, 20]
        t.save()


class Migration(migrations.Migration):
    dependencies = [("orders", "0008_delivery_apps_tips")]
    operations = [migrations.RunPython(presets, migrations.RunPython.noop)]
