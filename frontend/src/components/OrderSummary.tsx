"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";
import { quoteCart } from "@/lib/api";
import { money } from "@/lib/format";
import type { Quote } from "@/lib/types";

/** Asks the API for the real totals (prices, delivery fee, tax) every time the cart changes. */
export function useQuote(fulfillment: "pickup" | "delivery", extra: { branch?: number | null; code?: string } = {}) {
  const { branch = null, code = "" } = extra;
  const { lines, ready } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready || lines.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      quoteCart(
        lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
        fulfillment,
        0,
        { branch, channel: "online", code: code.trim() },
      )
        .then((q) => !cancelled && (setQuote(q), setError(null)))
        .catch((e: Error) => !cancelled && (setQuote(null), setError(e.message)))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [lines, ready, fulfillment, branch, code]);

  return { quote, error, loading };
}

export default function OrderSummary({
  quote,
  loading,
  error,
  fulfillment,
  children,
}: {
  quote: Quote | null;
  loading: boolean;
  error: string | null;
  fulfillment: "pickup" | "delivery";
  children?: React.ReactNode;
}) {
  const { subtotal } = useCart();
  return (
    <aside className="rounded-3xl bg-white p-6 ring-1 ring-ink/5 lg:sticky lg:top-24">
      <h2 className="font-display text-2xl font-bold">Order summary</h2>
      <dl className={`mt-4 space-y-2 text-sm ${loading ? "opacity-60" : ""}`}>
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>{money(quote?.subtotal ?? subtotal)}</dd>
        </div>
        {quote?.promo_savings && parseFloat(quote.promo_savings) > 0 && (
          <div className="flex justify-between text-leaf">
            <dt>🏷 {quote.promotions?.map((p) => p.name).join(", ") || "Offers"}</dt>
            <dd>−{money(quote.promo_savings)}</dd>
          </div>
        )}
        {fulfillment === "delivery" && (
          <div className="flex justify-between">
            <dt>Delivery</dt>
            <dd>{quote ? money(quote.delivery_fee) : "—"}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Tax</dt>
          <dd>{quote ? money(quote.tax) : "—"}</dd>
        </div>
        <div className="flex justify-between border-t border-ink/10 pt-3 text-lg font-bold">
          <dt>Total</dt>
          <dd>{quote ? money(quote.total) : "—"}</dd>
        </div>
      </dl>
      {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}
      {children}
    </aside>
  );
}
