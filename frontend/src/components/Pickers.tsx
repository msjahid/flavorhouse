"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------- shared popover

function usePopover() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; up: boolean }>({ top: 0, left: 0, minWidth: 0, up: false });

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const h = pop.current?.offsetHeight ?? 320;
    const w = pop.current?.offsetWidth ?? r.width;
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left, minWidth: r.width, up });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  return { open, setOpen, btn, pop, pos, place };
}

const TRIGGER = {
  light: "bg-white text-ink ring-1 ring-ink/10 hover:ring-flame/50 focus-visible:ring-2 focus-visible:ring-flame",
  dark: "bg-cream/10 text-cream hover:bg-cream/20 focus-visible:ring-2 focus-visible:ring-mustard",
};

const Chevron = ({ open, dark }: { open: boolean; dark?: boolean }) => (
  <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""} ${dark ? "text-mustard" : "text-flame"}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7.5l5 5 5-5" /></svg>
);

// ---------------------------------------------------------------- Select

export interface SelectOption { value: string; label: string; hint?: string; icon?: string }

/** A styled dropdown (replaces the browser's plain <select>). Searchable when the list is long. */
export function Select({ value, onChange, options, placeholder = "Choose…", className = "", dark, size = "md", disabled, ariaLabel }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; placeholder?: string; className?: string;
  dark?: boolean; size?: "sm" | "md"; disabled?: boolean; ariaLabel?: string;
}) {
  const { open, setOpen, btn, pop, pos, place } = usePopover();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const current = options.find((o) => o.value === value);
  const list = useMemo(() => options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())), [options, q]);
  const searchable = options.length > 8;

  useEffect(() => { if (open) { setQ(""); setHi(Math.max(0, options.findIndex((o) => o.value === value))); } }, [open, options, value]);
  useEffect(() => { if (open) place(); }, [list.length, open, place]);

  const pick = (v: string) => { onChange(v); setOpen(false); btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    if (e.key === "Enter" && list[hi]) { e.preventDefault(); pick(list[hi].value); }
  };

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => setOpen(!open)} onKeyDown={onKey}
        className={`inline-flex items-center justify-between gap-2 rounded-xl font-semibold outline-none transition disabled:opacity-50 ${
          size === "sm" ? "px-3 py-1.5 text-sm" : "px-3.5 py-2 text-[15px]"} ${TRIGGER[dark ? "dark" : "light"]} ${className}`}>
        <span className="flex min-w-0 items-center gap-2 truncate">
          {current?.icon && <span>{current.icon}</span>}
          <span className={`truncate ${current ? "" : "opacity-50"}`}>{current?.label ?? placeholder}</span>
        </span>
        <Chevron open={open} dark={dark} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={pop} role="listbox" onKeyDown={onKey}
          style={{ top: pos.top, left: pos.left, minWidth: Math.max(pos.minWidth, 190) }}
          className="fixed z-[80] max-h-80 max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl bg-white p-1.5 text-ink shadow-2xl ring-1 ring-ink/10 animate-[popin_.12s_ease-out]">
          {searchable && (
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder="Search…"
              className="mb-1 w-full rounded-xl bg-cream px-3 py-2 text-sm outline-none" />
          )}
          <ul className="max-h-72 overflow-y-auto">
            {list.map((o, i) => {
              const sel = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={sel}>
                  <button type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${i === hi ? "bg-cream" : ""} ${sel ? "font-bold text-flame" : "font-medium"}`}>
                    {o.icon && <span>{o.icon}</span>}
                    <span className="flex-1">{o.label}{o.hint && <span className="block text-xs font-normal text-ink-soft">{o.hint}</span>}</span>
                    {sel && <span aria-hidden>✓</span>}
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-3 py-2 text-sm text-ink-soft">No matches</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

// ---------------------------------------------------------------- DatePicker

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s}T12:00:00`);
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A calendar date picker. value/onChange use "YYYY-MM-DD". */
export function DatePicker({ value, onChange, min, max, className = "", size = "md", label, dark }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; className?: string; size?: "sm" | "md"; label?: string; dark?: boolean;
}) {
  const { open, setOpen, btn, pop, pos } = usePopover();
  const sel = value ? parse(value) : new Date();
  const [view, setView] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  useEffect(() => { if (open) setView(new Date(sel.getFullYear(), sel.getMonth(), 1)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = isoOf(new Date());
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => isoOf(new Date(view.getFullYear(), view.getMonth(), i + 1)))];
  const out = (d: string) => (min && d < min) || (max && d > max);
  const shift = (m: number) => setView(new Date(view.getFullYear(), view.getMonth() + m, 1));
  const text = value ? parse(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Pick a date";
  const pick = (d: string) => { onChange(d); setOpen(false); };

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen(!open)} aria-label={label ?? "Choose date"}
        className={`inline-flex items-center gap-2 rounded-xl font-semibold outline-none transition ${size === "sm" ? "px-3 py-1.5 text-sm" : "px-3.5 py-2 text-[15px]"} ${TRIGGER[dark ? "dark" : "light"]} ${className}`}>
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 ${dark ? "text-mustard" : "text-flame"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        <span className="whitespace-nowrap tabular-nums">{value === today ? `Today · ${parse(value).toLocaleDateString([], { month: "short", day: "numeric" })}` : text}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={pop} style={{ top: pos.top, left: pos.left }}
          className="fixed z-[80] w-[296px] rounded-3xl bg-white p-4 text-ink shadow-2xl ring-1 ring-ink/10 animate-[popin_.12s_ease-out]">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-cream" aria-label="Previous month">‹</button>
            <p className="font-display text-lg font-extrabold">{view.toLocaleDateString([], { month: "long", year: "numeric" })}</p>
            <button type="button" onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-cream" aria-label="Next month">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK.map((w) => <span key={w} className="pb-1 text-[11px] font-bold uppercase text-ink-soft">{w}</span>)}
            {cells.map((c, i) => c === null ? <span key={`e${i}`} /> : (
              <button key={c} type="button" disabled={!!out(c)} onClick={() => pick(c)}
                className={`h-9 rounded-full text-sm font-semibold tabular-nums transition disabled:opacity-25 ${
                  c === value ? "bg-flame text-white shadow" : c === today ? "ring-2 ring-flame/40 hover:bg-cream" : "hover:bg-cream"}`}>
                {Number(c.slice(8))}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-ink/5 pt-3">
            <button type="button" className="rounded-full px-3 py-1.5 text-sm font-bold text-flame hover:bg-cream disabled:opacity-30"
              disabled={!!out(today)} onClick={() => pick(today)}>Today</button>
            <button type="button" className="rounded-full px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-cream"
              onClick={() => { const y = new Date(); y.setDate(y.getDate() - 1); const v = isoOf(y); if (!out(v)) pick(v); }}>Yesterday</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
