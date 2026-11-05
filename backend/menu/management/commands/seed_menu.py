from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from menu.models import Category, MenuItem, Option, OptionGroup

WING_FLAVOURS = [
    ("Classic Buffalo", 0), ("Honey BBQ", 0), ("Lemon Pepper", 0), ("Honey Garlic", 0),
    ("Mango Habanero", 0), ("Garlic Parmesan", 0), ("Korean Gochujang", 0.5), ("Nashville Hot", 0.5),
]
WING_SIZES = [("6 pieces", 0), ("12 pieces", 7.0), ("24 pieces", 18.0)]
DIPS = [("Ranch", 0.75), ("Blue Cheese", 0.75), ("Honey Mustard", 0.75), ("Extra Celery & Carrots", 1.0)]

BURGER_EXTRAS = [("Extra Patty", 3.0), ("Bacon", 1.5), ("Cheddar", 1.0), ("Jalapeños", 0.75),
                 ("Fried Egg", 1.25), ("Avocado", 1.5)]
BURGER_SIDES = [("No side", 0), ("Fries", 2.5), ("Sweet Potato Fries", 3.0), ("Onion Rings", 3.0)]

DRINK_SIZES = [("Regular", 0), ("Large", 1.0)]
SHAKE_SIZES = [("Regular (16oz)", 0), ("Large (24oz)", 1.5)]
SHAKE_TOPPINGS = [("Whipped Cream", 0), ("Oreo Crumble", 0.75), ("Caramel Drizzle", 0.5),
                  ("Sprinkles", 0.5), ("Brownie Bits", 1.0)]
CAKE_SIZES = [("Slice", 0), ("Whole cake (8\")", 28.0)]

COMBO_DRINKS = [("Soft drink", 0), ("Iced tea", 0), ("Lemonade", 0.5), ("Milkshake (upgrade)", 3.0)]
COMBO_SIDES = [("Seasoned fries", 0), ("Onion rings", 0.5), ("Loaded cheese fries", 2.0)]

