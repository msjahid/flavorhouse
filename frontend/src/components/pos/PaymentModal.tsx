"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { PayInput, PaymentPart, PosOrder, TipConfig } from "@/lib/pos";
import { newRequestId, sendScreen, watchTip, type ScreenLine } from "@/lib/display";

type Method = "cash" | "card" | "split";
interface Part { method: "cash" | "card"; amount: string; tendered: string; last4: string }
const cents = (v: number) => Math.round(v * 100) / 100;

function quickAmounts(total: number) {
  const set = new Set<number>([total]);
  for (const step of [5, 10, 20, 50, 100]) {
    const v = Math.ceil(total / step) * step;
    if (v > total) set.add(v);
  }
  return [...set].sort((a, b) => a - b).slice(0, 5);
}

export default function PaymentModal({
  total: orderTotal,
  onCancel,
  onPay,
  done,
  onNewOrder,
  title = "Take payment",
  tips,
  lines,
}: {
  total: number;
  onCancel: () => void;
  onPay: (p: PayInput) => Promise<void>;
  done: PosOrder | null;
  onNewOrder: () => void;
  title?: string;
  tips?: TipConfig | null;
  lines?: ScreenLine[];
}) {
  // ----- tip (asked on the customer screen; the cashier can also set it)
  const tipOn = !!tips?.enabled;
  const [tip, setTip] = useState(0);
  const [tipNote, setTipNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [customTip, setCustomTip] = useState<string | null>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const total = cents(orderTotal + tip);

  const askCustomer = () => {
    stopWatch.current?.();
    const id = newRequestId();
    setAsking(true);
    setTipNote(null);
    sendScreen({ mode: "tip", request_id: id, base: orderTotal.toFixed(2), total: orderTotal.toFixed(2), lines });
    stopWatch.current = watchTip(id, (t, a) => {
      setTip(t);
      setAsking(false);
      setTipNote(t > 0 ? `Customer added ${a.percent ? `${parseFloat(a.percent)}% · ` : ""}${money(t)}` : "Customer chose no tip");
      setCash("");
      setParts([]);
    });
  };
  const setTipByCashier = (t: number, note: string) => {
    stopWatch.current?.();
    setAsking(false);
    setTip(cents(t));
    setTipNote(note);
    setCustomTip(null);
    setCash("");
    setParts([]);
    sendScreen({ mode: "tip_done", request_id: "cashier", base: orderTotal.toFixed(2), total: orderTotal.toFixed(2), tip: cents(t).toFixed(2) });
  };
  // Ask as soon as the payment window opens
  useEffect(() => {
    if (tipOn && !done) askCustomer();
    return () => stopWatch.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Tell the customer screen when it's paid
  useEffect(() => {
    if (!done) return;
    stopWatch.current?.();
    sendScreen({ mode: "thanks", number: done.short_number, total: done.total, tip: done.tip ?? "0", change: done.change_given ?? "0" });
  }, [done]);

  const [method, setMethod] = useState<Method>("cash");
  const [cash, setCash] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const received = cash === "" ? total : parseFloat(cash);
  const change = received - total;
  const partsPaid = cents(parts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0));
  const remaining = cents(total - partsPaid);
  const partsOk = parts.length > 0 && Math.abs(remaining) < 0.005 && parts.every((p) => parseFloat(p.amount) > 0
    && (p.method === "card" || !p.tendered || parseFloat(p.tendered) + 1e-9 >= parseFloat(p.amount)));
  const splitChange = cents(parts.filter((p) => p.method === "cash" && p.tendered).reduce((s, p) => s + parseFloat(p.tendered) - parseFloat(p.amount), 0));
  const enough = method === "card" || (method === "split" ? partsOk : !Number.isNaN(received) && received + 1e-9 >= total);
  const addPart = (m: "cash" | "card") => setParts([...parts, { method: m, amount: remaining > 0 ? remaining.toFixed(2) : "", tendered: "", last4: "" }]);
  const setPart = (i: number, p: Partial<Part>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const pay = async () => {
    setBusy(true);
    setError(null);
    stopWatch.current?.();
    setAsking(false);
    const tipPart = tip > 0 ? { tip: tip.toFixed(2) } : {};
    try {
      if (method === "split") {
        await onPay({ ...tipPart, payments: parts.map((p): PaymentPart => ({
          method: p.method, amount: parseFloat(p.amount).toFixed(2),
          ...(p.method === "cash" && p.tendered ? { tendered: parseFloat(p.tendered).toFixed(2) } : {}),
          ...(p.method === "card" && p.last4 ? { card_last4: p.last4 } : {}),
        })) });
      } else {
        await onPay({ ...tipPart, payment_method: method, ...(method === "cash" && cash !== "" ? { cash_received: received.toFixed(2) } : {}) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  };

  const key = (k: string) =>
    setCash((c) => {
      if (k === "⌫") return c.slice(0, -1);
      if (k === "." && c.includes(".")) return c;
      if (c.includes(".") && c.split(".")[1].length >= 2) return c;
      return (c === "0" && k !== "." ? "" : c) + k;
    });

  // ---------- success screen
  if (done) {
    const changeDue = parseFloat(done.change_given ?? "0");
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 print:hidden">
        <div className="w-full max-w-md rounded-3xl bg-cream p-8 text-center shadow-2xl">
          <p className="text-6xl">✅</p>
          <h2 className="mt-3 font-display text-3xl font-extrabold">Paid · Order #{done.short_number}</h2>
          <p className="mt-1 text-ink-soft">{done.payment_method_display} · {money(done.total)}
            {parseFloat(done.tip ?? "0") > 0 && <> + tip {money(done.tip)} = <b className="text-ink">{money(parseFloat(done.total) + parseFloat(done.tip))}</b></>}</p>
          {done.payments.length > 1 && (
            <ul className="mx-auto mt-3 max-w-xs space-y-1 text-sm">
              {done.payments.map((p) => (
                <li key={p.id} className="flex justify-between rounded-lg bg-white px-3 py-1.5 ring-1 ring-ink/5">
                  <span>{p.method === "cash" ? "💵 Cash" : `💳 Card${p.card_last4 ? ` ••${p.card_last4}` : ""}`}</span><b>{money(p.amount)}</b>
                </li>
              ))}
            </ul>
          )}
          {parseFloat(done.change_given ?? "0") > 0 && (
            <div className="mt-6 rounded-2xl bg-ink p-5 text-cream">
              <p className="text-sm uppercase tracking-wide text-cream/60">Change due</p>
              <p className="font-display text-5xl font-extrabold text-mustard">{money(changeDue)}</p>
            </div>
          )}
          <p className="mt-4 text-sm text-ink-soft">Sent to the kitchen.</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button className="btn-ghost" onClick={() => window.print()}>🖨 Print receipt</button>
            <button className="btn-primary" onClick={onNewOrder} autoFocus>New order</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- payment screen
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" onClick={onCancel}>
      <div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-cream p-4 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-extrabold">{title}</h2>
          <p className="text-right font-display text-3xl font-extrabold tabular-nums">{money(total)}
            {tip > 0 && <span className="block text-xs font-semibold text-ink-soft">{money(orderTotal)} + {money(tip)} tip</span>}</p>
        </div>

        {tipOn && (
          <div className={`mt-4 rounded-2xl p-3 ring-1 ${asking ? "bg-mustard/25 ring-mustard" : "bg-white ring-ink/10"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">
                {asking ? <><span className="mr-1 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-flame" /> Asking the customer for a tip…</>
                  : tipNote ?? "Tip"}
              </p>
              {asking
                ? <button className="text-sm font-semibold text-ink-soft underline" onClick={() => { stopWatch.current?.(); setAsking(false); }}>Stop asking</button>
                : <button className="text-sm font-semibold text-flame underline" onClick={askCustomer}>📺 Ask on customer screen</button>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <TipChip on={tip === 0 && !!tipNote} onClick={() => setTipByCashier(0, "No tip")}>No tip</TipChip>
              {tips!.percents.map((p) => {
                const amt = cents(orderTotal * p / 100);
                return <TipChip key={p} on={tip === amt && tip > 0} onClick={() => setTipByCashier(amt, `${p}% tip · ${money(amt)}`)}>{p}% · {money(amt)}</TipChip>;
              })}
              {tips!.allow_custom && (customTip === null
                ? <TipChip on={false} onClick={() => setCustomTip(tip ? tip.toFixed(2) : "")}>Custom…</TipChip>
                : <span className="flex items-center gap-1">
                    <input autoFocus className="input !w-24 !px-2 !py-1.5" inputMode="decimal" placeholder="0.00" value={customTip}
                           onChange={(e) => setCustomTip(e.target.value.replace(/[^\d.]/g, ""))} />
                    <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-cream"
                      disabled={!(parseFloat(customTip) >= 0) || parseFloat(customTip) > orderTotal}
                      onClick={() => setTipByCashier(parseFloat(customTip), `Custom tip · ${money(parseFloat(customTip))}`)}>Add</button>
                  </span>)}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3">
          {(["cash", "card", "split"] as const).map((m) => (
            <button key={m} onClick={() => { setMethod(m); if (m === "split" && !parts.length) setParts([]); }}
              className={`rounded-2xl border-2 p-4 text-lg font-bold transition ${method === m ? "border-flame bg-flame text-white" : "border-ink/10 bg-white"}`}>
              {m === "cash" ? "💵 Cash" : m === "card" ? "💳 Card" : "➗ Split"}
            </button>
          ))}
        </div>

        {method === "split" ? (
          <div className="mt-5">
            <p className="text-sm text-ink-soft">Take part in cash and the rest on one or more cards. Add each part, then charge each card on the machine.</p>
            <div className="mt-3 space-y-2">
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-[90px_1fr_1fr_28px] items-center gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-ink/10">
                  <span className="text-sm font-bold">{p.method === "cash" ? "💵 Cash" : `💳 Card ${parts.filter((x, j) => x.method === "card" && j <= i).length}`}</span>
                  <label className="text-[11px] font-semibold uppercase text-ink-soft">Amount
                    <input className="input mt-0.5 !px-2 !py-1.5 text-base font-bold" inputMode="decimal" value={p.amount}
                           onChange={(e) => setPart(i, { amount: e.target.value })} /></label>
                  {p.method === "cash" ? (
                    <label className="text-[11px] font-semibold uppercase text-ink-soft">Cash handed over
                      <input className="input mt-0.5 !px-2 !py-1.5 text-base" inputMode="decimal" placeholder={p.amount || "0.00"} value={p.tendered}
                             onChange={(e) => setPart(i, { tendered: e.target.value })} /></label>
                  ) : (
                    <label className="text-[11px] font-semibold uppercase text-ink-soft">Last 4 digits (optional)
                      <input className="input mt-0.5 !px-2 !py-1.5 text-base" inputMode="numeric" maxLength={4} value={p.last4}
                             onChange={(e) => setPart(i, { last4: e.target.value.replace(/\D/g, "") })} /></label>
                  )}
                  <button onClick={() => setParts(parts.filter((_, j) => j !== i))} className="text-ink-soft hover:text-flame" aria-label="Remove">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="rounded-xl bg-white px-4 py-2.5 font-bold ring-1 ring-ink/10 hover:ring-ink" onClick={() => addPart("cash")} disabled={parts.length >= 8}>+ 💵 Cash part</button>
              <button className="rounded-xl bg-white px-4 py-2.5 font-bold ring-1 ring-ink/10 hover:ring-ink" onClick={() => addPart("card")} disabled={parts.length >= 8}>+ 💳 Card</button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-soft">{remaining < 0 ? "Too much by" : "Still to pay"}</p>
                <p className={`font-display text-3xl font-extrabold tabular-nums ${Math.abs(remaining) < 0.005 ? "text-leaf" : "text-flame"}`}>{money(Math.abs(remaining))}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase text-ink-soft">Cash change</p>
                <p className="font-display text-3xl font-extrabold tabular-nums">{money(Math.max(0, splitChange))}</p>
              </div>
            </div>
          </div>
        ) : method === "cash" ? (
          <div className="mt-5">
            <div className="flex flex-wrap gap-2">
              {quickAmounts(total).map((a) => (
                <button key={a} onClick={() => setCash(a === total ? "" : a.toFixed(2))}
                  className="rounded-xl bg-white px-4 py-3 font-bold ring-1 ring-ink/10 hover:ring-ink">
                  {a === total ? "Exact" : money(a)}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-ink/10">
              <div>
                <p className="text-xs font-semibold uppercase text-ink-soft">Cash received</p>
                <p className="font-display text-3xl font-extrabold tabular-nums">{cash ? `$${cash}` : money(total)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase text-ink-soft">Change</p>
                <p className={`font-display text-3xl font-extrabold tabular-nums ${enough ? "text-leaf" : "text-flame"}`}>
                  {enough ? money(change) : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
                <button key={k} onClick={() => key(k)} className="h-12 rounded-xl bg-white text-xl font-bold ring-1 ring-ink/10 active:bg-cream-dark">
                  {k}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-white p-4 text-sm ring-1 ring-ink/10">
            Charge <b>{money(total)}</b> on the card machine. Press <b>Card approved</b> once the machine shows
            the payment went through.
          </p>
        )}

        {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}

        <div className="mt-5 grid grid-cols-[auto_1fr] gap-3">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Back</button>
          <button className="btn-primary !py-4 text-lg" onClick={pay} disabled={busy || !enough}>
            {busy ? "Saving…" : method === "cash" ? "Complete cash sale" : method === "split" ? "All parts taken — complete" : "Card approved"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TipChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-sm font-bold ring-1 transition ${on ? "bg-leaf text-white ring-leaf" : "bg-cream ring-ink/10 hover:ring-ink"}`}>
      {children}
    </button>
  );
}
