"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { money } from "@/lib/format";
import type { MenuItemDetail, OptionGroup } from "@/lib/types";

function minFor(g: OptionGroup) {
  return Math.max(g.min_select, g.required ? 1 : 0);
}

export default function ItemCustomizer({ item }: { item: MenuItemDetail }) {
  const { add } = useCart();
  const router = useRouter();

  // Pre-select the first option for required single-choice groups (e.g. Size)
  const [selected, setSelected] = useState<Record<number, number[]>>(() =>
    Object.fromEntries(
      item.option_groups.map((g) => [g.id, g.required && g.max_select === 1 && g.options[0] ? [g.options[0].id] : []]),
    ),
  );
  const [qty, setQty] = useState(1);
  const [showErrors, setShowErrors] = useState(false);

  const toggle = (g: OptionGroup, optionId: number) => {
    setSelected((prev) => {
      const cur = prev[g.id] ?? [];
      if (g.max_select === 1) return { ...prev, [g.id]: [optionId] };
      if (cur.includes(optionId)) return { ...prev, [g.id]: cur.filter((id) => id !== optionId) };
      if (cur.length >= g.max_select) return prev;
      return { ...prev, [g.id]: [...cur, optionId] };
    });
  };

  const allOptions = item.option_groups.flatMap((g) => g.options.map((o) => ({ ...o, group: g })));
  const chosenIds = Object.values(selected).flat();
  const chosen = allOptions.filter((o) => chosenIds.includes(o.id));
  const unitPrice = parseFloat(item.price) + chosen.reduce((s, o) => s + parseFloat(o.price_delta), 0);

  const missing = useMemo(
    () => item.option_groups.filter((g) => (selected[g.id]?.length ?? 0) < minFor(g)),
    [item.option_groups, selected],
  );

  const handleAdd = (goToCart: boolean) => {
    if (missing.length) {
      setShowErrors(true);
      document.getElementById(`group-${missing[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    add({
      itemId: item.id,
      slug: item.slug,
      name: item.name,
      image: item.image,
      emoji: item.emoji,
      unitPrice,
      quantity: qty,
      optionIds: chosen.map((o) => o.id),
      optionLabels: chosen.map((o) => o.name),
    });
    router.push(goToCart ? "/cart" : "/menu");
  };

  return (
    <div className="mt-8 space-y-6">
      {item.option_groups.map((g) => {
        const count = selected[g.id]?.length ?? 0;
        const err = showErrors && count < minFor(g);
        return (
          <fieldset
            key={g.id}
            id={`group-${g.id}`}
            className={`rounded-3xl bg-white p-5 ring-2 transition ${err ? "ring-flame" : "ring-ink/5"}`}
          >
            <legend className="sr-only">{g.name}</legend>
            <div className="mb-3 flex items-baseline justify-between">
              <p className="font-display text-xl font-bold">{g.name}</p>
              <p className={`text-xs font-semibold ${err ? "text-flame" : "text-ink-soft"}`}>
                {g.required ? "Required" : "Optional"}
                {g.max_select > 1 && ` · choose up to ${g.max_select}`}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.options.map((o) => {
                const on = selected[g.id]?.includes(o.id);
                const delta = parseFloat(o.price_delta);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(g, o.id)}
                    aria-pressed={on}
                    className={`flex items-center justify-between rounded-2xl border-2 px-4 py-3 text-left text-sm font-medium transition ${
                      on ? "border-flame bg-flame/5" : "border-ink/10 hover:border-ink/30"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`grid h-5 w-5 place-items-center border-2 text-[10px] ${
                          g.max_select === 1 ? "rounded-full" : "rounded-md"
                        } ${on ? "border-flame bg-flame text-white" : "border-ink/25"}`}
                      >
                        {on && "✓"}
                      </span>
                      {o.name}
                    </span>
                    {delta > 0 && <span className="text-ink-soft">+{money(delta)}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-3xl bg-ink p-3 text-cream shadow-xl">
        <div className="flex items-center rounded-full bg-cream/10">
          <button className="h-11 w-11 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
          <span className="w-8 text-center font-bold">{qty}</span>
          <button className="h-11 w-11 text-xl" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="Increase">+</button>
        </div>
        <button className="btn-primary flex-1" onClick={() => handleAdd(true)}>
          Add to cart · {money(unitPrice * qty)}
        </button>
        <button className="btn !px-4 text-sm text-cream/80 hover:text-cream" onClick={() => handleAdd(false)}>
          Add &amp; keep browsing
        </button>
      </div>
    </div>
  );
}
