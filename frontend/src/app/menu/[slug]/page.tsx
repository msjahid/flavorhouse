import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ApiError, getItem } from "@/lib/api";
import FoodImage from "@/components/FoodImage";
import ItemCustomizer from "@/components/ItemCustomizer";

async function load(slug: string) {
  try {
    return await getItem(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const item = await load((await params).slug);
  return { title: item.name, description: item.description };
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = await load((await params).slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href={`/menu?category=${item.category}`} className="text-sm font-semibold text-ink-soft hover:text-flame">
        ← Back to menu
      </Link>
      <div className="mt-4 grid gap-10 md:grid-cols-2">
        <div className="md:sticky md:top-24 md:self-start">
          <FoodImage src={item.image} emoji={item.emoji} alt={item.name} className="aspect-square rounded-[2rem]" priority />
        </div>
        <div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            {item.is_spicy && <span className="rounded-full bg-flame/10 px-2 py-0.5 text-flame">🌶 Spicy</span>}
            {item.is_vegetarian && <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-leaf">🌱 Vegetarian</span>}
            {item.calories && <span className="rounded-full bg-ink/5 px-2 py-0.5">{item.calories} kcal</span>}
          </div>
          <h1 className="mt-2 font-display text-4xl font-extrabold md:text-5xl">{item.name}</h1>
          <p className="mt-3 text-lg text-ink-soft">{item.description}</p>
          <ItemCustomizer item={item} />
        </div>
      </div>
    </div>
  );
}
