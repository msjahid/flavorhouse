"use client";

import { useState } from "react";
import { DatePicker, Select } from "@/components/Pickers";
import { Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, Stat, useBranchFilter, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { localDateISO } from "@/lib/pos";
import { openPrint } from "@/lib/printDocs";
import { manageApi, type TaxReport, type TaxRow } from "@/lib/manage";

const GROUPS: [string, string][] = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"]];
const STATUS = {
  open: { label: "Not filed", cls: "bg-flame/15 text-flame" },
  filed: { label: "Filed · not paid", cls: "bg-mustard/40 text-ink" },
  paid: { label: "✓ Filed & paid", cls: "bg-leaf/15 text-leaf" },
} as const;

function presets(): [string, string, string, string][] {
  const t = new Date(); const y = t.getFullYear(); const m = t.getMonth();
  const iso = (dd: Date) => localDateISO(dd);
  const q = Math.floor(m / 3);
  const lastQ = q === 0 ? [y - 1, 3] : [y, q - 1];
  return [
    ["this_month", "This month", iso(new Date(y, m, 1)), iso(t)],
    ["last_month", "Last month", iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
    ["this_quarter", "This quarter", iso(new Date(y, q * 3, 1)), iso(t)],
    ["last_quarter", "Last quarter", iso(new Date(lastQ[0], lastQ[1] * 3, 1)), iso(new Date(lastQ[0], lastQ[1] * 3 + 3, 0))],
    ["this_year", "This year", iso(new Date(y, 0, 1)), iso(t)],
    ["last_year", "Last year", iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))],
    ["custom", "Custom dates", "", ""],
  ];
}

