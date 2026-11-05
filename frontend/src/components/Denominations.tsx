"use client";

import { money } from "@/lib/format";

export const DENOMS = ["100", "50", "20", "10", "5", "2", "1", "0.25", "0.10", "0.05", "0.01"];
const LABEL: Record<string, string> = {
  "100": "$100", "50": "$50", "20": "$20", "10": "$10", "5": "$5", "2": "$2", "1": "$1",
  "0.25": "25¢", "0.10": "10¢", "0.05": "5¢", "0.01": "1¢",
};

export const countTotal = (c: Record<string, string | number>) =>
  Object.entries(c).reduce((s, [k, v]) => s + parseFloat(k) * (parseInt(String(v)) || 0), 0);

export const toCounts = (c: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(c).filter(([, v]) => parseInt(String(v)) > 0).map(([k, v]) => [k, parseInt(String(v))]));

/** Count bills & coins: one box per denomination, live total. */
export default function Denominations({ value, onChange, disabled }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {DENOMS.map((k) => (
          <label key={k} className="rounded-xl bg-cream p-2 text-xs font-semibold">
            <span className="flex justify-between"><span>{LABEL[k]}</span>
              {parseInt(value[k] ?? "0") > 0 && <span className="text-ink-soft">{money(parseFloat(k) * parseInt(value[k]))}</span>}</span>
            <input type="number" inputMode="numeric" min={0} disabled={disabled} value={value[k] ?? ""} placeholder="0"
                   onChange={(e) => onChange({ ...value, [k]: e.target.value })}
                   className="input mt-1 !px-2 !py-1.5 text-base tabular-nums" />
          </label>
        ))}
      </div>
      <p className="mt-2 text-right font-display text-2xl font-extrabold tabular-nums">Total {money(countTotal(value))}</p>
    </div>
  );
}
