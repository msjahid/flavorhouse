from django.core.management import call_command
from django.test import TestCase

from menu.models import MenuItem


class FullMenuTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_menu", verbosity=0)

    def test_full_menu_hides_sold_out(self):
        MenuItem.objects.filter(name="Bottled Water").update(is_available=False)
        data = self.client.get("/api/menu/full/").json()
        names = [i["name"] for c in data for i in c["items"]]
        self.assertIn("Bone-In Wings", names)
        self.assertNotIn("Bottled Water", names)
        wings = next(c for c in data if c["slug"] == "wings")["items"][0]
        self.assertEqual([g["name"] for g in wings["option_groups"]], ["Size", "Flavour", "Dips"])