export default function TaxPage() {
  const { user } = usePosAuth();
  const { branch, picker } = useBranchFilter();
  const P = presets();
  const [preset, setPreset] = useState("this_year");
  const [from, setFrom] = useState(P[4][2]);
  const [to, setTo] = useState(P[4][3]);
  const [group, setGroup] = useState("month");
  const [channel, setChannel] = useState("all");
  const { data, error, reload } = useLoad(() => manageApi.tax({ from, to, group, branch, channel }), [from, to, group, branch, channel]);
  const [editing, setEditing] = useState<TaxRow | null>(null);

  if ((user?.level ?? 0) < 4) return <Card><Empty>🔒 Sales tax reports are for super admins and the admin.</Empty></Card>;

  const choose = (k: string) => {
    setPreset(k);
    const p = P.find((x) => x[0] === k)!;
    if (k !== "custom") { setFrom(p[2]); setTo(p[3]); }
  };
  const t = data?.total;
  const storeName = branch ? user?.branches.find((b) => b.id === branch)?.name ?? "" : "All stores";

  return (
    <div>
      <PageHeader title="Sales tax" sub="Sales without tax, tax collected and sales with tax — by day, week, month, quarter or year — ready for your sales-tax return.">
        {data && <button className="btn-dark !py-2" onClick={() => printTax(data, storeName)}>📄 PDF / print report</button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {picker}
        <Select value={preset} onChange={choose} options={P.map(([k, l]) => ({ value: k, label: l, icon: "📅" }))} />
        {preset === "custom" && (
          <>
            <DatePicker value={from} max={to} onChange={setFrom} label="From" />
            <span className="text-sm text-ink-soft">to</span>
            <DatePicker value={to} min={from} max={localDateISO()} onChange={setTo} label="To" />
          </>
        )}
        <Select value={channel} onChange={setChannel} ariaLabel="Sales channel" options={[
          { value: "all", label: "All sales", icon: "🧾" }, { value: "store", label: "In store (counter + kiosk)", icon: "🏪" },
          { value: "online", label: "Online (website)", icon: "🌐" }, { value: "apps", label: "Delivery apps", icon: "🛵" }]} />
        <div className="flex rounded-xl bg-white p-1 ring-1 ring-ink/10">
          {GROUPS.map(([k, l]) => (
            <button key={k} onClick={() => setGroup(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${group === k ? "bg-ink text-cream" : "text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sales without tax" value={usd(t.net_without_tax)} tone="dark" sub="after refunds — your taxable sales" />
          <Stat label="Sales tax you pay" value={usd(t.net_tax)} tone="bad"
            sub={parseFloat(t.app_tax) ? `collected ${usd(t.tax_collected)} − paid by delivery apps ${usd(t.app_tax)}` : `collected ${usd(t.tax)} − refunded ${usd(t.refund_tax)}`} />
          <Stat label="Sales with tax" value={usd(t.net_with_tax)} sub={`${t.orders} orders · ${t.refunds} refunds`} />
          <Stat label="Tax rate" value={`${(parseFloat(data!.tax_rate) * 100).toFixed(2)}%`} sub="set by TAX_RATE on the server" />
        </div>
      )}
      <Card title={`${GROUPS.find((g) => g[0] === group)?.[1]} breakdown · ${d(from)} – ${d(to)}`}>
        {data?.rows.length === 0 ? <Empty>No sales in these dates.</Empty> : (
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b-2 border-ink/10 text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="px-3 py-2.5">Period</th><th className="px-3 text-right">Orders</th>
                <th className="px-3 text-right">Without tax</th><th className="px-3 text-right">Tax</th><th className="px-3 text-right">With tax</th>
                <th className="px-3 text-right">Refunds</th><th className="px-3 text-right" title="Tax on delivery-app orders — the app pays it">Apps pay</th>
                <th className="px-3 text-right">Net tax</th><th className="px-3">Filing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data?.rows.map((r) => {
                const st = STATUS[r.filing?.status ?? "open"];
                return (
                  <tr key={r.from} className="hover:bg-cream/60">
                    <td className="px-3 py-3 font-semibold">{r.label}</td>
                    <td className="px-3 text-right tabular-nums">{r.orders}</td>
                    <td className="px-3 text-right tabular-nums">{usd(r.without_tax)}</td>
                    <td className="px-3 text-right tabular-nums">{usd(r.tax)}</td>
                    <td className="px-3 text-right font-semibold tabular-nums">{usd(r.with_tax)}</td>
                    <td className="px-3 text-right tabular-nums text-flame">{parseFloat(r.refund_with_tax) ? `−${usd(r.refund_with_tax)}` : "—"}</td>
                    <td className="px-3 text-right tabular-nums text-ink-soft">{parseFloat(r.app_tax) ? `−${usd(r.app_tax)}` : "—"}</td>
                    <td className="px-3 text-right font-bold tabular-nums">{usd(r.net_tax)}</td>
                    <td className="px-3">
                      <button disabled={!data.can_edit_status && !r.filing} onClick={() => setEditing(r)}
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${st.cls} ${data.can_edit_status ? "hover:ring-2 hover:ring-ink/20" : ""}`}
                        title={data.can_edit_status ? "Update filing status" : "Only the admin updates this"}>{st.label}</button>
                      {r.filing?.confirmation && <span className="block text-[11px] text-ink-soft">#{r.filing.confirmation}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {t && (
              <tfoot>
                <tr className="border-t-2 border-ink/10 font-bold">
                  <td className="px-3 py-3">Total</td><td className="px-3 text-right tabular-nums">{t.orders}</td>
                  <td className="px-3 text-right tabular-nums">{usd(t.without_tax)}</td><td className="px-3 text-right tabular-nums">{usd(t.tax)}</td>
                  <td className="px-3 text-right tabular-nums">{usd(t.with_tax)}</td>
                  <td className="px-3 text-right tabular-nums text-flame">{parseFloat(t.refund_with_tax) ? `−${usd(t.refund_with_tax)}` : "—"}</td>
                  <td className="px-3 text-right tabular-nums text-ink-soft">{parseFloat(t.app_tax) ? `−${usd(t.app_tax)}` : "—"}</td>
                  <td className="px-3 text-right tabular-nums">{usd(t.net_tax)}</td><td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
        <p className="mt-3 text-xs text-ink-soft">
          A sale counts on the day it was made; a refund counts on the day it was refunded. “Without tax” = order total − tax (includes delivery fees).
          {" "}Delivery apps set as “collects the tax” (marketplace facilitators — Uber Eats, DoorDash, Grubhub in most states) pay the tax on their orders, so it&apos;s taken out of “Net tax”.
          {data?.can_edit_status ? " Click a status to record that the period was filed and paid." : " Only the admin updates filing status."}
        </p>
      </Card>
      {data && data.by_store.length > 1 && (
        <Card title="🏪 By store" className="mt-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
              <th className="py-2">Store</th><th className="text-right">Orders</th><th className="text-right">Without tax</th><th className="text-right">Net tax</th><th className="text-right">With tax</th></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {data.by_store.map((b) => (
                <tr key={b.name}><td className="py-2.5 font-semibold">{b.name}{b.state && <span className="text-ink-soft"> · {b.state}</span>}</td>
                  <td className="text-right tabular-nums">{b.orders}</td><td className="text-right tabular-nums">{usd(b.net_without_tax)}</td>
                  <td className="text-right font-bold tabular-nums">{usd(b.net_tax)}</td><td className="text-right tabular-nums">{usd(b.net_with_tax)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data && (
        <Card title="🧭 By sales channel" className="mt-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
              <th className="py-2">Channel</th><th className="text-right">Orders</th><th className="text-right">Without tax</th><th className="text-right">Tax</th>
              <th className="text-right">Apps pay</th><th className="text-right">Net tax</th><th className="text-right">With tax</th></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {data.by_channel.map((c) => (
                <tr key={c.key} className={`cursor-pointer hover:bg-cream/60 ${channel === c.key ? "bg-mustard/15" : ""}`} onClick={() => setChannel(channel === c.key ? "all" : c.key)}>
                  <td className="py-2.5 font-semibold">{c.label}</td><td className="text-right tabular-nums">{c.orders}</td>
                  <td className="text-right tabular-nums">{usd(c.net_without_tax)}</td><td className="text-right tabular-nums">{usd(c.tax_collected)}</td>
                  <td className="text-right tabular-nums text-ink-soft">{parseFloat(c.app_tax) ? `−${usd(c.app_tax)}` : "—"}</td>
                  <td className="text-right font-bold tabular-nums">{usd(c.net_tax)}</td><td className="text-right tabular-nums">{usd(c.net_with_tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-soft">Click a channel to show only it above. Delivery apps include the daily app sales entered on the Delivery apps page.</p>
        </Card>
      )}
      {data && (
        <Card title="🧾 Taxes you paid — vendors & utilities" className="mt-4">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Tax on vendor purchases" value={usd(data.paid.vendor_tax)} sub={`on ${usd(data.paid.vendor_spent)} of approved purchases`} />
            <Stat label="Tax & surcharges on bills" value={usd(data.paid.utility_tax)} sub={`on ${usd(data.paid.utility_spent)} of monthly bills`} />
            <Stat label="Total taxes you paid" value={usd(data.paid.total_tax)} tone="dark" sub="give this to your accountant" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PaidTable title="By vendor" rows={data.paid.vendors} empty="No approved purchases in these dates." />
            <PaidTable title="By bill (utilities…)" rows={data.paid.utilities} empty="No monthly bills in these dates." />
          </div>
          <p className="mt-3 text-xs text-ink-soft">Sales tax you pay on supplies and the taxes on utility bills are a business cost (they don&apos;t reduce the sales tax you collected). Check with your accountant.</p>
        </Card>
      )}
      {editing && data && (
        <FilingModal row={editing} branch={branch} canEdit={data.can_edit_status} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function PaidTable({ title, rows, empty }: { title: string; rows: { name: string; count: number; spent: string; tax: string }[]; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-soft">{title}</p>
      {rows.length === 0 ? <p className="rounded-xl bg-cream/60 p-3 text-sm text-ink-soft">{empty}</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-[11px] uppercase text-ink-soft"><th className="py-1.5" /><th className="text-right">Count</th><th className="text-right">Spent</th><th className="text-right">Tax</th></tr></thead>
          <tbody className="divide-y divide-ink/5">
            {rows.map((r) => <tr key={r.name}><td className="py-2 font-semibold">{r.name}</td><td className="text-right tabular-nums">{r.count}</td>
              <td className="text-right tabular-nums">{usd(r.spent)}</td><td className="text-right font-bold tabular-nums">{usd(r.tax)}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilingModal({ row, branch, canEdit, onClose, onSaved }: { row: TaxRow; branch: number | null; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const f0 = row.filing;
  const [f, setF] = useState({
    status: f0?.status ?? "open", amount_paid: f0?.amount_paid ?? row.net_tax, filed_on: f0?.filed_on ?? localDateISO(),
    paid_on: f0?.paid_on ?? localDateISO(), confirmation: f0?.confirmation ?? "", note: f0?.note ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await manageApi.saveTaxFiling({ ...f, branch, period_start: row.from, period_end: row.to,
        filed_on: f.status === "open" ? null : f.filed_on, paid_on: f.status === "paid" ? f.paid_on : null });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Modal title={`Sales tax · ${row.label}`} onClose={onClose}>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[["Without tax", row.net_without_tax], ["Tax to report", row.net_tax], ["With tax", row.net_with_tax]].map(([l, v]) => (
          <div key={l} className="rounded-2xl bg-white p-3 ring-1 ring-ink/5"><p className="text-[11px] font-bold uppercase text-ink-soft">{l}</p><p className="font-display text-lg font-extrabold">{usd(v)}</p></div>
        ))}
      </div>
      <fieldset disabled={!canEdit} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(["open", "filed", "paid"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setF({ ...f, status: k })}
              className={`rounded-2xl px-2 py-3 text-sm font-bold ring-2 ${f.status === k ? "bg-cream ring-flame" : "bg-white ring-ink/10"}`}>{STATUS[k].label}</button>
          ))}
        </div>
        {f.status !== "open" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Filed on"><DatePicker value={f.filed_on} max={localDateISO()} onChange={(v) => setF({ ...f, filed_on: v })} className="w-full" /></Field>
            {f.status === "paid" && <Field label="Paid on"><DatePicker value={f.paid_on} max={localDateISO()} onChange={(v) => setF({ ...f, paid_on: v })} className="w-full" /></Field>}
            <Field label="Amount paid ($)"><input className="input !py-2" type="number" step="0.01" min="0" value={f.amount_paid} onChange={(e) => setF({ ...f, amount_paid: e.target.value })} /></Field>
            <Field label="Confirmation #"><input className="input !py-2" value={f.confirmation} onChange={(e) => setF({ ...f, confirmation: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Note"><input className="input !py-2" placeholder="e.g. Filed on the state comptroller website" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </fieldset>
      {f0?.updated_by_name && <p className="mt-2 text-xs text-ink-soft">Last updated by {f0.updated_by_name} · {dt(f0.updated_at)}</p>}
      <ErrorBox error={err} />
      {canEdit ? <button className="btn-primary mt-4 w-full" onClick={save}>Save status</button>
        : <p className="mt-4 text-sm text-ink-soft">Only the admin updates filing status.</p>}
    </Modal>
  );
}

function printTax(r: TaxReport, store: string) {
  const m = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = r.rows.map((x) => `<tr><td>${x.label}</td><td class="n">${x.orders}</td><td class="n">${m(x.without_tax)}</td><td class="n">${m(x.tax)}</td>
    <td class="n">${m(x.with_tax)}</td><td class="n">${parseFloat(x.refund_with_tax) ? "-" + m(x.refund_with_tax) : "—"}</td><td class="n">${m(x.net_without_tax)}</td>
    <td class="n">${parseFloat(x.app_tax) ? "-" + m(x.app_tax) : "—"}</td><td class="n b">${m(x.net_tax)}</td><td>${x.filing ? x.filing.status_display + (x.filing.confirmation ? " #" + x.filing.confirmation : "") : "Not filed"}</td></tr>`).join("");
  const t = r.total;
  const stores = r.by_store.length > 1 ? `<h2 style="font-size:14px;margin-top:18px">By store</h2><table><tr><th>Store</th><th class="n">Orders</th><th class="n">Taxable sales</th><th class="n">Net tax</th><th class="n">With tax</th></tr>
    ${r.by_store.map((b) => `<tr><td>${b.name}${b.state ? " (" + b.state + ")" : ""}</td><td class="n">${b.orders}</td><td class="n">${m(b.net_without_tax)}</td><td class="n b">${m(b.net_tax)}</td><td class="n">${m(b.net_with_tax)}</td></tr>`).join("")}</table>` : "";
  openPrint(`Sales tax ${r.from} to ${r.to}`, `
    <h1>${SITE_NAME} — Sales tax report</h1>
    <p>${store} · ${({ all: "all sales", store: "in store", online: "online (website)", apps: "delivery apps" } as Record<string, string>)[r.channel] ?? "all sales"} · ${r.from} to ${r.to} · ${r.group}ly · tax rate ${(parseFloat(r.tax_rate) * 100).toFixed(2)}% · printed ${new Date().toLocaleString()}</p>
    <table style="margin:10px 0 14px"><tr><td class="b">Gross sales (with tax)</td><td class="n">${m(t.with_tax)}</td></tr>
      <tr><td>Sales tax collected</td><td class="n">${m(t.tax)}</td></tr>
      <tr><td>Sales without tax</td><td class="n">${m(t.without_tax)}</td></tr>
      <tr><td>Refunds (${t.refunds}) incl. tax</td><td class="n">-${m(t.refund_with_tax)}</td></tr>
      <tr><td>Tax refunded to customers</td><td class="n">-${m(t.refund_tax)}</td></tr>
      <tr><td class="b">Taxable sales (net of refunds)</td><td class="n b">${m(t.net_without_tax)}</td></tr>
      ${parseFloat(t.app_tax) ? `<tr><td>Delivery-app sales (marketplace facilitator, incl. tax)</td><td class="n">${m(t.app_with_tax)}</td></tr>
      <tr><td>Tax collected &amp; paid by delivery apps</td><td class="n">-${m(t.app_tax)}</td></tr>` : ""}
      <tr><td class="b">Sales tax you report &amp; pay</td><td class="n b">${m(t.net_tax)}</td></tr>
      <tr><td>Discounts & offers given</td><td class="n">${m(t.discounts)}</td></tr>
      <tr><td>Delivery fees (included above)</td><td class="n">${m(t.fees)}</td></tr></table>
    <table><tr><th>Period</th><th class="n">Orders</th><th class="n">Without tax</th><th class="n">Tax</th><th class="n">With tax</th><th class="n">Refunds</th><th class="n">Taxable net</th><th class="n">Apps pay</th><th class="n">Net tax</th><th>Filing</th></tr>
    ${rows}<tr class="b"><td>Total</td><td class="n">${t.orders}</td><td class="n">${m(t.without_tax)}</td><td class="n">${m(t.tax)}</td><td class="n">${m(t.with_tax)}</td>
    <td class="n">-${m(t.refund_with_tax)}</td><td class="n">${m(t.net_without_tax)}</td><td class="n">${parseFloat(t.app_tax) ? "-" + m(t.app_tax) : "—"}</td><td class="n">${m(t.net_tax)}</td><td></td></tr></table>
    ${stores}
    <h2 style="font-size:14px;margin-top:18px">By sales channel</h2><table><tr><th>Channel</th><th class="n">Orders</th><th class="n">Taxable sales</th><th class="n">Tax</th><th class="n">Apps pay</th><th class="n">Net tax</th></tr>
    ${r.by_channel.map((c) => `<tr><td>${c.label}</td><td class="n">${c.orders}</td><td class="n">${m(c.net_without_tax)}</td><td class="n">${m(c.tax_collected)}</td><td class="n">${m(c.app_tax)}</td><td class="n b">${m(c.net_tax)}</td></tr>`).join("")}</table>
    <h2 style="font-size:14px;margin-top:18px">Taxes you paid</h2><table>
    <tr><td>Tax on vendor purchases</td><td class="n">${m(r.paid.vendor_tax)}</td></tr><tr><td>Taxes & surcharges on monthly bills</td><td class="n">${m(r.paid.utility_tax)}</td></tr>
    <tr class="b"><td>Total</td><td class="n">${m(r.paid.total_tax)}</td></tr></table>
    <table style="margin-top:6px"><tr><th>Vendor / bill</th><th class="n">Count</th><th class="n">Spent</th><th class="n">Tax</th></tr>
    ${[...r.paid.vendors, ...r.paid.utilities].map((x) => `<tr><td>${x.name}</td><td class="n">${x.count}</td><td class="n">${m(x.spent)}</td><td class="n">${m(x.tax)}</td></tr>`).join("")}</table>
    <p style="margin-top:14px;font-size:10px">Sales count on the day they were made; refunds on the day they were refunded. Figures come from the point of sale, kiosk and website orders. Check with your accountant before filing.</p>`, "letter");
}
