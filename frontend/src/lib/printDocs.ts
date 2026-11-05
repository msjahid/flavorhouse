import { money, SITE_NAME } from "./format";
import type { OrdersSummary, PosOrder } from "./pos";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Opens a print window. In the print dialog choose your receipt printer, or "Save as PDF". */
export function openPrint(title: string, body: string, width = "80mm") {
  const w = window.open("", "_blank", "width=480,height=800");
  if (!w) { alert("Allow pop-ups for this site to print or save a PDF."); return; }
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    @page { size: ${width === "80mm" ? "80mm auto" : "letter"}; margin: ${width === "80mm" ? "4mm" : "12mm"}; }
    body { font-family: ui-monospace, Menlo, Consolas, monospace; color: #000; margin: 0 auto; width: ${width === "80mm" ? "72mm" : "auto"}; font-size: 12px; }
    .c { text-align: center } .b { font-weight: 700 } .big { font-size: 26px; font-weight: 700 } .r { display: flex; justify-content: space-between; gap: 8px }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 } .ind { padding-left: 12px } table { width: 100%; border-collapse: collapse }
    td, th { padding: 3px 4px; text-align: left; border-bottom: 1px solid #ddd } .n { text-align: right; font-variant-numeric: tabular-nums }
    h1 { font-size: 18px; margin: 0 } .stamp { border: 2px solid #000; padding: 4px; text-align: center; font-weight: 700; font-size: 16px; margin: 6px 0 }
  </style></head><body>${body}<script>window.onload=()=>setTimeout(()=>{window.print()},250)</script></body></html>`);
  w.document.close();
}

const row = (l: string, r: string, cls = "") => `<div class="r ${cls}"><span>${esc(l)}</span><span>${esc(r)}</span></div>`;

export function receiptHtml(o: PosOrder): string {
  const lines = o.items.map((i) => `<div>${row(`${i.quantity} x ${i.name}`, money(i.line_total))}${i.options.length ? `<div class="ind">${esc(i.options.map((x) => x.name).join(", "))}</div>` : ""}${i.promotion ? `<div class="ind">* ${esc(i.promotion)}</div>` : ""}</div>`).join("");
  const pays = o.payments.length
    ? o.payments.map((p) => row(p.method === "cash" ? "Cash" : `Card${p.card_last4 ? ` **${p.card_last4}` : ""}`, money(p.amount))
        + (p.method === "cash" && p.tendered && parseFloat(p.change) > 0 ? `<div class="ind">${esc(`Given ${money(p.tendered)} · change ${money(p.change)}`)}</div>` : "")).join("")
    : row("Paid by", o.payment_method_display || "Unpaid") + (o.cash_received ? row("Cash", money(o.cash_received)) + row("Change", money(o.change_given ?? 0)) : "");
  const promo = parseFloat(o.promo_discount ?? "0");
  return `
    <div class="c b" style="font-size:16px">${esc(SITE_NAME)}</div>
    ${o.branch_name ? `<div class="c">${esc(o.branch_name)}</div>` : ""}
    <div class="c">${esc(new Date(o.created_at).toLocaleString())}</div>
    <div class="c big">#${esc(o.short_number)}</div>
    <div class="c b">${esc(o.number)} · ${esc(o.fulfillment_display)}</div>
    ${o.partner ? `<div class="c b" style="font-size:14px">${esc(o.partner.name.toUpperCase())} #${esc(o.partner_ref)}</div>` : ""}
    ${o.customer_name ? `<div class="c">${esc(o.customer_name)}</div>` : ""}
    ${o.status === "refunded" ? `<div class="stamp">REFUNDED${o.refunded_at ? ` ${esc(new Date(o.refunded_at).toLocaleDateString())}` : ""}</div>` : ""}
    <hr>${lines}<hr>
    ${row("Subtotal", money(o.subtotal))}
    ${promo > 0 ? row("You saved (offers)", money(promo)) : ""}
    ${parseFloat(o.discount_amount) > 0 ? row(`Discount ${parseFloat(o.discount_percent)}%`, `-${money(o.discount_amount)}`) : ""}
    ${row("Tax", money(o.tax))}
    <div style="font-size:15px">${row("TOTAL", money(o.total), "b")}</div>
    ${parseFloat(o.tip ?? "0") > 0 ? row("Tip", money(o.tip)) + `<div style="font-size:15px">${row("PAID", money(parseFloat(o.total) + parseFloat(o.tip)), "b")}</div>` : ""}
    <hr>${pays}
    ${o.status === "refunded" ? `<hr>${row("Refunded", `-${money(o.total)}`, "b")}${o.refund_reason ? `<div>Reason: ${esc(o.refund_reason)}</div>` : ""}` : ""}
    ${o.notes ? `<div style="margin-top:6px">Note: ${esc(o.notes)}</div>` : ""}
    <hr><div class="c">Served by ${esc(o.created_by_name ?? "-")}</div><div class="c">Thank you!</div>`;
}

export function printReceipt(o: PosOrder) {
  openPrint(`Receipt ${o.number}`, receiptHtml(o));
}

export function printDayReport(date: string, branch: string | null, s: OrdersSummary, orders: PosOrder[], wide = false) {
  const day = new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const list = orders.map((o) => `<tr><td>${esc(o.number)}</td><td>${esc(new Date(o.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</td>
    <td>${esc(o.customer_name || "Walk-in")}</td><td>${esc(o.partner ? `${o.partner.name} #${o.partner_ref}` : o.payment_method_display || "—")}</td><td>${esc(o.status_display)}</td><td class="n">${money(o.total)}</td></tr>`).join("");
  const body = `
    <h1>${esc(SITE_NAME)} — Day report</h1>
    <div>${esc(day)}${branch ? ` · ${esc(branch)}` : ""} · printed ${esc(new Date().toLocaleString())}</div><hr>
    ${row("Orders", String(s.orders))}${row("Sales (incl. tax)", money(s.sales))}${row("Discounts & offers", money(s.discounts))}${row("Tax", money(s.tax))}
    ${row(`Refunds (${s.refunds.count})`, `-${money(s.refunds.total)}`)}
    <div style="font-size:15px">${row("NET", money(s.net), "b")}</div>
    ${parseFloat(s.tips ?? "0") > 0 ? row("Tips (not in sales; inside cash/card below)", money(s.tips)) : ""}<hr>
    ${s.by_method.map((m) => row(m.label, `${money(m.taken)}${parseFloat(m.refunded) ? ` − ${money(m.refunded)} = ${money(m.net)}` : ""}`)).join("")}
    ${s.by_app?.length ? `<hr>${s.by_app.map((a) => row(`${a.name} (${a.orders})`, money(a.sales))).join("")}` : ""}
    ${s.split_orders ? `<div>${s.split_orders} split payments (each part counted above)</div>` : ""}
    ${s.cancelled ? `<div>${s.cancelled} cancelled · ${s.unpaid} unpaid kiosk orders</div>` : ""}
    ${wide ? `<hr><table><tr><th>Order</th><th>Time</th><th>Customer</th><th>Payment</th><th>Status</th><th class="n">Total</th></tr>${list}</table>` : ""}`;
  openPrint(`Day report ${date}`, body, wide ? "letter" : "80mm");
}
