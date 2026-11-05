"use client";

import { useState } from "react";
import { money } from "@/lib/format";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

/** Single-series bar chart: one hue, thin rounded bars, recessive axis, hover tooltip per bar. */
export default function BarChart({
  data,
  height = 180,
  labelEvery = 1,
}: {
  data: { label: string; value: number; tip?: string }[];
  height?: number;
  labelEvery?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  return (
    <div>
      <div className="relative flex items-end gap-[2px] border-b border-ink/15 pl-12" style={{ height }}>
        {[0.5, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute left-12 right-0 border-t border-dashed border-ink/10" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -left-12 -top-2 w-10 text-right text-[11px] tabular-nums text-ink-soft">{money(max * f).replace(".00", "")}</span>
          </div>
        ))}
        {data.map((d, i) => (
          <div key={i} className="relative flex h-full flex-1 items-end justify-center"
               onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={`w-full max-w-10 rounded-t-[4px] transition-colors ${hover === i ? "bg-flame-dark" : "bg-flame"}`}
                 style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }} />
            {hover === i && (
              <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-cream shadow">
                <b>{d.label}</b> · {money(d.value)}{d.tip ? ` · ${d.tip}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] pl-12">
        {data.map((d, i) => (
          <span key={i} className="flex flex-1 justify-center overflow-visible whitespace-nowrap text-[11px] text-ink-soft">{i % labelEvery === 0 ? d.label : ""}</span>
        ))}
      </div>
    </div>
  );
}
