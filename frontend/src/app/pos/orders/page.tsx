"use client";

import { useCallback, useEffect, useState } from "react";
import { money } from "@/lib/format";
import { localDateISO, posApi, SOURCE_LABEL, STATUS_STYLE, timeOf, type OrdersSummary, type PosOrder } from "@/lib/pos";
import { printDayReport, printReceipt } from "@/lib/printDocs";
import Receipt from "@/components/pos/Receipt";
import RefundModal from "@/components/pos/RefundModal";
import { usePosAuth } from "@/context/PosAuth";
import { DatePicker, Select } from "@/components/Pickers";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "paid,preparing,ready,out_for_delivery", label: "Active" },
  { value: "unpaid", label: "Waiting for payment (kiosk)" },
  { value: "completed", label: "Completed" },
  { value: "cancelled,refunded", label: "Cancelled / refunded" },
];

const ACTIONS: { status: string; label: string }[] = [
  { status: "preparing", label: "Preparing" },
  { status: "ready", label: "Ready" },
  { status: "out_for_delivery", label: "Out for delivery" },
  { status: "completed", label: "Completed" },
  { status: "cancelled", label: "Cancel" },
];

export default function OrdersPage() {
  const { branchId, branchName, user } = usePosAuth();
  const canSeeTotals = (user?.level ?? 0) >= 2;   // managers → admin; employees see today's orders only
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [refunding, setRefunding] = useState<PosOrder | null>(null);
  const [date, setDate] = useState(localDateISO());
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [selected, setSelected] = useState<PosOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Ask for this register's local day, so evening orders don't fall into "tomorrow" on a UTC server.
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const params: Record<string, string> = { date, start: dayStart.toISOString(), end: dayEnd.toISOString(), branch: String(branchId ?? "") };
    if (status) params.status = status;
    if (source) params.source = source;
    if (search.trim()) params.search = search.trim();
    if (canSeeTotals) posApi.ordersSummary({ start: params.start, end: params.end, branch: params.branch }).then(setSummary).catch(() => setSummary(null));
    try {
      const list = await posApi.orders(params);
      setOrders(list);
      setSelected((s) => (s ? list.find((o) => o.id === s.id) ?? s : s));
    } finally {
      setLoading(false);
    }
  }, [date, status, source, search, branchId, canSeeTotals]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    const poll = setInterval(load, 10_000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [load]);

  const act = async (fn: () => Promise<PosOrder | { order: PosOrder; message: string }>) => {
    try {
      const r = await fn();
      const order = "order" in r ? r.order : r;
      if ("message" in r) setFlash(r.message);
      setSelected(order);
      load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Action failed.");
    }
  };

  const shownTotal = orders.filter((o) => !["cancelled", "refunded"].includes(o.status)).reduce((s, o) => s + parseFloat(o.total), 0);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_420px] print:block">
      <section className="flex min-h-0 flex-col print:hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 bg-cream px-3 py-3 sm:px-4">
          {canSeeTotals
            ? <DatePicker value={date} max={localDateISO()} onChange={setDate} />
            : <span className="rounded-xl bg-white px-3.5 py-2 text-[15px] font-semibold ring-1 ring-ink/10">📅 Today</span>}
          <Select value={status} onChange={setStatus} options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
          <Select value={source} onChange={setSource} options={[
            { value: "", label: "All channels", icon: "🌐" }, { value: "online", label: "Website only", icon: "🌐" },
            { value: "pos", label: "Counter only", icon: "🧾" }, { value: "kiosk", label: "Kiosk only", icon: "📱" }]} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order #, name, phone…" className="input !w-full !py-2 sm:!w-56" />
          {canSeeTotals && (
            <span className="ml-auto text-sm text-ink-soft">
              {orders.length} shown · <b className="text-ink">{money(shownTotal)}</b>
            </span>
          )}
        </div>
        {!canSeeTotals && (
          <p className="border-b border-ink/10 bg-cream px-4 pb-2 text-xs text-ink-soft">Showing today&apos;s orders. Totals and past days are for managers and above.</p>
        )}
        {canSeeTotals && summary && (
          <div className="flex flex-wrap items-stretch gap-2 border-b border-ink/10 bg-cream px-3 pb-3 sm:px-4">
            {[
              ["Orders", String(summary.orders), ""],
              ["Sales", money(summary.sales), ""],
              [`Refunds (${summary.refunds.count})`, `−${money(summary.refunds.total)}`, parseFloat(summary.refunds.total) > 0 ? "text-flame" : ""],
              ["Net", money(summary.net), "text-leaf"],
              ...(parseFloat(summary.tips) > 0 ? [["Tips", money(summary.tips), ""] as [string, string, string]] : []),
              ...summary.by_method.filter((m) => parseFloat(m.taken) || parseFloat(m.refunded)).map((m) => [m.label, money(m.net), ""] as [string, string, string]),
            ].map(([l, v, c]) => (
              <div key={l} className="min-w-[calc(50%-4px)] flex-1 rounded-xl bg-white px-3 py-2 ring-1 ring-ink/5 sm:min-w-28 sm:flex-none">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{l}</p>
                <p className={`font-display text-lg font-extrabold tabular-nums ${c}`}>{v}</p>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <button className="btn-ghost !px-3 !py-2 text-sm" onClick={() => printDayReport(date, branchName, summary, orders)}>🖨 Day report</button>
              <button className="btn-dark !px-3 !py-2 text-sm" onClick={() => printDayReport(date, branchName, summary, orders, true)}>📄 Full list / PDF</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Phones: cards */}
          <ul className="divide-y divide-ink/5 bg-white md:hidden">
            {!loading && orders.length === 0 && <li className="p-10 text-center text-ink-soft">No orders found.</li>}
            {orders.map((o) => (
              <li key={o.id}>
                <button onClick={() => { setSelected(o); setFlash(null); }} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-cream">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><b>{o.number}</b><span className="text-xs text-ink-soft">{timeOf(o.created_at)}</span></span>
                    <span className="block truncate text-sm text-ink-soft">{o.partner && <AppTag o={o} />}{o.customer_name || "Walk-in"} · {o.fulfillment_display} · {o.partner ? `#${o.partner_ref}` : o.payment_method_display || "—"}</span>
                  </span>
                  <span className="text-right">
                    <b className="block tabular-nums">{money(o.total)}</b>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[o.status]}`}>{o.status_display}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-sm md:table">
            <thead className="sticky top-0 bg-cream-dark text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2">Order</th><th className="px-2">Time</th><th className="px-2">Customer</th>
                <th className="px-2">Type</th><th className="px-2">Payment</th><th className="px-2">Status</th>
                <th className="px-4 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5 bg-white">
              {!loading && orders.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-ink-soft">No orders found.</td></tr>
              )}
              {orders.map((o) => (
                <tr key={o.id} onClick={() => { setSelected(o); setFlash(null); }}
                    className={`cursor-pointer hover:bg-cream ${selected?.id === o.id ? "bg-mustard/15" : ""}`}>
                  <td className="px-4 py-3 font-bold">{o.number}</td>
                  <td className="px-2 tabular-nums">{timeOf(o.created_at)}</td>
                  <td className="px-2">{o.customer_name || <span className="text-ink-soft">Walk-in</span>}</td>
                  <td className="px-2">{o.partner ? <AppTag o={o} /> : SOURCE_LABEL[o.source].split(" ")[0]} {o.fulfillment_display}</td>
                  <td className="px-2">{o.partner ? <>Paid on {o.partner.name}<span className="block text-[11px] text-ink-soft">#{o.partner_ref}</span></> : o.payment_method_display || <span className="text-ink-soft">—</span>}
                    {parseFloat(o.tip) > 0 && <span className="block text-[11px] text-leaf">+ {money(o.tip)} tip</span>}
                    {o.payments.length > 1 && <span className="block text-[11px] text-ink-soft">{o.payments.map((p) => `${p.method === "cash" ? "Cash" : "Card"} ${money(p.amount)}`).join(" + ")}</span>}</td>
                  <td className="px-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[o.status]}`}>{o.status_display}</span></td>
                  <td className="px-4 text-right font-bold tabular-nums">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className={`min-h-0 overflow-y-auto border-l border-ink/10 bg-white print:hidden ${selected ? "fixed inset-0 z-40 lg:static" : "hidden lg:block"}`}>
        {selected && (
          <button onClick={() => setSelected(null)} className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-ink/10 bg-white px-4 py-3 text-left font-semibold lg:hidden">
            ← Back to orders
          </button>
        )}
        {!selected ? (
          <p className="p-10 text-center text-ink-soft">Select an order to see details.</p>
        ) : (
          <OrderDetail order={selected} flash={flash}
            onStatus={(s) => act(() => posApi.setStatus(selected.id, s))}
            onRefund={() => setRefunding(selected)} />
        )}
      </aside>
      {selected && <Receipt order={selected} />}
      {refunding && (
        <RefundModal order={refunding} onCancel={() => setRefunding(null)}
          onConfirm={async (reason, approval) => {
            const r = await posApi.refund(refunding.id, reason, approval);
            setRefunding(null);
            setFlash(r.message);
            setSelected(r.order);
            load();
          }} />
      )}
    </div>
  );
}

function OrderDetail({ order: o, flash, onStatus, onRefund }: {
  order: PosOrder; flash: string | null; onStatus: (s: string) => void; onRefund: () => void;
}) {
  const closed = ["refunded", "pending", "cancelled"].includes(o.status);
  const unpaid = o.status === "unpaid";
  return (
    <div className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-3xl font-extrabold">{o.number}</h2>
          <p className="text-sm text-ink-soft">
            {new Date(o.created_at).toLocaleString()} · {o.partner ? o.partner.name : SOURCE_LABEL[o.source].slice(3)}{o.created_by_name ? ` · ${o.created_by_name}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${STATUS_STYLE[o.status]}`}>{o.status_display}</span>
      </div>

      {flash && <p className="mt-4 rounded-xl bg-mustard/30 p-3 text-sm">{flash}</p>}

      <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-1 text-sm">
        <dt className="text-ink-soft">Type</dt><dd>{o.fulfillment_display}</dd>
        {o.customer_name && <><dt className="text-ink-soft">Customer</dt><dd>{o.customer_name}</dd></>}
        {o.customer_phone && <><dt className="text-ink-soft">Phone</dt><dd><a className="underline" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></dd></>}
        {o.customer_email && <><dt className="text-ink-soft">Email</dt><dd className="break-all">{o.customer_email}</dd></>}
        {o.delivery_address && <><dt className="text-ink-soft">Address</dt><dd className="whitespace-pre-line">{o.delivery_address}</dd></>}
        {o.partner && <><dt className="text-ink-soft">App order</dt><dd><AppTag o={o} /> <b>#{o.partner_ref}</b></dd></>}
        <dt className="text-ink-soft">Payment</dt><dd>{o.payment_method_display}
          {o.payments.length > 1 && o.payments.map((p) => (
            <span key={p.id} className="block text-xs text-ink-soft">{p.method === "cash" ? "💵 Cash" : `💳 Card${p.card_last4 ? ` ••${p.card_last4}` : ""}`} {money(p.amount)}</span>
          ))}</dd>
      </dl>
      {o.notes && <p className="mt-3 rounded-lg bg-mustard/30 px-3 py-2 text-sm">📝 {o.notes}</p>}

      <ul className="mt-4 divide-y divide-ink/5 rounded-2xl bg-cream/60 px-4 text-sm">
        {o.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 py-2">
            <span><b>{i.quantity}×</b> {i.name}{i.options.length > 0 && <span className="block text-ink-soft">{i.options.map((x) => x.name).join(" · ")}</span>}</span>
            <span className="tabular-nums">{money(i.line_total)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
        {parseFloat(o.delivery_fee) > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.delivery_fee)}</dd></div>}
        {parseFloat(o.discount_amount) > 0 && (
          <div className="flex justify-between text-leaf">
            <dt>Discount {parseFloat(o.discount_percent)}% · {o.discount_reason}
              {o.discount_approved_by_name && <span className="block text-xs text-ink-soft">by {o.discount_approved_by_name}</span>}</dt>
            <dd>−{money(o.discount_amount)}</dd>
          </div>
        )}
        <div className="flex justify-between"><dt>Tax</dt><dd>{money(o.tax)}</dd></div>
        <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
        {parseFloat(o.tip) > 0 && <div className="flex justify-between text-leaf"><dt>Tip (on top, not a sale)</dt><dd>{money(o.tip)}</dd></div>}
        {o.partner && (
          <div className="mt-2 space-y-1 rounded-xl bg-cream/70 p-3 text-xs">
            <div className="flex justify-between"><dt>{o.partner.name} fee</dt><dd>−{money(o.partner_commission)}</dd></div>
            {o.partner_collects_tax && <div className="flex justify-between"><dt>Tax collected & paid by {o.partner.name}</dt><dd>−{money(o.tax)}</dd></div>}
            <div className="flex justify-between font-bold"><dt>Expected payout</dt><dd>{money(o.partner_payout)}</dd></div>
          </div>
        )}
        {o.status === "refunded" && (
          <div className="rounded-lg bg-purple-50 p-2 text-purple-900">
            Refunded{o.refunded_by_name ? ` by ${o.refunded_by_name}` : ""}{o.refund_reason ? ` — ${o.refund_reason}` : ""}
          </div>
        )}
        {o.cash_received && (
          <div className="flex justify-between text-ink-soft"><dt>Cash / change</dt><dd>{money(o.cash_received)} / {money(o.change_given ?? 0)}</dd></div>
        )}
      </dl>

      {unpaid && (
        <p className="mt-6 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
          Kiosk order waiting for payment. Take payment on the <b>Register</b> → <b>Kiosk orders</b>.
        </p>
      )}
      {!closed && (
        <>
          <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink-soft">Change status</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ACTIONS.filter((a) => a.status !== o.status && (!unpaid || a.status === "cancelled") && (a.status !== "out_for_delivery" || o.fulfillment === "delivery")).map((a) => (
              <button key={a.status} onClick={() => onStatus(a.status)}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 ${a.status === "cancelled" ? "text-flame ring-flame/30 hover:bg-flame/5" : "ring-ink/10 hover:ring-ink"}`}>
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button className="btn-ghost !py-2.5 text-sm" onClick={() => window.print()}>🖨 Print receipt</button>
        <button className="btn-ghost !py-2.5 text-sm" onClick={() => printReceipt(o)} title="Opens the receipt — choose “Save as PDF” in the print window">📄 Receipt PDF</button>
        {!closed && !unpaid && <button className="btn !py-2.5 text-sm text-purple-800 ring-1 ring-purple-300 hover:bg-purple-50" onClick={onRefund}>↩ Refund</button>}
      </div>
    </div>
  );
}

function AppTag({ o }: { o: PosOrder }) {
  if (!o.partner) return null;
  return (
    <span className="mr-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: o.partner.color }}>
      {o.partner.emoji} {o.partner.name}
    </span>
  );
}
