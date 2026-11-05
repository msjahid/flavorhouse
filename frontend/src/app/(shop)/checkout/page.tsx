"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { ApiError, createCheckout, getBranches } from "@/lib/api";
import { money } from "@/lib/format";
import OrderSummary, { useQuote } from "@/components/OrderSummary";

type Fulfillment = "pickup" | "delivery";

export default function CheckoutPage() {
  const { lines, ready } = useCart();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState<{ id: number; name: string; address: string }[]>([]);
  const [branch, setBranch] = useState<number | null>(null);
  const [code, setCode] = useState("");
  // Driver tip (delivery only): a % of the food, or a custom amount
  const [tipPick, setTipPick] = useState<number | "custom" | 0>(15);
  const [customTip, setCustomTip] = useState("");
  const { quote, error: quoteError, loading } = useQuote(fulfillment, { branch, code });

  useEffect(() => {
    getBranches().then((b) => { setBranches(b); setBranch((cur) => cur ?? b[0]?.id ?? null); }).catch(() => {});
  }, []);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!ready) return <div className="h-64" />;
  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center">
        <h1 className="font-display text-4xl font-extrabold">Nothing to check out</h1>
        <Link href="/menu" className="btn-primary mt-6">Browse the menu</Link>
      </div>
    );
  }

  const food = quote ? parseFloat(quote.subtotal) : 0;
  const tip = fulfillment !== "delivery" ? 0
    : tipPick === "custom" ? Math.max(0, Math.round((parseFloat(customTip) || 0) * 100) / 100)
    : Math.round(food * tipPick) / 100;
  const payTotal = (quote ? parseFloat(quote.total) : 0) + tip;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { checkout_url } = await createCheckout({
        branch,
        customer_name: form.name,
        customer_email: form.email,
        customer_phone: form.phone,
        fulfillment,
        delivery_address: fulfillment === "delivery" ? form.address : "",
        notes: form.notes,
        items: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
        code: code.trim(),
        ...(tip > 0 ? { tip: tip.toFixed(2) } : {}),
      });
      window.location.href = checkout_url; // Redirect to Stripe Checkout
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/cart" className="text-sm font-semibold text-ink-soft hover:text-flame">← Back to cart</Link>
      <h1 className="mt-2 font-display text-5xl font-extrabold">Checkout</h1>

      <form onSubmit={onSubmit} className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-3xl bg-white p-6 ring-1 ring-ink/5">
            <h2 className="font-display text-xl font-bold">How do you want it?</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(["pickup", "delivery"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFulfillment(f)}
                  className={`rounded-2xl border-2 p-4 text-left transition ${fulfillment === f ? "border-flame bg-flame/5" : "border-ink/10"}`}
                >
                  <p className="text-2xl">{f === "pickup" ? "🏃" : "🛵"}</p>
                  <p className="font-bold capitalize">{f}</p>
                  <p className="text-xs text-ink-soft">{f === "pickup" ? "Ready in ~20 min" : "35–50 min"}</p>
                </button>
              ))}
            </div>
          </section>

          {branches.length > 1 && (
            <section className="rounded-3xl bg-white p-6 ring-1 ring-ink/5">
              <h2 className="font-display text-xl font-bold">Which location?</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {branches.map((b) => (
                  <button key={b.id} type="button" onClick={() => setBranch(b.id)}
                    className={`rounded-2xl border-2 p-4 text-left transition ${branch === b.id ? "border-flame bg-flame/5" : "border-ink/10"}`}>
                    <p className="font-bold">📍 {b.name}</p>
                    {b.address && <p className="text-xs text-ink-soft">{b.address}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-4 rounded-3xl bg-white p-6 ring-1 ring-ink/5">
            <h2 className="font-display text-xl font-bold">Your details</h2>
            <input required className="input" placeholder="Full name" value={form.name} onChange={set("name")} autoComplete="name" />
            <div className="grid gap-4 sm:grid-cols-2">
              <input required type="email" className="input" placeholder="Email" value={form.email} onChange={set("email")} autoComplete="email" />
              <input required type="tel" className="input" placeholder="Phone" value={form.phone} onChange={set("phone")} autoComplete="tel" />
            </div>
            {fulfillment === "delivery" && (
              <textarea required className="input" rows={3} placeholder="Delivery address" value={form.address} onChange={set("address")} autoComplete="street-address" />
            )}
            <textarea className="input" rows={2} placeholder="Notes for the kitchen (optional)" value={form.notes} onChange={set("notes")} />
          </section>

          {fulfillment === "delivery" && (
            <section className="rounded-3xl bg-white p-6 ring-1 ring-ink/5">
              <h2 className="font-display text-xl font-bold">🛵 Tip your driver</h2>
              <p className="mt-1 text-sm text-ink-soft">100% goes to your driver — a little thank-you helps your food arrive hot and fast.</p>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {([0, 10, 15, 20] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setTipPick(p)}
                    className={`rounded-2xl border-2 px-2 py-3 text-center transition ${tipPick === p ? "border-flame bg-flame/5" : "border-ink/10 hover:border-ink/30"}`}>
                    <span className="block font-bold">{p === 0 ? "No tip" : `${p}%`}</span>
                    {p > 0 && <span className="block text-xs text-ink-soft">{money(Math.round(food * p) / 100)}</span>}
                  </button>
                ))}
                <button type="button" onClick={() => setTipPick("custom")}
                  className={`rounded-2xl border-2 px-2 py-3 text-center transition ${tipPick === "custom" ? "border-flame bg-flame/5" : "border-ink/10 hover:border-ink/30"}`}>
                  <span className="block font-bold">Custom</span><span className="block text-xs text-ink-soft">your amount</span>
                </button>
              </div>
              {tipPick === "custom" && (
                <label className="mt-3 flex items-center gap-2 rounded-2xl bg-cream/60 p-3">
                  <span className="text-lg font-bold">$</span>
                  <input autoFocus className="input !py-2" inputMode="decimal" placeholder="Type a tip for your driver, e.g. 5.00 — thanks for the fast delivery!"
                         value={customTip} onChange={(e) => setCustomTip(e.target.value.replace(/[^\d.]/g, ""))} />
                </label>
              )}
            </section>
          )}

          <section className="rounded-3xl bg-white p-6 ring-1 ring-ink/5">
            <h2 className="font-display text-xl font-bold">Items</h2>
            <ul className="mt-3 divide-y divide-ink/5 text-sm">
              {lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-4 py-2">
                  <span>
                    <b>{l.quantity}×</b> {l.name}
                    {l.optionLabels.length > 0 && <span className="block text-ink-soft">{l.optionLabels.join(" · ")}</span>}
                  </span>
                  <span>{money(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <OrderSummary quote={quote} loading={loading} error={quoteError} fulfillment={fulfillment}>
          <label className="mt-4 block text-sm font-semibold">Promo code
            <input className="input mt-1 !py-2 uppercase" placeholder="Optional" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {code.trim() && quote && !(quote.promotions ?? []).length && <p className="mt-1 text-xs text-ink-soft">This code doesn’t apply to your order right now.</p>}
          {tip > 0 && (
            <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-sm">
              <span>🛵 Driver tip</span><span className="font-semibold tabular-nums">{money(tip)}</span>
            </div>
          )}
          {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}
          <button type="submit" className="btn-primary mt-6 w-full" disabled={submitting || !!quoteError || !quote}>
            {submitting ? "Redirecting to payment…" : `Pay ${quote ? money(payTotal) : ""}`}
          </button>
          <p className="mt-3 text-center text-xs text-ink-soft">🔒 You&apos;ll pay securely on Stripe.</p>
        </OrderSummary>
      </form>
    </div>
  );
}
