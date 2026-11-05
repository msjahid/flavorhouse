"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { money, SITE_NAME } from "@/lib/format";
import type { PosOrder } from "@/lib/pos";

const Row = ({ l, r, bold }: { l: React.ReactNode; r: React.ReactNode; bold?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: bold ? 700 : 400 }}><span>{l}</span><span>{r}</span></div>
);
const Hr = () => <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />;

/**
 * Printable 80 mm receipt. Rendered straight into <body> (outside the scrolling POS screen)
 * so the printer sees it on the first page; hidden on screen. Plain inline styles + black text
 * so small thermal printers print it cleanly.
 */
export default function Receipt({ order }: { order: PosOrder }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const promo = parseFloat(order.promo_discount ?? "0");
  return createPortal(
    <div id="receipt" aria-hidden>
      <div style={{ width: "72mm", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, lineHeight: 1.3, color: "#000" }}>
        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700 }}>{SITE_NAME}</div>
        {order.branch_name && <div style={{ textAlign: "center" }}>{order.branch_name}</div>}
        <div style={{ textAlign: "center" }}>{new Date(order.created_at).toLocaleString()}</div>
        <div style={{ textAlign: "center", fontSize: 28, fontWeight: 700, marginTop: 4 }}>#{order.short_number}</div>
        <div style={{ textAlign: "center", fontWeight: 700 }}>{order.number} · {order.fulfillment_display}</div>
        {order.partner && <div style={{ textAlign: "center", fontWeight: 700, fontSize: 14 }}>{order.partner.name.toUpperCase()} #{order.partner_ref}</div>}
        {order.customer_name && <div style={{ textAlign: "center" }}>{order.customer_name}</div>}
        <Hr />
        {order.items.map((i) => (
          <div key={i.id} style={{ marginBottom: 3 }}>
            <Row l={`${i.quantity} x ${i.name}`} r={money(i.line_total)} />
            {i.options.length > 0 && <div style={{ paddingLeft: 12 }}>{i.options.map((o) => o.name).join(", ")}</div>}
            {i.promotion && <div style={{ paddingLeft: 12 }}>* {i.promotion}</div>}
          </div>
        ))}
        <Hr />
        <Row l="Subtotal" r={money(order.subtotal)} />
        {promo > 0 && <Row l="You saved (offers)" r={money(promo)} />}
        {parseFloat(order.discount_amount) > 0 && <Row l={`Discount ${parseFloat(order.discount_percent)}%`} r={`-${money(order.discount_amount)}`} />}
        <Row l="Tax" r={money(order.tax)} />
        <div style={{ fontSize: 15 }}><Row l="TOTAL" r={money(order.total)} bold /></div>
        {parseFloat(order.tip ?? "0") > 0 && (<>
          <Row l="Tip" r={money(order.tip)} />
          <div style={{ fontSize: 15 }}><Row l="PAID" r={money(parseFloat(order.total) + parseFloat(order.tip))} bold /></div>
        </>)}
        {order.payments.length > 1 ? (
          <>
            <Hr />
            {order.payments.map((p) => (
              <Row key={p.id} l={p.method === "cash" ? "Cash" : `Card${p.card_last4 ? ` **${p.card_last4}` : ""}`} r={money(p.amount)} />
            ))}
            {parseFloat(order.change_given ?? "0") > 0 && <Row l="Change" r={money(order.change_given ?? 0)} />}
          </>
        ) : (
          <>
            <Row l="Paid by" r={order.payment_method_display || "Unpaid"} />
            {order.cash_received && (<><Row l="Cash" r={money(order.cash_received)} /><Row l="Change" r={money(order.change_given ?? 0)} /></>)}
          </>
        )}
        {order.status === "refunded" && (
          <div style={{ border: "2px solid #000", textAlign: "center", fontWeight: 700, margin: "6px 0", padding: 3 }}>
            REFUNDED −{money(parseFloat(order.total) + parseFloat(order.tip ?? "0"))}{order.refund_reason ? ` · ${order.refund_reason}` : ""}
          </div>
        )}
        {order.notes && <div style={{ marginTop: 6 }}>Note: {order.notes}</div>}
        <Hr />
        <div style={{ textAlign: "center" }}>Served by {order.created_by_name ?? "-"}</div>
        <div style={{ textAlign: "center" }}>Thank you!</div>
      </div>
    </div>,
    document.body,
  );
}
