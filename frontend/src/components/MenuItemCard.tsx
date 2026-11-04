import Link from "next/link";
import type { MenuItem } from "@/lib/types";
import { money } from "@/lib/format";
import FoodImage from "./FoodImage";
import QuickAdd from "./QuickAdd";

export default function MenuItemCard({ item }: { item: MenuItem }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-ink/5 transition hover:-translate-y-1 hover:shadow-lg">
      <Link href={`/menu/${item.slug}`} className="block">
        <FoodImage src={item.image} emoji={item.emoji} alt={item.name} className="aspect-[4/3]" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
          {item.is_featured && <span className="rounded-full bg-mustard/30 px-2 py-0.5">⭐ Popular</span>}
          {item.is_spicy && <span className="rounded-full bg-flame/10 px-2 py-0.5 text-flame">🌶 Spicy</span>}
          {item.is_vegetarian && <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-leaf">🌱 Veg</span>}
        </div>
        <Link href={`/menu/${item.slug}`}>
          <h3 className="font-display text-xl font-bold group-hover:text-flame">{item.name}</h3>
        </Link>
        <p className="line-clamp-2 text-sm text-ink-soft">{item.description}</p>
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-lg font-bold">
            {item.has_options && <span className="text-xs font-medium text-ink-soft">from </span>}
            {money(item.price)}
          </span>
          {item.has_options ? (
            <Link href={`/menu/${item.slug}`} className="btn-primary !px-4 !py-2 text-sm">
              Customise
            </Link>
          ) : (
            <QuickAdd item={item} />
          )}
        </div>
      </div>
    </article>
  );
}
