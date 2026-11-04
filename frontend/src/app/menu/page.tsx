import Link from "next/link";
import type { Metadata } from "next";
import { getCategories, getItems } from "@/lib/api";
import MenuItemCard from "@/components/MenuItemCard";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; search?: string }>;
}) {
  const { category, search } = await searchParams;
  const [categories, items] = await Promise.all([
    getCategories().catch(() => []),
    getItems({ category, search }).catch(() => []),
  ]);
  const active = categories.find((c) => c.slug === category);

  // Group items by category when showing the whole menu
  const groups = active
    ? [{ cat: active, items }]
    : categories.map((cat) => ({ cat, items: items.filter((i) => i.category === cat.slug) })).filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-display text-5xl font-extrabold">{active ? `${active.emoji} ${active.name}` : "Our menu"}</h1>
      {active?.description && <p className="mt-2 text-lg text-ink-soft">{active.description}</p>}

      <div className="sticky top-16 z-30 -mx-4 mt-6 bg-cream/95 px-4 py-3 backdrop-blur">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <Link
            href="/menu"
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${!active ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10 hover:ring-ink"}`}
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/menu?category=${c.slug}`}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active?.id === c.id ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10 hover:ring-ink"}`}
            >
              {c.emoji} {c.name}
            </Link>
          ))}
        </div>
        <form action="/menu" className="mt-3 max-w-sm">
          {category && <input type="hidden" name="category" value={category} />}
          <input name="search" defaultValue={search} placeholder="Search the menu…" className="input !py-2" />
        </form>
      </div>

      {groups.length === 0 && <p className="mt-10 text-ink-soft">No items found.</p>}

      {groups.map(({ cat, items }) => (
        <section key={cat.id} id={cat.slug} className="mt-10">
          {!active && <h2 className="font-display text-3xl font-extrabold">{cat.emoji} {cat.name}</h2>}
          <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
