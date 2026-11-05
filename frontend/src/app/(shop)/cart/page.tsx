"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCart } from "@/context/CartContext";
import { money } from "@/lib/format";
import FoodImage from "@/components/FoodImage";
import OrderSummary, { useQuote } from "@/components/OrderSummary";

function CartContent() {
  const { lines, ready, setQuantity, remove } = useCart();
  const { quote, error, loading } = useQuote("pickup");
  const cancelled = useSearchParams().get("cancelled");

  if (!ready) return <div className="h-64" />;

  if (lines.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-7xl">🛒</p>
        <h1 className="mt-4 font-display text-4xl font-extrabold">Your cart is empty</h1>
        <p className="mt-2 text-ink-soft">Wings are waiting.</p>
        <Link href="/menu" className="btn-primary mt-6">Browse the menu</Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-display text-5xl font-extrabold">Your cart</h1>
      {cancelled && (
        <p className="mt-4 rounded-xl bg-mustard/30 p-3 text-sm">Payment was cancelled — your cart is still here.</p>
      )}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="space-y-4">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-4 rounded-3xl bg-white p-4 ring-1 ring-ink/5">
              <Link href={`/menu/${l.slug}`} className="shrink-0">
                <FoodImage src={l.image} emoji={l.emoji} alt={l.name} className="h-24 w-24 rounded-2xl" sizes="96px" />
              </Link>
              <div className="flex flex-1 flex-col">
                <div className="flex justify-between gap-2">
                  <p className="font-display text-lg font-bold">{l.name}</p>
                  <p className="font-bold">{money(l.unitPrice * l.quantity)}</p>
                </div>
                {l.optionLabels.length > 0 && <p className="text-sm text-ink-soft">{l.optionLabels.join(" · ")}</p>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <div className="flex items-center rounded-full bg-cream-dark">
                    <button className="h-9 w-9" onClick={() => setQuantity(l.key, l.quantity - 1)} aria-label="Decrease">−</button>
                    <span className="w-6 text-center text-sm font-bold">{l.quantity}</span>
                    <button className="h-9 w-9" onClick={() => setQuantity(l.key, l.quantity + 1)} aria-label="Increase">+</button>
                  </div>
                  <button className="text-sm text-ink-soft hover:text-flame" onClick={() => remove(l.key)}>Remove</button>
                </div>
              </div>
            </li>
          ))}
          <Link href="/menu" className="inline-block pt-2 font-semibold text-flame hover:underline">+ Add more items</Link>
        </ul>

        <OrderSummary quote={quote} loading={loading} error={error} fulfillment="pickup">
          <p className="mt-2 text-xs text-ink-soft">Delivery fee (if any) is added at checkout.</p>
          <Link
            href="/checkout"
            className={`btn-primary mt-6 w-full ${error ? "pointer-events-none opacity-50" : ""}`}
            aria-disabled={!!error}
          >
            Go to checkout →
          </Link>
        </OrderSummary>
      </div>
    </>
  );
}

export default function CartPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Suspense>
        <CartContent />
      </Suspense>
    </div>
  );
}
