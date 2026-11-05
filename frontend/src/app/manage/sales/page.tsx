"use client";

import { useState } from "react";
import { Select } from "@/components/Pickers";
import { Card, Empty, ErrorBox, PageHeader, PeriodPicker, Stat, useBranchFilter, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { openPrint } from "@/lib/printDocs";
import { manageApi, type StaffSales } from "@/lib/manage";

const ROLES = [["", "All roles"], ["employee", "Employees"], ["manager", "Managers"], ["supervisor", "Supervisors"], ["superadmin", "Super admins"], ["admin", "Admin"]];
const PAYMENTS = [["", "Any payment"], ["cash", "Cash"], ["card", "Card"], ["split", "Split"], ["stripe", "Online (Stripe)"]];
const CHANNELS = [["", "All channels"], ["pos", "Counter"], ["kiosk", "Kiosk"], ["online", "Website"]];

/** Every sale with who rang it up and any discount — and totals per employee and per role. */
export default function SalesByEmployeePage() {
  const { user } = usePosAuth();
  const { branch, picker } = useBranchFilter();
  const period = usePeriod("month");
  const [seller, setSeller] = useState("");
  const [role, setRole] = useState("");
  const [payment, setPayment] = useState("");
  const [channel, setChannel] = useState("");
  const [only, setOnly] = useState<"" | "discounted" | "refunded">("");
  const { data, error } = useLoad(() => manageApi.staffSales({
    ...period.params, branch, seller, role, payment, channel, ...(only ? { [only]: 1 } : {}),
  }), [period.key, branch, seller, role, payment, channel, only]);
  const [show, setShow] = useState(50);

  if ((user?.level ?? 0) < 2) return <Card><Empty>🔒 For managers and above.</Empty></Card>;
  const t = data?.total;
  const top = Math.max(1, ...(data?.by_employee ?? []).map((x) => parseFloat(x.sales)));

  return (
    <div>
      <PageHeader title="Sales by employee" sub="Every transaction with who sold it and any discount — who sells the most, which role gives the most discounts, and refunds per person.">
        {data && <button className="btn-ghost !py-2" onClick={() => printReport(data)}>📄 PDF / print</button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {picker}
        <PeriodPicker value={period.value} onChange={period.setValue} />
        <Select value={seller} onChange={setSeller} options={[{ value: "", label: "Everyone", icon: "👥" }, ...(data?.sellers ?? []).map((s) => ({ ...s, icon: s.value === "web" ? "🌐" : "🧑" }))]} />
        <Select value={role} onChange={setRole} options={ROLES.map(([value, label]) => ({ value, label, icon: "🎖" }))} />
        <Select value={payment} onChange={setPayment} options={PAYMENTS.map(([value, label]) => ({ value, label, icon: "💳" }))} />
        <Select value={channel} onChange={setChannel} options={CHANNELS.map(([value, label]) => ({ value, label, icon: "🧾" }))} />
        <div className="flex rounded-xl bg-white p-1 ring-1 ring-ink/10">
          {([["", "All"], ["discounted", "With discount"], ["refunded", "Refunded"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setOnly(k)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${only === k ? "bg-ink text-cream" : "text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />

      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sales" value={usd(t.sales)} tone="dark" sub={`${t.orders} transactions · tax ${usd(t.tax)}`} />
          <Stat label="Discounts given" value={`−${usd(t.discount_amount)}`} tone="bad" sub={`${t.discounts} orders · offers −${usd(t.offers_amount)}`} />
          <Stat label="Refunds" value={`−${usd(t.refund_amount)}`} tone={t.refunds ? "bad" : "good"} sub={`${t.refunds} orders`} />
          <Stat label="Average sale" value={usd(t.orders ? parseFloat(t.sales) / t.orders : 0)} sub="per transaction" />
        </div>
      )}

      <div className="mb-4 grid gap-4 2xl:grid-cols-[1.5fr_1fr]">
        <Card title="🏆 By employee">
          {data?.by_employee.length === 0 ? <Empty>No sales.</Empty> : (
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b-2 border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-2">#</th><th>Employee</th><th className="text-right">Orders</th><th className="w-40 pl-3">Sales</th>
                <th className="text-right">Avg</th><th className="text-right">Discounts</th><th className="text-right">Refunds</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data?.by_employee.map((x, i) => (
                  <tr key={String(x.id)} className="cursor-pointer hover:bg-cream/60" onClick={() => setSeller(String(x.id))} title="Show only this person's sales">
                    <td className="py-2.5 font-bold text-ink-soft">{i + 1}</td>
                    <td><b>{x.name}</b><span className="block text-xs text-ink-soft">{x.employee_id && `${x.employee_id} · `}{x.role_display}</span></td>
                    <td className="text-right tabular-nums">{x.orders}</td>
                    <td className="pl-3">
                      <span className="block font-bold tabular-nums">{usd(x.sales)}</span>
                      <span className="mt-1 block h-1.5 rounded-full bg-flame" style={{ width: `${Math.max(3, parseFloat(x.sales) / top * 100)}%` }} />
                    </td>
                    <td className="text-right tabular-nums">{usd(x.average)}</td>
                    <td className="text-right tabular-nums">{x.discounts ? <><b className="text-flame">−{usd(x.discount_amount)}</b><span className="block text-xs text-ink-soft">{x.discounts} orders</span></> : "—"}
                      {x.discounts_approved ? <span className="block text-[11px] text-ink-soft">approved {x.discounts_approved} (−{usd(x.discounts_approved_amount ?? 0)})</span> : null}</td>
                    <td className="text-right tabular-nums">{x.refunds ? <><b className="text-purple-700">−{usd(x.refund_amount)}</b><span className="block text-xs text-ink-soft">{x.refunds} on their sales</span></> : "—"}
                      {x.refunds_approved ? <span className="block text-[11px] text-ink-soft">approved {x.refunds_approved}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="🎖 By role">
          {data?.by_role.length === 0 ? <Empty>No sales.</Empty> : (
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="border-b-2 border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-2">Role</th><th className="text-right">Sales</th><th className="text-right">Discounts</th><th className="text-right">Disc. %</th><th className="text-right">Refunds</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data?.by_role.map((r) => (
                  <tr key={r.role} className="cursor-pointer hover:bg-cream/60" onClick={() => r.role !== "online" && setRole(r.role)}>
                    <td className="py-2.5"><b>{r.label}</b><span className="block text-xs text-ink-soft">{r.people} people · {r.orders} orders</span></td>
                    <td className="text-right font-bold tabular-nums">{usd(r.sales)}</td>
                    <td className="text-right tabular-nums">{r.discounts ? <>−{usd(r.discount_amount)}<span className="block text-xs text-ink-soft">{r.discounts} orders</span></> : "—"}</td>
                    <td className={`text-right font-bold tabular-nums ${parseFloat(r.discount_rate) >= 5 ? "text-flame" : ""}`}>{r.discount_rate}%</td>
                    <td className="text-right tabular-nums">{r.refunds ? <>−{usd(r.refund_amount)}<span className="block text-xs text-ink-soft">{r.refunds}</span></> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-ink-soft">Disc. % = discounts given ÷ sales. Click a role or a person to filter the transactions.</p>
        </Card>
      </div>

      <Card title={`🧾 Transactions${data ? ` (${data.rows.length}${data.rows_capped ? "+" : ""})` : ""}`}>
        {data?.rows.length === 0 ? <Empty>No transactions match.</Empty> : (
          <>
            <table className="w-full min-w-[1080px] text-sm">
              <thead><tr className="border-b-2 border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-2">When</th><th>Order</th><th>Sold by</th><th>Channel · payment</th><th className="text-right">Subtotal</th>
                <th className="text-right">Discount</th><th className="text-right">Tax</th><th className="text-right">Total</th><th className="pl-4">Status</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data?.rows.slice(0, show).map((r) => (
                  <tr key={r.id} className={`hover:bg-cream/60 ${r.status === "refunded" ? "bg-purple-50/50" : ""}`}>
                    <td className="py-2 tabular-nums">{new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td><b>{r.number}</b><span className="block text-xs text-ink-soft">{r.branch_name}{r.customer && ` · ${r.customer}`}</span></td>
                    <td><b>{r.seller}</b><span className="block text-xs text-ink-soft">{r.employee_id && `${r.employee_id} · `}{r.role_display}</span></td>
                    <td>{r.source_display}<span className="block text-xs text-ink-soft">{r.payment_display}</span></td>
                    <td className="text-right tabular-nums">{usd(r.subtotal)}</td>
                    <td className="text-right tabular-nums">
                      {parseFloat(r.discount_amount) > 0 ? <><b className="text-flame">−{usd(r.discount_amount)}</b>
                        <span className="block text-[11px] text-ink-soft">{parseFloat(r.discount_percent)}% · {r.discount_reason}{r.discount_approved_by && ` · ok ${r.discount_approved_by}`}</span></> : null}
                      {parseFloat(r.offers) > 0 && <span className="block text-[11px] text-leaf">offer −{usd(r.offers)}</span>}
                      {!(parseFloat(r.discount_amount) > 0) && !(parseFloat(r.offers) > 0) && <span className="text-ink-soft">—</span>}
                    </td>
                    <td className="text-right tabular-nums">{usd(r.tax)}</td>
                    <td className="text-right font-bold tabular-nums">{usd(r.total)}{parseFloat(r.tip) > 0 && <span className="block text-[11px] font-normal text-leaf">+ {usd(r.tip)} tip</span>}</td>
                    <td className="pl-4 text-xs">{r.status === "refunded" ? <span className="font-bold text-purple-700">Refunded{r.refunded_by && ` by ${r.refunded_by}`}</span> : r.status_display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.rows.length > show && <button className="btn-ghost mt-3 !py-2 text-sm" onClick={() => setShow(show + 100)}>Show more ({data.rows.length - show} left)</button>}
          </>
        )}
      </Card>
    </div>
  );
}

function printReport(r: StaffSales) {
  const m = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const people = r.by_employee.map((x, i) => `<tr><td>${i + 1}</td><td>${x.name} ${x.employee_id ? "(" + x.employee_id + ")" : ""}</td><td>${x.role_display}</td>
    <td class="n">${x.orders}</td><td class="n b">${m(x.sales)}</td><td class="n">${x.discounts} / -${m(x.discount_amount)}</td><td class="n">${x.refunds} / -${m(x.refund_amount)}</td></tr>`).join("");
  const roles = r.by_role.map((x) => `<tr><td>${x.label}</td><td class="n">${x.orders}</td><td class="n">${m(x.sales)}</td><td class="n">-${m(x.discount_amount)}</td><td class="n">${x.discount_rate}%</td><td class="n">-${m(x.refund_amount)}</td></tr>`).join("");
  const rows = r.rows.map((x) => `<tr><td>${new Date(x.created_at).toLocaleString()}</td><td>${x.number}</td><td>${x.seller} ${x.employee_id}</td><td>${x.payment_display}</td>
    <td class="n">${m(x.subtotal)}</td><td class="n">${parseFloat(x.discount_amount) ? "-" + m(x.discount_amount) : ""}</td><td class="n">${m(x.total)}</td><td>${x.status_display}</td></tr>`).join("");
  const t = r.total;
  openPrint(`Sales by employee ${r.from} to ${r.to}`, `
    <h1>${SITE_NAME} — Sales by employee</h1><p>${r.from} to ${r.to} · printed ${new Date().toLocaleString()}</p>
    <p>Sales ${m(t.sales)} (${t.orders}) · discounts -${m(t.discount_amount)} (${t.discounts}) · refunds -${m(t.refund_amount)} (${t.refunds})</p>
    <table><tr><th>#</th><th>Employee</th><th>Role</th><th class="n">Orders</th><th class="n">Sales</th><th class="n">Discounts</th><th class="n">Refunds</th></tr>${people}</table>
    <h2 style="font-size:14px;margin-top:14px">By role</h2>
    <table><tr><th>Role</th><th class="n">Orders</th><th class="n">Sales</th><th class="n">Discounts</th><th class="n">Disc. %</th><th class="n">Refunds</th></tr>${roles}</table>
    <h2 style="font-size:14px;margin-top:14px">Transactions</h2>
    <table><tr><th>When</th><th>Order</th><th>Sold by</th><th>Payment</th><th class="n">Subtotal</th><th class="n">Discount</th><th class="n">Total</th><th>Status</th></tr>${rows}</table>`, "letter");
}
