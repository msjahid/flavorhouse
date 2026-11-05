"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { quoteCart } from "@/lib/api";
import { money } from "@/lib/format";
import { posApi, PosError, type DayStatus, type Partner, type PayInput, type PosCategory, type PosItem, type PosOrder, type TipConfig } from "@/lib/pos";
import { screenUrl, sendScreen, type ScreenLine } from "@/lib/display";
import type { Quote } from "@/lib/types";
import OptionsModal, { type ChosenLine } from "@/components/pos/OptionsModal";
import PaymentModal from "@/components/pos/PaymentModal";
import Receipt from "@/components/pos/Receipt";
import KioskOrders from "@/components/pos/KioskOrders";
import DiscountModal, { type Discount } from "@/components/pos/DiscountModal";
import { usePosAuth } from "@/context/PosAuth";
import Denominations, { countTotal, toCounts } from "@/components/Denominations";

interface TicketLine extends ChosenLine {
  key: string;
  itemId: number;
  name: string;
  emoji: string;
}

type Fulfillment = "dine_in" | "pickup" | "delivery";

export default function RegisterPage() {
  const { branchId, user } = usePosAuth();
  const [day, setDay] = useState<DayStatus | null>(null);
  const loadDay = useCallback(() => {
    posApi.day(branchId).then(setDay).catch(() => setDay(null));
  }, [branchId]);
  useEffect(loadDay, [loadDay]);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [tipCfg, setTipCfg] = useState<TipConfig | null>(null);
  // In store (null) or a delivery app (Uber Eats, DoorDash…)
  const [appId, setAppId] = useState<number | null>(null);
  const [appRef, setAppRef] = useState("");
  const [appErr, setAppErr] = useState<string | null>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [activeCat, setActiveCat] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const isManager = (user?.level ?? 0) >= 2;   // employees: no search, sold-out or screen buttons

  const [ticket, setTicket] = useState<TicketLine[]>([]);
  const [showTicket, setShowTicket] = useState(false);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);

  const [optionsFor, setOptionsFor] = useState<PosItem | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<PosOrder | null>(null);
  // Kiosk order being paid at the counter
  const [kioskOrder, setKioskOrder] = useState<PosOrder | null>(null);
  const [kioskDone, setKioskDone] = useState<PosOrder | null>(null);

  const loadMenu = useCallback(() => {
    posApi
      .menu()
      .then((m) => {
        setCategories(m.categories);
        setTaxRate(parseFloat(m.tax_rate));
        setPartners(m.partners ?? []);
        setTipCfg(m.tips ?? null);
        setLoadError(null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(loadMenu, [loadMenu]);

  const items = useMemo(() => {
    const list = activeCat === "all" ? categories.flatMap((c) => c.items) : categories.find((c) => c.id === activeCat)?.items ?? [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list;
  }, [categories, activeCat, search]);

  // ----- ticket
  const addLine = (item: PosItem, line: ChosenLine) => {
    const key = `${item.id}:${[...line.optionIds].sort((a, b) => a - b).join(",")}`;
    setTicket((prev) => {
      const ex = prev.find((l) => l.key === key);
      if (ex) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l));
      return [...prev, { ...line, key, itemId: item.id, name: item.name, emoji: item.emoji }];
    });
  };

  const tapItem = async (item: PosItem) => {
    if (soldOutMode) {
      const r = await posApi.setAvailability(item.id, !item.is_available);
      setCategories((cs) => cs.map((c) => ({ ...c, items: c.items.map((i) => (i.id === r.id ? { ...i, is_available: r.is_available } : i)) })));
      return;
    }
    if (!item.is_available) return;
    if (item.option_groups.length) setOptionsFor(item);
    else addLine(item, { optionIds: [], optionLabels: [], unitPrice: parseFloat(item.price), quantity: 1 });
  };

  const setQty = (key: string, q: number) =>
    setTicket((prev) => (q <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: q } : l))));

  const clearTicket = () => {
    setTicket([]);
    setDiscount(null);
    setCustomerName("");
    setContact("");
    setNotes("");
    setFulfillment("dine_in");
    setAppId(null);
    setAppRef("");
    setAppErr(null);
  };
  const app = partners.find((p) => p.id === appId) ?? null;


  // ----- totals (local estimate, replaced by the server quote)
  const markup = app ? 1 + parseFloat(app.markup_percent) / 100 : 1;
  const localSubtotal = ticket.reduce((s, l) => s + Math.round(l.unitPrice * markup * 100) / 100 * l.quantity, 0);
  const localTax = Math.round(localSubtotal * taxRate * 100) / 100;
  useEffect(() => {
    if (!ticket.length) return setQuote(null);
    const t = setTimeout(() => {
      quoteCart(ticket.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
        appId ? "pickup" : fulfillment, appId ? 0 : discount?.percent ?? 0,
        { branch: branchId, channel: "pos", ...(appId ? { partner: appId } : {}) })
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 200);
    return () => clearTimeout(t);
  }, [ticket, fulfillment, discount, branchId, appId]);
  const promoSavings = quote?.promo_savings ? parseFloat(quote.promo_savings) : 0;
  const subtotal = quote ? parseFloat(quote.subtotal) : localSubtotal;
  const discountAmt = quote?.discount_amount ? parseFloat(quote.discount_amount) : 0;
  const tax = quote ? parseFloat(quote.tax) : localTax;
  const total = quote ? parseFloat(quote.total) : localSubtotal + localTax;
  const count = ticket.reduce((n, l) => n + l.quantity, 0);

  // ----- customer screen: show the order as it's rung up (not for delivery-app orders)
  const screenLines: ScreenLine[] = ticket.map((l, i) => {
    const ql = quote?.lines?.[i];
    return { name: l.name, qty: l.quantity, options: l.optionLabels.join(" · "),
             total: ql ? parseFloat(ql.line_total) : l.unitPrice * l.quantity, promo: ql?.promotion ?? null };
  });
  useEffect(() => {
    if (paying || done || kioskOrder) return;   // the payment window drives the screen
    if (!ticket.length || appId) return sendScreen({ mode: "idle" });
    sendScreen({ mode: "cart", lines: screenLines, subtotal, savings: promoSavings, discount: discountAmt, tax, total }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket, quote, appId, paying, done, kioskOrder]);

  // Delivery-app order: already paid on the app — it goes straight to the kitchen
  const sendAppOrder = async () => {
    if (!app) return;
    setAppBusy(true); setAppErr(null);
    try {
      const order = await posApi.createOrder({
        items: ticket.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
        fulfillment: fulfillment === "delivery" ? "delivery" : "pickup",
        customer_name: customerName.trim(), customer_phone: contact.includes("@") ? "" : contact.trim(),
        notes: notes.trim(), partner: app.id, partner_ref: appRef.trim(), branch_id: branchId,
      });
      setDone(order);
    } catch (e) {
      setAppErr(e instanceof Error ? e.message : "Couldn't save the order.");
    }
    setAppBusy(false);
  };

  const pay = async (p: PayInput) => {
    const order = await posApi.createOrder({
      items: ticket.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
      fulfillment,
      customer_name: customerName.trim(),
      customer_phone: contact.includes("@") ? "" : contact.trim(),
      customer_email: contact.includes("@") ? contact.trim() : "",
      notes: notes.trim(),
      ...p,
      branch_id: branchId,
      ...(discount ? { discount_percent: discount.percent, discount_reason: discount.reason, approval: discount.approval } : {}),
    });
    setDone(order);
  };

  if (day && !day.started) return <StartDay day={day} canStart={(user?.level ?? 0) >= 2} onStarted={setDay} onRefresh={loadDay} />;

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_380px] print:block">
      {/* ------------------------------------------------ menu */}
      <section className="flex min-h-0 flex-col print:hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 bg-cream px-3 py-3 sm:px-4">
          <div className="no-scrollbar flex w-full min-w-0 gap-2 overflow-x-auto sm:w-auto sm:flex-1">
            <CatButton active={activeCat === "all"} onClick={() => setActiveCat("all")}>All</CatButton>
            {categories.map((c) => (
              <CatButton key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                {c.emoji} {c.name}
              </CatButton>
            ))}
          </div>
          {isManager && <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                 className="input !w-auto min-w-0 flex-1 !py-2 sm:!w-36 sm:flex-none" />}
          {isManager && (
            <span className="hidden shrink-0 items-stretch overflow-hidden rounded-xl bg-white ring-1 ring-ink/10 md:flex">
              <button onClick={() => window.open(screenUrl(), "fh-customer-screen", "popup,width=1280,height=800")}
                className="px-3 py-2 text-sm font-semibold hover:bg-cream"
                title="Opens the customer screen — drag it to the second monitor (double-click for full screen). It keeps running when staff log out and in.">📺 Customer screen</button>
              <button className="border-l border-ink/10 px-2.5 text-sm hover:bg-cream" title="Copy the link for a tablet"
                onClick={async () => { try { await navigator.clipboard.writeText(screenUrl()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { prompt("Open this link on the tablet:", screenUrl()); } }}>
                {copied ? "✓" : "🔗"}</button>
            </span>
          )}
          <KioskOrders onTakePayment={(o) => { setKioskDone(null); setKioskOrder(o); }} />
          {isManager && <button onClick={() => setSoldOutMode((v) => !v)}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold ${soldOutMode ? "bg-flame text-white" : "bg-white ring-1 ring-ink/10"}`}
            title="Tap items to mark them sold out / available">
            {soldOutMode ? "Done" : "Sold out…"}
          </button>}
        </div>

        {soldOutMode && (
          <p className="bg-flame px-4 py-2 text-sm font-semibold text-white">
            Tap an item to mark it sold out or back in stock. Sold-out items also disappear from the website.
          </p>
        )}
        {loadError && (
          <p className="m-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">
            {loadError} <button className="underline" onClick={loadMenu}>Retry</button>
          </p>
        )}

        <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 overflow-y-auto p-3 pb-24 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-3 sm:p-4 lg:pb-4">
          {items.map((item) => (
            <button key={item.id} onClick={() => tapItem(item)}
              className={`relative flex min-h-32 flex-col items-start rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-ink/5 transition active:scale-[0.97] ${
                item.is_available ? "hover:ring-flame" : "opacity-45"
              } ${soldOutMode ? "ring-2 ring-flame/40" : ""}`}>
              <span className="text-4xl">{item.emoji || "🍽️"}</span>
              <span className="mt-2 font-semibold leading-tight">{item.name}</span>
              <span className="mt-auto pt-1 text-sm font-bold text-ink-soft">
                {money(item.price)}{item.option_groups.length > 0 && " +"}
              </span>
              {!item.is_available && (
                <span className="absolute right-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase text-cream">Sold out</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ ticket */}
      {/* Phones: the ticket opens from a bar at the bottom */}
      {!showTicket && (
        <button onClick={() => setShowTicket(true)}
          className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-cream shadow-2xl lg:hidden print:hidden">
          <span className="font-semibold">🧾 Order · {count} item{count === 1 ? "" : "s"}</span>
          <span className="font-display text-xl font-extrabold tabular-nums">{money(total)} ›</span>
        </button>
      )}
      <aside className={`min-h-0 flex-col border-l border-ink/10 bg-white print:hidden ${showTicket ? "fixed inset-0 z-40 flex lg:static" : "hidden lg:flex"}`}>
        <button onClick={() => setShowTicket(false)} className="flex items-center gap-2 border-b border-ink/10 px-4 py-3 text-left font-semibold lg:hidden">
          ← Back to menu
        </button>
        <div className="space-y-3 border-b border-ink/10 p-4" style={app ? { boxShadow: `inset 4px 0 0 ${app.color}` } : undefined}>
          <div className="grid grid-cols-2 gap-2">
            {(app ? (["delivery", "pickup"] as const) : (["dine_in", "pickup"] as const)).map((f) => (
              <button key={f} onClick={() => setFulfillment(f)}
                className={`rounded-xl py-2.5 text-sm font-bold ${fulfillment === f ? "bg-ink text-cream" : "bg-cream-dark/70"}`}>
                {f === "dine_in" ? "🍽 Dine-in" : f === "delivery" ? "🛵 App courier" : app ? "🛍 Customer pickup" : "🥡 Takeaway"}
              </button>
            ))}
          </div>
          {app ? (
            <div className="grid grid-cols-2 gap-2">
              <input className="input !py-2 font-semibold" placeholder={`${app.name} order # *`} value={appRef}
                     onChange={(e) => setAppRef(e.target.value.toUpperCase())} />
              <input className="input !py-2" placeholder="Customer name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input className="input !py-2" placeholder={fulfillment === "dine_in" ? "Table # or name" : "Customer name"}
                     value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <input className="input !py-2" placeholder="Phone or email (optional)" inputMode="email"
                     value={contact} onChange={(e) => setContact(e.target.value)} title="Saves the customer so you can see their order history" />
            </div>
          )}
          {app && parseFloat(app.markup_percent) > 0 && (
            <p className="text-xs text-ink-soft">{app.name} prices are {parseFloat(app.markup_percent)}% above the in-store menu.</p>
          )}
        </div>

        <ul className="flex-1 divide-y divide-ink/5 overflow-y-auto">
          {ticket.length === 0 && <li className="p-8 text-center text-ink-soft">Tap items to start an order</li>}
          {ticket.map((l, idx) => {
            const ql = quote?.lines?.[idx];
            return (
            <li key={l.key} className="flex items-start gap-3 px-4 py-3">
              <span className="text-2xl">{l.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{l.name}</p>
                {l.optionLabels.length > 0 && <p className="text-xs text-ink-soft">{l.optionLabels.join(" · ")}</p>}
                {ql?.promotion && <p className="mt-0.5 inline-block rounded-md bg-leaf/15 px-1.5 text-[11px] font-bold text-leaf">🏷 {ql.promotion}</p>}
                <div className="mt-1.5 flex items-center gap-1">
                  <button className="h-8 w-8 rounded-lg bg-cream-dark text-lg" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Decrease">−</button>
                  <span className="w-7 text-center font-bold">{l.quantity}</span>
                  <button className="h-8 w-8 rounded-lg bg-cream-dark text-lg" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Increase">+</button>
                </div>
              </div>
              <span className="text-right font-bold tabular-nums">
                {ql?.promotion && ql.regular_price && <span className="block text-xs font-normal text-ink-soft line-through">{money(parseFloat(ql.regular_price) * l.quantity)}</span>}
                {money(ql ? parseFloat(ql.line_total) : l.unitPrice * l.quantity)}
              </span>
            </li>
            );
          })}
        </ul>

        <div className="border-t border-ink/10 p-4">
          <input className="input mb-3 !py-2 text-sm" placeholder="Kitchen note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal ({count} items)</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
            {promoSavings > 0 && (
              <div className="flex justify-between text-leaf">
                <dt>Offers<span className="block text-xs text-ink-soft">{quote?.promotions?.map((p) => p.name).join(", ")}</span></dt>
                <dd className="tabular-nums">−{money(promoSavings)}</dd>
              </div>
            )}
            {discount && (
              <div className="flex justify-between text-leaf">
                <dt>Discount {discount.percent}%<span className="block text-xs text-ink-soft">{discount.reason}{discount.approver ? ` · approved by ${discount.approver}` : ""}</span></dt>
                <dd className="tabular-nums">−{money(discountAmt)}</dd>
              </div>
            )}
            <div className="flex justify-between"><dt>Tax</dt><dd className="tabular-nums">{money(tax)}</dd></div>
            <div className="flex justify-between pt-1 font-display text-2xl font-extrabold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
          </dl>
          {appErr && <p className="mt-3 rounded-xl bg-flame/10 p-2.5 text-sm text-flame">{appErr}</p>}
          {app ? (
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <button className="btn-ghost !px-4" onClick={clearTicket} disabled={!ticket.length}>Clear</button>
              <button className="btn-primary !py-4 text-lg" style={{ background: app.color }} onClick={sendAppOrder}
                      disabled={!ticket.length || !appRef.trim() || !customerName.trim() || appBusy}>
                {appBusy ? "Saving…" : `Send to kitchen · paid on ${app.name}`}
              </button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-[auto_auto_1fr] gap-2">
              <button className="btn-ghost !px-4" onClick={clearTicket} disabled={!ticket.length}>Clear</button>
              <button className={`btn-ghost !px-4 ${discount ? "!border-leaf text-leaf" : ""}`} onClick={() => setShowDiscount(true)} disabled={!ticket.length}>
                % {discount ? `${discount.percent}%` : "Discount"}
              </button>
              <button className="btn-primary !py-4 text-lg" onClick={() => setPaying(true)} disabled={!ticket.length}>
                Charge {money(total)}
              </button>
            </div>
          )}
        </div>
      </aside>

      {showDiscount && (
        <DiscountModal current={discount} onClose={() => setShowDiscount(false)}
          onApply={(d) => { setDiscount(d); setShowDiscount(false); }} />
      )}
      {optionsFor && (
        <OptionsModal item={optionsFor} onClose={() => setOptionsFor(null)}
          onAdd={(line) => { addLine(optionsFor, line); setOptionsFor(null); }} />
      )}
      {done && done.partner && (
        <AppDone order={done} onNewOrder={() => { setDone(null); clearTicket(); setShowTicket(false); }} />
      )}
      {(paying || done) && !done?.partner && (
        <PaymentModal total={total} done={done} onPay={pay} tips={tipCfg} lines={screenLines}
          onCancel={() => setPaying(false)}
          onNewOrder={() => { setDone(null); setPaying(false); clearTicket(); setShowTicket(false); sendScreen({ mode: "idle" }); }} />
      )}
      {kioskOrder && (
        <PaymentModal
          title={`Kiosk #${kioskOrder.short_number} · ${kioskOrder.customer_name}`}
          total={parseFloat(kioskOrder.total)}
          done={kioskDone}
          tips={tipCfg}
          lines={kioskOrder.items.map((i) => ({ name: i.name, qty: i.quantity, options: i.options.map((o) => o.name).join(" · "), total: parseFloat(i.line_total) }))}
          onPay={async (p) => setKioskDone(await posApi.pay(kioskOrder.id, p))}
          onCancel={() => setKioskOrder(null)}
          onNewOrder={() => { setKioskOrder(null); setKioskDone(null); sendScreen({ mode: "idle" }); }} />
      )}
      {(done ?? kioskDone) && <Receipt order={(done ?? kioskDone)!} />}
    </div>
  );
}

function AppDone({ order, onNewOrder }: { order: PosOrder; onNewOrder: () => void }) {
  const p = order.partner!;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 print:hidden">
      <div className="w-full max-w-md rounded-3xl bg-cream p-8 text-center shadow-2xl">
        <p className="mx-auto grid h-16 w-16 place-items-center rounded-2xl text-3xl text-white" style={{ background: p.color }}>{p.emoji}</p>
        <h2 className="mt-3 font-display text-3xl font-extrabold">Sent to kitchen · #{order.short_number}</h2>
        <p className="mt-1 text-ink-soft">{p.name} order <b className="text-ink">#{order.partner_ref}</b> · {order.customer_name} · {order.fulfillment_display}</p>
        <dl className="mx-auto mt-5 max-w-xs space-y-1 rounded-2xl bg-white p-4 text-sm ring-1 ring-ink/5">
          <div className="flex justify-between"><dt>Order total on {p.name}</dt><dd className="font-bold">{money(order.total)}</dd></div>
          <div className="flex justify-between text-ink-soft"><dt>App fee</dt><dd>−{money(order.partner_commission)}</dd></div>
          {order.partner_collects_tax && <div className="flex justify-between text-ink-soft"><dt>Tax (paid by {p.name})</dt><dd>−{money(order.tax)}</dd></div>}
          <div className="flex justify-between border-t border-ink/10 pt-1 font-bold"><dt>Expected payout</dt><dd>{money(order.partner_payout)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-soft">Paid on the app — nothing to collect, it doesn't go in the cash drawer.</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className="btn-ghost" onClick={() => window.print()}>🖨 Print ticket</button>
          <button className="btn-primary" onClick={onNewOrder} autoFocus>New order</button>
        </div>
      </div>
    </div>
  );
}

function CatButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition ${active ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10 hover:ring-ink"}`}>
      {children}
    </button>
  );
}

function StartDay({ day, canStart, onStarted, onRefresh }: {
  day: DayStatus; canStart: boolean; onStarted: (d: DayStatus) => void; onRefresh: () => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = countTotal(counts);
  const suggested = parseFloat(day.suggested_float || "0");
  const diff = total - suggested;

  const start = async () => {
    setBusy(true); setErr(null);
    try { onStarted(await posApi.startDay(day.branch, toCounts(counts), note)); }
    catch (e) { setErr(e instanceof PosError ? e.message : "Failed"); }
    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm ring-1 ring-ink/5">
        <p className="text-5xl">☀️</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Start the day</h1>
        <p className="mt-1 text-ink-soft">
          {new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} ·
          the register opens once the opening cash (float) is counted.
        </p>
        {canStart ? (
          <>
            <p className="mt-5 text-sm font-semibold">Count the cash in the drawer</p>
            <p className="mb-3 text-xs text-ink-soft">Last close left {money(suggested)} for today.</p>
            <Denominations value={counts} onChange={setCounts} />
            {total > 0 && Math.abs(diff) >= 0.01 && (
              <p className={`mt-1 text-right text-sm font-semibold ${diff < 0 ? "text-flame" : "text-leaf"}`}>
                {diff < 0 ? "Short" : "Over"} {money(Math.abs(diff))} vs. last close
              </p>
            )}
            <input className="input mt-4" placeholder={Math.abs(diff) >= 0.01 && total > 0 ? "Note — why is it different? (required)" : "Note (optional)"}
                   value={note} onChange={(e) => setNote(e.target.value)} />
            {err && <p className="mt-3 rounded-xl bg-flame/10 p-3 text-sm text-flame">{err}</p>}
            <button className="btn-primary mt-5 w-full !py-4 text-lg" onClick={start}
                    disabled={busy || total <= 0 || (Math.abs(diff) >= 0.01 && !note.trim())}>
              Open register with {money(total)}
            </button>
          </>
        ) : (
          <div className="mt-6 rounded-2xl bg-mustard/25 p-5">
            <p className="font-bold">Waiting for a manager</p>
            <p className="mt-1 text-sm">A manager (or higher) needs to count the opening cash before sales can start. You can still clock in.</p>
            <button className="btn-ghost mt-4 !py-2" onClick={onRefresh}>↻ Check again</button>
          </div>
        )}
      </div>
    </div>
  );
}
