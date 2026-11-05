"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import type { PosItem } from "@/lib/pos";
import type { OptionGroup } from "@/lib/types";

export interface ChosenLine {
  optionIds: number[];
  optionLabels: string[];
  unitPrice: number;
  quantity: number;
}

const minFor = (g: OptionGroup) => Math.max(g.min_select, g.required ? 1 : 0);

export default function OptionsModal({
  item,
  onClose,
  onAdd,
}: {
  item: PosItem;
  onClose: () => void;
  onAdd: (line: ChosenLine) => void;
}) {
  const [selected, setSelected] = useState<Record<number, number[]>>(() =>
    Object.fromEntries(
      item.option_groups.map((g) => [g.id, g.required && g.max_select === 1 && g.options[0] ? [g.options[0].id] : []]),
    ),
  );
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);

  const toggle = (g: OptionGroup, id: number) =>
    setSelected((prev) => {
      const cur = prev[g.id] ?? [];
      if (g.max_select === 1) return { ...prev, [g.id]: cur[0] === id && !g.required ? [] : [id] };
      if (cur.includes(id)) return { ...prev, [g.id]: cur.filter((x) => x !== id) };
      if (cur.length >= g.max_select) return prev;
      return { ...prev, [g.id]: [...cur, id] };
    });

  const all = item.option_groups.flatMap((g) => g.options);
  const ids = Object.values(selected).flat();
  const chosen = all.filter((o) => ids.includes(o.id));
  const unit = parseFloat(item.price) + chosen.reduce((s, o) => s + parseFloat(o.price_delta), 0);
  const missing = item.option_groups.filter((g) => (selected[g.id]?.length ?? 0) < minFor(g));

  const add = () => {
    if (missing.length) return setTried(true);
    onAdd({ optionIds: chosen.map((o) => o.id), optionLabels: chosen.map((o) => o.name), unitPrice: unit, quantity: qty });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-cream shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink/10 px-6 py-4">
          <h2 className="font-display text-2xl font-extrabold">{item.emoji} {item.name}</h2>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-ink/10" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {item.option_groups.map((g) => {
            const err = tried && (selected[g.id]?.length ?? 0) < minFor(g);
            return (
              <div key={g.id}>
                <p className={`mb-2 text-sm font-bold ${err ? "text-flame" : ""}`}>
                  {g.name}
                  <span className="ml-2 font-medium text-ink-soft">
                    {g.required ? "required" : "optional"}{g.max_select > 1 ? ` · up to ${g.max_select}` : ""}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {g.options.map((o) => {
                    const on = selected[g.id]?.includes(o.id);
                    const d = parseFloat(o.price_delta);
                    return (
                      <button key={o.id} onClick={() => toggle(g, o.id)} aria-pressed={on}
                        className={`min-h-14 rounded-2xl border-2 px-3 py-2 text-left text-sm font-semibold transition ${on ? "border-flame bg-flame text-white" : "border-ink/10 bg-white hover:border-ink/30"}`}>
                        {o.name}
                        {d > 0 && <span className={`block text-xs ${on ? "text-white/80" : "text-ink-soft"}`}>+{money(d)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-ink/10 bg-white px-6 py-4">
          <div className="flex items-center rounded-full bg-cream-dark">
            <button className="h-12 w-12 text-2xl" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">−</button>
            <span className="w-8 text-center text-lg font-bold">{qty}</span>
            <button className="h-12 w-12 text-2xl" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="Increase">+</button>
          </div>
          <button className="btn-primary flex-1 !py-4 text-lg" onClick={add}>
            Add · {money(unit * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}
