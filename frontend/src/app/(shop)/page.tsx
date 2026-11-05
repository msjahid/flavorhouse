import Link from "next/link";
import { getCategories, getItems } from "@/lib/api";
import MenuItemCard from "@/components/MenuItemCard";
import FoodImage from "@/components/FoodImage";

export default async function HomePage() {
  const [categories, featured] = await Promise.all([
    getCategories().catch(() => []),
    getItems({ featured: true }).catch(() => []),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="mb-4 inline-block rounded-full bg-mustard/30 px-3 py-1 text-sm font-semibold">
              🔥 Hot, fresh &amp; made to order
            </p>
            <h1 className="font-display text-5xl font-extrabold leading-[0.95] md:text-7xl">
              Saucy wings.
              <br />
              <span className="text-flame">Big burgers.</span>
              <br />
              Thick shakes.
            </h1>
            <p className="mt-6 max-w-md text-lg text-ink-soft">
              Pick from 8 wing flavours, stack your burger your way and finish with a hand-spun shake or a slice of
              cake.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/menu" className="btn-primary text-lg">Order now</Link>
              <Link href="/menu?category=wings" className="btn-ghost text-lg">Wing flavours →</Link>
            </div>
          </div>
          <div className="relative mx-auto aspect-square w-full max-w-md">
            <div className="absolute inset-0 rotate-6 rounded-[3rem] bg-flame" />
            <div className="absolute inset-0 -rotate-3 rounded-[3rem] bg-mustard" />
            <div className="absolute inset-0 grid place-items-center rounded-[3rem] bg-ink text-[9rem]">🍗</div>
            <span className="absolute -left-4 top-6 rounded-2xl bg-white px-4 py-2 text-3xl shadow-lg">🍔</span>
            <span className="absolute -right-2 bottom-10 rounded-2xl bg-white px-4 py-2 text-3xl shadow-lg">🥤</span>
            <span className="absolute bottom-[-1rem] left-10 rounded-2xl bg-white px-4 py-2 text-3xl shadow-lg">🍰</span>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4">
        <h2 className="font-display text-3xl font-extrabold md:text-4xl">What are you craving?</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/menu?category=${c.slug}`}
              className="group overflow-hidden rounded-3xl bg-white ring-1 ring-ink/5 transition hover:-translate-y-1 hover:shadow-lg"
            >
              <FoodImage src={c.image} emoji={c.emoji} alt={c.name} className="aspect-square" sizes="200px" />
              <div className="p-3 text-center">
                <p className="font-display font-bold group-hover:text-flame">{c.name}</p>
                <p className="text-xs text-ink-soft">{c.item_count} items</p>
              </div>
            </Link>
          ))}
        </div>
        {categories.length === 0 && (
          <p className="mt-6 rounded-2xl bg-white p-6 text-ink-soft">
            Can&apos;t reach the menu API. Make sure the Django server is running on{" "}
            <code>{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api"}</code>.
          </p>
        )}
      </section>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="mx-auto mt-20 max-w-6xl px-4">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-3xl font-extrabold md:text-4xl">Crowd favourites</h2>
            <Link href="/menu" className="font-semibold text-flame hover:underline">See full menu →</Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((item) => (
              <MenuItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Info strip */}
      <section className="mx-auto mt-20 grid max-w-6xl gap-4 px-4 sm:grid-cols-3">
        {[
          ["🛵", "Pickup or delivery", "Grab it hot from the counter or get it brought to your door."],
          ["💳", "Secure checkout", "Pay safely with card, Apple Pay or Google Pay via Stripe."],
          ["🧑‍🍳", "Made to order", "Nothing sits under a heat lamp. Ever."],
        ].map(([icon, title, text]) => (
          <div key={title} className="rounded-3xl bg-cream-dark p-6">
            <p className="text-3xl">{icon}</p>
            <p className="mt-2 font-display text-xl font-bold">{title}</p>
            <p className="mt-1 text-sm text-ink-soft">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
