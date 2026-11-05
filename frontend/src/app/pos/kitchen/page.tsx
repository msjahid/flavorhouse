"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { minutesAgo, posApi, SOURCE_LABEL, type OrderStatus, type PosOrder } from "@/lib/pos";
import { usePosAuth } from "@/context/PosAuth";

const COLUMNS: { status: OrderStatus; title: string; tone: string }[] = [
  { status: "paid", title: "New", tone: "bg-mustard" },
  { status: "preparing", title: "Preparing", tone: "bg-flame" },
  { status: "ready", title: "Ready", tone: "bg-leaf" },
];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.16);
    });
  } catch {
    /* audio not available */
  }
}

export default function KitchenPage() {
  const { branchId } = usePosAuth();
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [, tick] = useState(0);
  const seen = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await posApi.orders({ status: "paid,preparing,ready", date: "today", order: "oldest", branch: String(branchId ?? "") });
      const newIds = list.filter((o) => o.status === "paid").map((o) => o.id);
      if (seen.current && sound && newIds.some((id) => !seen.current!.has(id))) beep();
      seen.current = new Set([...(seen.current ?? []), ...newIds]);
      setOrders(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Can't load orders.");
    }
  }, [sound, branchId]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const move = async (o: PosOrder, status: string) => {
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: status as OrderStatus } : x)).filter((x) => ["paid", "preparing", "ready"].includes(x.status)));
    try {
      await posApi.setStatus(o.id, status);
    } finally {
      load();
    }
  };

  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-cream/70">
        <span className="hidden sm:inline">Updates every 5 seconds · oldest first</span>
        <div className="flex items-center gap-4">
          {error && <span className="text-flame">{error}</span>}
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
            🔔 Sound for new orders
          </label>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-3 pb-3 md:grid-cols-3 md:overflow-visible">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col.status);
          return (
            <section key={col.status} className="flex shrink-0 flex-col rounded-2xl bg-cream/5 md:min-h-0 md:shrink">
              <h2 className="flex items-center gap-2 px-4 py-3 font-display text-xl font-extrabold text-cream">
                <span className={`h-3 w-3 rounded-full ${col.tone}`} />
                {col.title}
                <span className="ml-auto rounded-full bg-cream/10 px-2.5 text-base">{list.length}</span>
              </h2>
              <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
                {list.length === 0 && <p className="px-2 py-6 text-center text-sm text-cream/40">Nothing here</p>}
                {list.map((o) => <Ticket key={o.id} order={o} onMove={move} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Ticket({ order: o, onMove }: { order: PosOrder; onMove: (o: PosOrder, s: string) => void }) {
  const mins = minutesAgo(o.paid_at ?? o.created_at);
  const late = mins >= 20 ? "bg-flame text-white" : mins >= 10 ? "bg-mustard text-ink" : "bg-ink/10 text-ink";

  const next =
    o.status === "paid" ? { s: "preparing", label: "Start preparing" }
    : o.status === "preparing" ? { s: "ready", label: "Mark ready" }
    : o.partner ? { s: "completed", label: o.fulfillment === "delivery" ? `Handed to ${o.partner.name} courier` : "Picked up" }
    : o.fulfillment === "delivery" ? { s: "out_for_delivery", label: "Out for delivery" }
    : { s: "completed", label: o.fulfillment === "dine_in" ? "Served" : "Picked up" };

  return (
    <article className="rounded-2xl bg-cream p-4 shadow" style={o.partner ? { boxShadow: `inset 0 6px 0 ${o.partner.color}` } : undefined}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-3xl font-extrabold leading-none">
            #{o.short_number} <span className="text-sm font-semibold text-ink-soft">{o.number}</span>
          </p>
          <p className="mt-1 text-sm font-semibold">
            {o.partner
              ? <span className="rounded-md px-1.5 py-0.5 text-white" style={{ background: o.partner.color }}>{o.partner.emoji} {o.partner.name} #{o.partner_ref}</span>
              : SOURCE_LABEL[o.source]} · {o.fulfillment_display}
            {o.customer_name && <> · {o.customer_name}</>}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-sm font-bold tabular-nums ${late}`}>{mins}m</span>
      </header>
      <ul className="mt-3 space-y-1.5 border-t border-ink/10 pt-3">
        {o.items.map((i) => (
          <li key={i.id}>
            <p className="text-lg font-bold leading-tight"><span className="text-flame">{i.quantity}×</span> {i.name}</p>
            {i.options.length > 0 && <p className="pl-6 text-sm text-ink-soft">{i.options.map((x) => x.name).join(" · ")}</p>}
          </li>
        ))}
      </ul>
      {o.notes && <p className="mt-3 rounded-lg bg-mustard/40 px-3 py-2 text-sm font-semibold">📝 {o.notes}</p>}
      <button onClick={() => onMove(o, next.s)} className="btn-dark mt-4 w-full !py-3">
        {next.label} →
      </button>
    </article>
  );
}
