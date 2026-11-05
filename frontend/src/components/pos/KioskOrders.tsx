"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/format";
import { minutesAgo, posApi, type PosOrder } from "@/lib/pos";
import { usePosAuth } from "@/context/PosAuth";

/** Button + drawer on the Register listing self-order kiosk orders that still need paying. */
export default function KioskOrders({ onTakePayment }: { onTakePayment: (o: PosOrder) => void }) {
  const { branchId } = usePosAuth();
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    posApi.orders({ status: "unpaid", date: "today", order: "oldest", branch: String(branchId ?? "") }).then(setOrders).catch(() => {});
  }, [branchId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const cancel = async (o: PosOrder) => {
    if (!confirm(`Cancel kiosk order #${o.short_number} (${o.customer_name})?`)) return;
    await posApi.setStatus(o.id, "cancelled").catch(() => {});
    load();
  };

  return (
    <>
      <button onClick={() => { setOpen(true); load(); }}
        className={`relative shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ${orders.length ? "bg-sky-600 text-white" : "bg-white ring-1 ring-ink/10"}`}>
        🧍 Kiosk orders
        {orders.length > 0 && (
          <span className="ml-1.5 rounded-full bg-white px-1.5 text-xs font-bold text-sky-700">{orders.length}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink/50" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-full max-w-md flex-col bg-cream shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
              <h2 className="font-display text-2xl font-extrabold">Waiting to pay</h2>
              <button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-ink/10" aria-label="Close">✕</button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {orders.length === 0 && <p className="py-10 text-center text-ink-soft">No kiosk orders waiting.</p>}
              {orders.map((o) => (
                <article key={o.id} className="rounded-2xl bg-white p-4 ring-1 ring-ink/5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-3xl font-extrabold leading-none">#{o.short_number}</p>
                      <p className="mt-1 font-semibold">{o.customer_name} · {o.fulfillment === "dine_in" ? "Eat here" : "Take away"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-2xl font-extrabold">{money(o.total)}</p>
                      <p className="text-xs text-ink-soft">{minutesAgo(o.created_at)} min ago</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                  </p>
                  <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
                    <button onClick={() => cancel(o)} className="btn-ghost !px-4 !py-2.5 text-sm">Cancel</button>
                    <button onClick={() => { setOpen(false); onTakePayment(o); }} className="btn-primary !py-2.5">
                      Take payment
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
