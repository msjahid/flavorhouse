"use client";

import { useCallback, useEffect, useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { money } from "@/lib/format";
import { localDateISO } from "@/lib/pos";
import { DatePicker, Select } from "@/components/Pickers";

// ---------------------------------------------------------------- data hook

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setLoading(true);
    fn().then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------- layout bits

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="mr-auto">
        <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {sub && <p className="text-sm text-ink-soft">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, className = "", action }: {
  title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-3xl bg-white p-4 ring-1 ring-ink/5 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {/* wide tables scroll sideways on phones instead of squashing */}
      <div className="-mx-1 overflow-x-auto px-1">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default" }: {
  label: string; value: string; sub?: string; tone?: "default" | "dark" | "good" | "bad";
}) {
  const t = {
    default: "bg-white ring-1 ring-ink/5",
    dark: "bg-ink text-cream",
    good: "bg-leaf/10 ring-1 ring-leaf/20",
    bad: "bg-flame/10 ring-1 ring-flame/20",
  }[tone];
  return (
    <div className={`rounded-3xl p-4 ${t}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === "dark" ? "text-cream/60" : "text-ink-soft"}`}>{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className={`text-xs ${tone === "dark" ? "text-cream/60" : "text-ink-soft"}`}>{sub}</p>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  pending: "bg-mustard/40 text-ink", approved: "bg-leaf/15 text-leaf", active: "bg-leaf/15 text-leaf",
  rejected: "bg-flame/15 text-flame-dark", inactive: "bg-ink/10 text-ink-soft",
};
export function Badge({ status, children }: { status: string; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[status] ?? "bg-ink/10"}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-2 sm:items-center sm:p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-3xl bg-cream p-4 shadow-2xl sm:p-6`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold">{title}</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/10" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <div className="mt-1 font-normal">{children}</div>
      {hint && <span className="mt-0.5 block text-xs font-normal text-ink-soft">{hint}</span>}
    </label>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <p className="rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p> : null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-soft">{children}</p>;
}

// ---------------------------------------------------------------- filters

export const PERIODS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["month", "This month"], ["year", "This year"], ["custom", "Custom"],
] as const;

export interface PeriodValue { period: string; from: string; to: string }

export function usePeriod(initial = "week") {
  const [value, setValue] = useState<PeriodValue>({ period: initial, from: localDateISO(), to: localDateISO() });
  const params = value.period === "custom" ? { from: value.from, to: value.to } : { period: value.period };
  return { value, setValue, params, key: JSON.stringify(params) };
}

export function PeriodPicker({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value.period} onChange={(period) => onChange({ ...value, period })} ariaLabel="Period"
        options={PERIODS.map(([k, l]) => ({ value: k, label: l, icon: "📅" }))} />
      {value.period === "custom" && (
        <>
          <DatePicker value={value.from} max={value.to} onChange={(from) => onChange({ ...value, from })} label="From" />
          <span className="text-sm text-ink-soft">to</span>
          <DatePicker value={value.to} min={value.from} onChange={(to) => onChange({ ...value, to })} label="To" />
        </>
      )}
    </div>
  );
}

/** Branch filter: hidden for single-branch roles (they only ever see their own). */
export function useBranchFilter(allowAll = true) {
  const { user } = usePosAuth();
  const multi = (user?.branches.length ?? 0) > 1 && (user?.level ?? 0) >= 3;
  const [branch, setBranch] = useState<number | null>(multi || !user?.branch ? null : user.branch.id);
  const picker = multi ? (
    <Select value={String(branch ?? "")} onChange={(v) => setBranch(v ? Number(v) : null)} ariaLabel="Store"
      options={[...(allowAll ? [{ value: "", label: "All stores", icon: "🏪" }] : []), ...user!.branches.map((b) => ({ value: String(b.id), label: b.name, icon: "🏪" }))]} />
  ) : user?.branch ? <span className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-ink/10">🏪 {user.branch.name}</span> : null;
  return { branch, setBranch, picker, multi };
}

export const usd = (v: string | number) => money(v);
export const pct = (v: string) => `${v}%`;
export const dt = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const d = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
