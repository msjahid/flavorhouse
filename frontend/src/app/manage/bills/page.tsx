"use client";

import { useState } from "react";
import { DatePicker, Select } from "@/components/Pickers";
import { Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, Stat, useBranchFilter, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { localDateISO } from "@/lib/pos";
import { openPrint } from "@/lib/printDocs";
import { changeMessage, manageApi, type Bill, type BillsData } from "@/lib/manage";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ICON: Record<string, string> = {
  electric: "⚡", gas: "🔥", water: "💧", trash: "🗑", internet: "🌐", phone: "📞", rent: "🏢", insurance: "🛡",
  pest: "🐜", grease: "🛢", security: "🚨", card_fees: "💳", software: "💻", music: "🎵", linen: "👕", other: "📄",
};
const ROLE = ["", "Employee", "Manager", "Supervisor", "Super admin", "Admin"];
const monthLabel = (iso: string) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });

export default function BillsPage() {
  const { user } = usePosAuth();
  const { branch, picker } = useBranchFilter();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, reload } = useLoad(() => manageApi.bills({ year, branch, category, status }), [year, branch, category, status]);
  const [editing, setEditing] = useState<Bill | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState(30);
  const level = user?.level ?? 0;
  const canEdit = (b: Bill) => level >= 5 || (level >= 3 && level > b.submitted_level);

  if (level < 2) return <Card><Empty>🔒 Monthly bills are for managers and above.</Empty></Card>;

  return (
    <div>
      <PageHeader title="Monthly bills"
        sub="Electricity, gas, water, trash, internet, rent… every month, with history. Managers add bills (approved one role up); only a higher role than whoever added a bill can edit it — also approved one role up.">
        <div className="flex flex-wrap gap-2">
          {data && <button className="btn-ghost !py-2" onClick={() => printBills(data, branch ? user?.branches.find((b) => b.id === branch)?.name ?? "" : "All stores")}>📄 PDF / print</button>}
          <button className="btn-primary !py-2" onClick={() => setEditing("new")}>+ Add a bill</button>
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {picker}
        <Select value={String(year)} onChange={(v) => setYear(Number(v))}
          options={[0, 1, 2, 3].map((k) => ({ value: String(thisYear - k), label: String(thisYear - k), icon: "📅" }))} />
        <Select value={category} onChange={setCategory}
          options={[{ value: "", label: "All bills", icon: "🧾" }, ...(data?.category_choices ?? []).map((c) => ({ ...c, icon: ICON[c.value] }))]} />
        <Select value={status} onChange={setStatus}
          options={[{ value: "", label: "Paid & unpaid", icon: "•" }, { value: "unpaid", label: "Unpaid only", icon: "⏳" }, { value: "paid", label: "Paid only", icon: "✅" }]} />
      </div>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{msg}</p>}

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`Bills in ${data.year}`} value={usd(data.total)} tone="dark" sub={`${data.items.length} bills`} />
          <Stat label="This month" value={usd(data.this_month)} sub={new Date().toLocaleDateString([], { month: "long" })} />
          <Stat label="Unpaid" value={usd(data.unpaid.total)} tone={data.unpaid.count ? "bad" : "good"} sub={`${data.unpaid.count} bills`} />
          <Stat label="Taxes & fees on bills" value={usd(data.tax)} sub="also shown in Sales tax → taxes you paid" />
        </div>
      )}

      {data && data.waiting.length > 0 && (
        <Card title={`⏳ Waiting for approval (${data.waiting.length})`} className="mb-4">
          <ul className="divide-y divide-ink/5 text-sm">
            {data.waiting.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><b>{c.summary}</b><span className="block text-xs text-ink-soft">by {c.submitted_by_name} · {dt(c.created_at)}{c.reason && ` · “${c.reason}”`}</span></span>
                <span className="rounded-full bg-mustard/30 px-3 py-1 text-xs font-bold">Needs {c.need_role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Approve or reject in <b>Approvals</b>.</p>
        </Card>
      )}

      {/* Month-by-month history */}
      {data && data.categories.length > 0 && (
        <Card title={`📊 ${data.year} month by month`} className="mb-4">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b-2 border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-2">Bill</th>{MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">Year</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data.categories.map((c) => (
                <tr key={c.key} className="hover:bg-cream/60">
                  <td className="py-2 font-semibold">{ICON[c.key]} {c.label}</td>
                  {MONTHS.map((_, i) => {
                    const v = c.by_month[String(i + 1)];
                    return <td key={i} className={`text-right tabular-nums ${v ? "" : "text-ink-soft/40"}`}>{v ? usd(v) : "—"}</td>;
                  })}
                  <td className="text-right font-bold tabular-nums">{usd(c.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink/10 font-bold">
                <td className="py-2">Total</td>
                {data.months.map((m) => <td key={m.month} className="text-right tabular-nums">{parseFloat(m.total) ? usd(m.total) : "—"}</td>)}
                <td className="text-right tabular-nums">{usd(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <Card title="🧾 All bills">
        {data?.items.length === 0 ? <Empty>No bills{category || status ? " match" : ` in ${year}`} yet. Press “+ Add a bill”.</Empty> : (
          <>
            {/* Phones */}
            <ul className="divide-y divide-ink/5 md:hidden">
              {data?.items.slice(0, show).map((b) => (
                <li key={b.id} className="flex items-start gap-3 py-3">
                  <span className="text-2xl">{ICON[b.category]}</span>
                  <span className="min-w-0 flex-1">
                    <b>{b.category_display}</b> · {b.provider}
                    <span className="block text-xs text-ink-soft">{monthLabel(b.bill_month)} · {b.branch_name ?? "All stores"}{b.due_date && ` · due ${d(b.due_date)}`}</span>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${b.is_paid ? "bg-leaf/15 text-leaf" : "bg-flame/15 text-flame"}`}>{b.is_paid ? `Paid ${b.paid_on ? d(b.paid_on) : ""}` : "Unpaid"}</span>
                  </span>
                  <span className="text-right"><b className="tabular-nums">{usd(b.total)}</b>
                    {canEdit(b) && <button className="block text-xs font-semibold text-flame" onClick={() => setEditing(b)}>Edit</button>}</span>
                </li>
              ))}
            </ul>
            <table className="hidden w-full text-sm md:table">
              <thead><tr className="border-b border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="py-2">Month</th><th>Bill</th><th>Store</th><th className="text-right">Amount</th><th className="text-right">Tax</th>
                <th className="text-right">Total</th><th className="pl-4">Due / paid</th><th>Added by</th><th /></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data?.items.slice(0, show).map((b) => (
                  <tr key={b.id} className="hover:bg-cream/60">
                    <td className="py-2.5 font-semibold">{monthLabel(b.bill_month)}</td>
                    <td>{ICON[b.category]} {b.category_display}<span className="block text-xs text-ink-soft">{b.provider}{b.account_number && ` · acct ${b.account_number}`}{b.usage && ` · ${b.usage}`}</span></td>
                    <td>{b.branch_name ?? "All stores"}</td>
                    <td className="text-right tabular-nums">{usd(b.amount)}</td>
                    <td className="text-right tabular-nums text-ink-soft">{parseFloat(b.tax) ? usd(b.tax) : "—"}</td>
                    <td className="text-right font-bold tabular-nums">{usd(b.total)}</td>
                    <td className="pl-4">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${b.is_paid ? "bg-leaf/15 text-leaf" : "bg-flame/15 text-flame"}`}>{b.is_paid ? "Paid" : "Unpaid"}</span>
                      <span className="block text-xs text-ink-soft">{b.is_paid ? `${b.paid_on ? d(b.paid_on) : ""} · ${b.paid_with_display}${b.reference ? ` #${b.reference}` : ""}` : b.due_date ? `due ${d(b.due_date)}` : ""}</span>
                    </td>
                    <td className="text-xs">{b.submitted_by_name}<span className="block text-ink-soft">✓ {b.approved_by_name}</span>
                      {b.file_url && <a className="underline" href={b.file_url} target="_blank" rel="noreferrer">bill copy</a>}</td>
                    <td className="text-right">{canEdit(b) && <button className="rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setEditing(b)}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.items.length > show && (
              <button className="btn-ghost mt-3 !py-2 text-sm" onClick={() => setShow(show + 60)}>Show more ({data.items.length - show} older)</button>
            )}
          </>
        )}
      </Card>

      {editing && data && (
        <BillModal bill={editing === "new" ? null : editing} data={data} defaultBranch={branch ?? user?.branch?.id ?? null}
          onClose={() => setEditing(null)} onSent={(m) => { setEditing(null); setMsg(m); reload(); }} />
      )}
    </div>
  );
}

function BillModal({ bill, data, defaultBranch, onClose, onSent }: {
  bill: Bill | null; data: BillsData; defaultBranch: number | null; onClose: () => void; onSent: (m: string) => void;
}) {
  const { user } = usePosAuth();
  const thisMonth = localDateISO().slice(0, 7) + "-01";
  const [f, setF] = useState({
    branch: String(bill ? bill.branch ?? "" : defaultBranch ?? ""), category: bill?.category ?? "electric", provider: bill?.provider ?? "",
    account_number: bill?.account_number ?? "", bill_month: bill?.bill_month ?? thisMonth, due_date: bill?.due_date ?? "",
    amount: bill?.amount ?? "", tax: bill?.tax ?? "0", usage: bill?.usage ?? "", is_paid: bill?.is_paid ?? false,
    paid_on: bill?.paid_on ?? localDateISO(), paid_with: bill?.paid_with || "autopay", reference: bill?.reference ?? "", note: bill?.note ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const level = user?.level ?? 0;
  const multi = (user?.branches.length ?? 0) > 1 && level >= 3;
  const total = (parseFloat(f.amount) || 0) + (parseFloat(f.tax) || 0);

  const save = async () => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => {
      if (k === "paid_on" && !f.is_paid) return;
      if (k === "paid_with" && !f.is_paid) return;
      fd.append(k, String(v));
    });
    if (file) fd.append("file", file);
    if (bill) fd.append("change_reason", reason);
    try { onSent(changeMessage(bill ? await manageApi.editBill(bill.id, fd) : await manageApi.addBill(fd))); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  const next = level >= 5 ? null : ROLE[level + 1];
  return (
    <Modal title={bill ? "Edit bill" : "Add a monthly bill"} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {data.category_choices.map((c) => (
          <button key={c.value} type="button" onClick={() => set({ category: c.value })}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition ${f.category === c.value ? "bg-ink text-cream ring-ink" : "bg-white ring-ink/10 hover:ring-ink"}`}>
            {ICON[c.value]} {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="From (company)"><input className="input !py-2" placeholder="e.g. Con Edison, Waste Management, Spectrum" value={f.provider} onChange={(e) => set({ provider: e.target.value })} /></Field>
        <Field label="Store">
          {multi ? (
            <Select className="w-full" value={f.branch} onChange={(v) => set({ branch: v })}
              options={[{ value: "", label: "Whole company / head office", icon: "🏢" }, ...user!.branches.map((b) => ({ value: String(b.id), label: b.name, icon: "🏪" }))]} />
          ) : <p className="rounded-xl bg-white px-3 py-2 ring-1 ring-ink/10">🏪 {user?.branch?.name ?? "—"}</p>}
        </Field>
        <Field label="Bill for the month">
          <input type="month" className="input !py-2" value={f.bill_month.slice(0, 7)} onChange={(e) => set({ bill_month: `${e.target.value}-01` })} /></Field>
        <Field label="Due date"><DatePicker value={f.due_date} onChange={(v) => set({ due_date: v })} className="w-full" /></Field>
        <Field label="Amount before tax ($)"><input className="input !py-2" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Taxes & surcharges on the bill ($)" hint="Utility / sales tax, MTA or city surcharges…">
          <input className="input !py-2" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set({ tax: e.target.value })} /></Field>
        <Field label="Account # (optional)"><input className="input !py-2" value={f.account_number} onChange={(e) => set({ account_number: e.target.value })} /></Field>
        <Field label="Usage (optional)"><input className="input !py-2" placeholder="e.g. 2,340 kWh" value={f.usage} onChange={(e) => set({ usage: e.target.value })} /></Field>
      </div>
      <button type="button" onClick={() => set({ is_paid: !f.is_paid })} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-ink/10">
        <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${f.is_paid ? "bg-leaf" : "bg-ink/20"}`}>
          <span className={`h-5 w-5 rounded-full bg-white shadow transition ${f.is_paid ? "translate-x-5" : ""}`} /></span>
        <span className="text-sm font-semibold">{f.is_paid ? "Paid" : "Not paid yet"}</span>
      </button>
      {f.is_paid && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Paid on"><DatePicker value={f.paid_on} max={localDateISO()} onChange={(v) => set({ paid_on: v })} className="w-full" /></Field>
          <Field label="Paid with"><Select className="w-full" value={f.paid_with} onChange={(v) => set({ paid_with: v })} options={data.paid_with_choices} /></Field>
          <Field label="Check # / confirmation"><input className="input !py-2" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Copy of the bill (photo / PDF)"><input type="file" accept="image/*,application/pdf" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Note"><input className="input !py-2" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
      {bill && <Field label="Why are you changing it? (required)"><input className="input !py-2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-cream">
        <span className="text-sm text-cream/70">Total</span><b className="font-display text-2xl tabular-nums">{usd(total)}</b>
      </div>
      <ErrorBox error={err} />
      <button className="btn-primary mt-4 w-full" onClick={save} disabled={busy || !f.provider.trim() || !(parseFloat(f.amount) > 0) || (!!bill && !reason.trim())}>
        {busy ? "Saving…" : next ? `Send to ${next} for approval` : bill ? "Save changes" : "Save bill"}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft">{next ? `It's added once a ${next.toLowerCase()} approves it.` : "As admin, it's saved right away."}</p>
    </Modal>
  );
}

function printBills(r: BillsData, store: string) {
  const m = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const head = `<tr><th>Bill</th>${MONTHS.map((x) => `<th class="n">${x}</th>`).join("")}<th class="n">Year</th></tr>`;
  const rows = r.categories.map((c) => `<tr><td>${c.label}</td>${MONTHS.map((_, i) => `<td class="n">${c.by_month[String(i + 1)] ? m(c.by_month[String(i + 1)]) : "—"}</td>`).join("")}<td class="n b">${m(c.total)}</td></tr>`).join("");
  const list = r.items.map((b) => `<tr><td>${b.bill_month.slice(0, 7)}</td><td>${b.category_display}</td><td>${b.provider}</td><td>${b.branch_name ?? "All"}</td>
    <td class="n">${m(b.amount)}</td><td class="n">${m(b.tax)}</td><td class="n b">${m(b.total)}</td><td>${b.is_paid ? `Paid ${b.paid_on ?? ""}` : "Unpaid"}</td></tr>`).join("");
  openPrint(`Bills ${r.year}`, `
    <h1>${SITE_NAME} — Monthly bills ${r.year}</h1><p>${store} · printed ${new Date().toLocaleString()}</p>
    <p>Total ${m(r.total)} · taxes & surcharges ${m(r.tax)} · unpaid ${m(r.unpaid.total)} (${r.unpaid.count})</p>
    <table>${head}${rows}<tr class="b"><td>Total</td>${r.months.map((x) => `<td class="n">${parseFloat(x.total) ? m(x.total) : "—"}</td>`).join("")}<td class="n">${m(r.total)}</td></tr></table>
    <h2 style="font-size:14px;margin-top:16px">Every bill</h2>
    <table><tr><th>Month</th><th>Bill</th><th>From</th><th>Store</th><th class="n">Amount</th><th class="n">Tax</th><th class="n">Total</th><th>Status</th></tr>${list}</table>`, "letter");
}
