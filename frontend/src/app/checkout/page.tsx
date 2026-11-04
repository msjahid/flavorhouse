"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/context/CartContext";
import { ApiError, createCheckout } from "@/lib/api";
import { money } from "@/lib/format";
import OrderSummary, { useQuote } from "@/components/OrderSummary";

type Fulfillment = "pickup" | "delivery";

export default function CheckoutPage() {
  const { lines, ready } = useCart();
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const { quote, error: quoteError, loading } = useQuote(fulfillment);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { checkout_url } = await createCheckout({
        customer_name: form.name,
        customer_email: form.email,
        customer_phone: form.phone,
        fulfillment,
        delivery_address: fulfillment === "delivery" ? form.address : "",
        notes: form.notes,
        items: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
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
          {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}
          <button type="submit" className="btn-primary mt-6 w-full" disabled={submitting || !!quoteError || !quote}>
            {submitting ? "Redirecting to payment…" : `Pay ${quote ? money(quote.total) : ""}`}
          </button>
          <p className="mt-3 text-center text-xs text-ink-soft">🔒 You&apos;ll pay securely on Stripe.</p>
        </OrderSummary>
      </form>
    </div>
  );
}