MENU = [
    ("Combos", "🍱", "Meal deals — save when you bundle", [
        dict(name="Wing Combo", price="14.99", emoji="🍗", featured=True,
             desc="6 bone-in wings, a side and a drink. Save about $3.",
             groups=[("Flavour", True, 1, 2, WING_FLAVOURS), ("Side", True, 1, 1, COMBO_SIDES), ("Drink", True, 1, 1, COMBO_DRINKS)]),
        dict(name="Smash Burger Combo", price="15.49", emoji="🍔",
             desc="Classic smash burger, a side and a drink.",
             groups=[("Side", True, 1, 1, COMBO_SIDES), ("Drink", True, 1, 1, COMBO_DRINKS)]),
        dict(name="Family Wing Bucket", price="39.99", emoji="🪣",
             desc="24 wings in up to 3 flavours, 2 large fries and 4 drinks.",
             groups=[("Flavour", True, 1, 3, WING_FLAVOURS)]),
    ]),
    ("Wings", "🍗", "Crispy wings tossed in your favourite flavour", [
        dict(name="Bone-In Wings", price="9.99", emoji="🍗", featured=True, spicy=True,
             desc="Crispy, juicy, double-fried wings tossed in the flavour of your choice.",
             groups=[("Size", True, 1, 1, WING_SIZES), ("Flavour", True, 1, 2, WING_FLAVOURS),
                     ("Dips", False, 0, 4, DIPS)]),
        dict(name="Boneless Wings", price="8.99", emoji="🍗",
             desc="All-white-meat boneless bites, hand-breaded and sauced.",
             groups=[("Size", True, 1, 1, WING_SIZES), ("Flavour", True, 1, 2, WING_FLAVOURS),
                     ("Dips", False, 0, 4, DIPS)]),
        dict(name="Cauliflower Wings", price="8.49", emoji="🥦", veg=True,
             desc="Crispy cauliflower florets, perfect for a meat-free wing night.",
             groups=[("Flavour", True, 1, 1, WING_FLAVOURS), ("Dips", False, 0, 4, DIPS)]),
    ]),
    ("Burgers", "🍔", "Smash burgers on toasted brioche", [
        dict(name="Classic Smash Burger", price="10.99", emoji="🍔", featured=True,
             desc="Two smashed beef patties, American cheese, pickles, onions and house sauce.",
             groups=[("Extras", False, 0, 6, BURGER_EXTRAS), ("Side", False, 0, 1, BURGER_SIDES)]),
        dict(name="Crispy Chicken Burger", price="10.49", emoji="🍔",
             desc="Buttermilk-fried chicken thigh, slaw and spicy mayo.",
             groups=[("Sauce", True, 1, 1, [("Spicy Mayo", 0), ("Honey Mustard", 0), ("Buffalo", 0)]),
                     ("Extras", False, 0, 6, BURGER_EXTRAS), ("Side", False, 0, 1, BURGER_SIDES)]),
        dict(name="BBQ Bacon Burger", price="12.49", emoji="🍔", spicy=False,
             desc="Beef patty, smoked bacon, cheddar, crispy onions and smoky BBQ sauce.",
             groups=[("Extras", False, 0, 6, BURGER_EXTRAS), ("Side", False, 0, 1, BURGER_SIDES)]),
        dict(name="Veggie Burger", price="9.99", emoji="🥬", veg=True,
             desc="House-made black bean patty, avocado, lettuce and chipotle aioli.",
             groups=[("Extras", False, 0, 6, BURGER_EXTRAS[2:]), ("Side", False, 0, 1, BURGER_SIDES)]),
    ]),
    ("Drinks", "🥤", "Ice-cold refreshers", [
        dict(name="Fresh Lemonade", price="3.49", emoji="🍋",
             desc="Freshly squeezed lemonade.",
             groups=[("Size", True, 1, 1, DRINK_SIZES),
                     ("Flavour", True, 1, 1, [("Classic", 0), ("Strawberry", 0.5), ("Mint", 0.5), ("Mango", 0.5)])]),
        dict(name="Iced Tea", price="2.99", emoji="🧋",
             desc="Brewed in-house daily.",
             groups=[("Size", True, 1, 1, DRINK_SIZES),
                     ("Flavour", True, 1, 1, [("Peach", 0), ("Lemon", 0), ("Unsweetened", 0)])]),
        dict(name="Soft Drink", price="2.49", emoji="🥤",
             desc="Fountain soda.",
             groups=[("Size", True, 1, 1, DRINK_SIZES),
                     ("Choice", True, 1, 1, [("Cola", 0), ("Diet Cola", 0), ("Lemon-Lime", 0), ("Orange", 0)])]),
        dict(name="Bottled Water", price="1.49", emoji="💧", desc="500ml still water.", groups=[]),
    ]),
    ("Milkshakes", "🍨", "Thick, hand-spun shakes", [
        dict(name="Classic Milkshake", price="5.99", emoji="🥛", featured=True,
             desc="Hand-spun with real ice cream.",
             groups=[("Flavour", True, 1, 1, [("Vanilla", 0), ("Chocolate", 0), ("Strawberry", 0), ("Banana", 0)]),
                     ("Size", True, 1, 1, SHAKE_SIZES), ("Toppings", False, 0, 5, SHAKE_TOPPINGS)]),
        dict(name="Oreo Cookie Shake", price="6.99", emoji="🍪",
             desc="Vanilla ice cream blended with Oreo cookies.",
             groups=[("Size", True, 1, 1, SHAKE_SIZES), ("Toppings", False, 0, 5, SHAKE_TOPPINGS)]),
        dict(name="Salted Caramel Shake", price="6.99", emoji="🍮",
             desc="Rich caramel, a pinch of sea salt, topped with whipped cream.",
             groups=[("Size", True, 1, 1, SHAKE_SIZES), ("Toppings", False, 0, 5, SHAKE_TOPPINGS)]),
        dict(name="Nutella Shake", price="7.49", emoji="🍫",
             desc="Chocolate-hazelnut heaven.",
             groups=[("Size", True, 1, 1, SHAKE_SIZES), ("Toppings", False, 0, 5, SHAKE_TOPPINGS)]),
    ]),
    ("Cakes", "🍰", "Baked fresh every morning", [
        dict(name="Chocolate Fudge Cake", price="5.49", emoji="🍫", featured=True,
             desc="Three layers of moist chocolate sponge with fudge frosting.",
             groups=[("Size", True, 1, 1, CAKE_SIZES)]),
        dict(name="Red Velvet Cake", price="5.49", emoji="🍰",
             desc="Classic red velvet with cream cheese frosting.",
             groups=[("Size", True, 1, 1, CAKE_SIZES)]),
        dict(name="New York Cheesecake", price="5.99", emoji="🍰",
             desc="Creamy baked cheesecake on a graham cracker crust.",
             groups=[("Topping", False, 0, 1, [("Strawberry", 0.5), ("Blueberry", 0.5), ("Caramel", 0.5)]),
                     ("Size", True, 1, 1, CAKE_SIZES)]),
        dict(name="Carrot Cake", price="4.99", emoji="🥕",
             desc="Spiced carrot cake with walnuts and cream cheese icing.",
             groups=[("Size", True, 1, 1, CAKE_SIZES)]),
    ]),
    ("Sides", "🍟", "The perfect sidekicks", [
        dict(name="Seasoned Fries", price="3.49", emoji="🍟", veg=True, desc="Crispy fries with house seasoning.",
             groups=[("Size", True, 1, 1, [("Regular", 0), ("Large", 1.5)])]),
        dict(name="Onion Rings", price="3.99", emoji="🧅", veg=True, desc="Beer-battered onion rings.", groups=[]),
        dict(name="Loaded Cheese Fries", price="5.99", emoji="🧀", desc="Fries, cheese sauce, bacon and scallions.", groups=[]),
    ]),
]


class Command(BaseCommand):
    help = "Seed the database with a sample restaurant menu (wings, burgers, drinks, milkshakes, cakes)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing menu first")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["reset"]:
            MenuItem.objects.all().delete()
            Category.objects.all().delete()

        for c_order, (cat_name, cat_emoji, cat_desc, items) in enumerate(MENU):
            cat, _ = Category.objects.update_or_create(
                name=cat_name, defaults=dict(emoji=cat_emoji, description=cat_desc, sort_order=c_order)
            )
            for i_order, d in enumerate(items):
                item, created = MenuItem.objects.update_or_create(
                    name=d["name"],
                    defaults=dict(
                        category=cat, price=Decimal(d["price"]), description=d["desc"], emoji=d["emoji"],
                        is_featured=d.get("featured", False), is_spicy=d.get("spicy", False),
                        is_vegetarian=d.get("veg", False), sort_order=i_order,
                    ),
                )
                if not created:
                    item.option_groups.all().delete()
                for g_order, (g_name, req, mn, mx, opts_list) in enumerate(d["groups"]):
                    group = OptionGroup.objects.create(
                        item=item, name=g_name, required=req, min_select=mn, max_select=mx, sort_order=g_order
                    )
                    Option.objects.bulk_create([
                        Option(group=group, name=o, price_delta=Decimal(str(p)), sort_order=k)
                        for k, (o, p) in enumerate(opts_list)
                    ])

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {Category.objects.count()} categories and {MenuItem.objects.count()} items."
        ))
