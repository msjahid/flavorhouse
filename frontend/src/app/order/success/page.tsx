"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useCart } from "@/context/CartContext";
import { getOrderBySession } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order } from "@/lib/types";

function SuccessContent() {
  const sessionId = useSearchParams().get("session_id");
  const { clear } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleared = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing payment session.");
      return;
    }
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      getOrderBySession(sessionId)
        .then((o) => {
          setOrder(o);
          if (o.status !== "pending" && !cleared.current) {
            cleared.current = true;
            clear();
          }
          // Payment may take a moment to confirm — poll a few times.
          if (o.status === "pending" && tries++ < 6) timer = setTimeout(load, 2000);
        })
        .catch((e: Error) => setError(e.message));
    load();
    return () => clearTimeout(timer);
  }, [sessionId, clear]);

  if (error) {
    return (
      <div className="text-center">
        <h1 className="font-display text-4xl font-extrabold">Hmm, something&apos;s off</h1>
        <p className="mt-2 text-ink-soft">{error}</p>
        <Link href="/" className="btn-primary mt-6">Go home</Link>
      </div>
    );
  }
  if (!order) return <p className="text-center text-ink-soft">Confirming your payment…</p>;

  const paid = order.status !== "pending" && order.status !== "cancelled";

  return (
    <div className="mx-auto max-w-xl">
      <div className="text-center">
        <p className="text-7xl">{paid ? "🎉" : "⏳"}</p>
        <h1 className="mt-4 font-display text-4xl font-extrabold">
          {paid ? "Order confirmed!" : "Waiting for payment confirmation…"}
        </h1>
        <p className="mt-2 text-ink-soft">
          Order <b>{order.number}</b> · {order.status_display}
        </p>
        {paid && (
          <p className="mt-1 text-ink-soft">
            {order.fulfillment === "pickup"
              ? "We'll have it hot and ready in about 20 minutes."
              : "Your food will be with you in 35–50 minutes."}{" "}
            A receipt was sent to {order.customer_email}.
          </p>
        )}
      </div>

      <div className="mt-8 rounded-3xl bg-white p-6 ring-1 ring-ink/5">
        <ul className="divide-y divide-ink/5 text-sm">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-4 py-2">
              <span>
                <b>{i.quantity}×</b> {i.name}
                {i.options.length > 0 && (
                  <span className="block text-ink-soft">{i.options.map((o) => o.name).join(" · ")}</span>
                )}
              </span>
              <span>{money(i.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-ink/10 pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
          {parseFloat(order.delivery_fee) > 0 && (
            <div className="flex justify-between"><dt>Delivery</dt><dd>{money(order.delivery_fee)}</dd></div>
          )}
          <div className="flex justify-between"><dt>Tax</dt><dd>{money(order.tax)}</dd></div>
          <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{money(order.total)}</dd></div>
        </dl>
      </div>
      <div className="mt-6 text-center">
        <Link href="/menu" className="btn-dark">Order something else</Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <Suspense>
        <SuccessContent />
      </Suspense>
    </div>
  );
}
