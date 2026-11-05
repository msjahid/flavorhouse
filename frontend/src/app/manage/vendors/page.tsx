"use client";

import { useState } from "react";
import { ChangeCard, RecordHistory } from "@/components/manage/ChangeViews";
import Link from "next/link";
import { PurchaseDetail } from "@/components/manage/PurchaseViews";
import { Badge, Card, d, Empty, ErrorBox, Field, Modal, PageHeader, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { changeMessage, manageApi, type Purchase, type Vendor } from "@/lib/manage";

const TERMS: [string, string][] = [
  ["card", "Card at purchase"], ["cod", "Cash on delivery"], ["prepaid", "Prepaid"], ["net7", "Net 7"], ["net15", "Net 15"], ["net30", "Net 30"],
];
const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export default function VendorsPage() {
  const { user } = usePosAuth();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const { data, error, reload } = useLoad(() => manageApi.vendors(all), [all]);
  const pending = useLoad(() => manageApi.changes({ status: "pending", kind: "vendor" }), []);
  const [edit, setEdit] = useState<Vendor | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = (data ?? []).filter((v) => !q || `${v.name} ${v.categories} ${v.city}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader title="Vendors" sub="Suppliers you buy from. New vendors and changes are approved role-wise.">
        <input className="input !w-56 !py-2" placeholder="Search vendors…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show inactive</label>
        <button className="btn-primary" onClick={() => setEdit("new")}>+ Add vendor</button>
      </PageHeader>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      {(pending.data?.length ?? 0) > 0 && (
        <Card title={`⏳ Waiting for approval (${pending.data!.length})`} className="mb-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.data!.map((c) => <ChangeCard key={c.id} c={c} compact onDone={() => { pending.reload(); reload(); }} />)}
          </div>
        </Card>
      )}
      {list.length === 0 && data ? <Card><Empty>No vendors yet.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((v) => (
            <button key={v.id} onClick={() => setEdit(v)} className="rounded-3xl bg-white p-5 text-left ring-1 ring-ink/5 transition hover:ring-flame">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-xl font-extrabold">{v.name}</p>
                {!v.is_active ? <Badge status="inactive">Inactive</Badge> : v.w9_on_file ? <Badge status="active">W-9 ✓</Badge> : <Badge status="pending">No W-9</Badge>}
              </div>
              {v.categories && <p className="text-sm text-ink-soft">{v.categories}</p>}
              <dl className="mt-3 space-y-1 text-sm">
                {v.contact_name && <div>👤 {v.contact_name}</div>}
                {v.phone && <div>📞 {v.phone}</div>}
                {v.email && <div className="truncate">✉️ {v.email}</div>}
                {(v.city || v.state) && <div>📍 {[v.address, v.city, v.state, v.zip_code].filter(Boolean).join(", ")}</div>}
                <div>💳 {v.payment_terms_display}{v.account_number && ` · acct ${v.account_number}`}</div>
              </dl>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink/5 pt-3 text-center">
                {[["This month", v.spent_month], ["This year", v.spent_year], ["All time", v.spent_total]].map(([l, x]) => (
                  <div key={l}><p className="text-[10px] font-bold uppercase text-ink-soft">{l}</p><p className="font-bold tabular-nums">{usd(x ?? 0)}</p></div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-soft">{v.purchases ?? 0} approved purchases{v.last_purchase && ` · last ${d(v.last_purchase)}`}</p>
            </button>
          ))}
        </div>
      )}
      {edit && <VendorForm v={edit === "new" ? null : edit} level={user?.level ?? 0} onClose={() => setEdit(null)}
        onSent={(m) => { setEdit(null); setMsg(m); reload(); pending.reload(); }} />}
    </div>
  );
}

function VendorForm({ v, level, onClose, onSent }: { v: Vendor | null; level: number; onClose: () => void; onSent: (m: string) => void }) {
  const [f, setF] = useState({
    name: v?.name ?? "", contact_name: v?.contact_name ?? "", phone: v?.phone ?? "", email: v?.email ?? "", website: v?.website ?? "",
    address: v?.address ?? "", city: v?.city ?? "", state: v?.state ?? "", zip_code: v?.zip_code ?? "", account_number: v?.account_number ?? "",
    payment_terms: v?.payment_terms ?? "card", w9_on_file: v?.w9_on_file ?? false, categories: v?.categories ?? "", notes: v?.notes ?? "",
    is_active: v?.is_active ?? true,
  });
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"info" | "purchases" | "history">(v ? "purchases" : "info");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onSent(changeMessage(await manageApi.saveVendor({ ...f, ...(v ? { id: v.id } : {}), ...(reason ? { change_reason: reason } : {}) } as Partial<Vendor>))); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); setBusy(false); }
  };
  return (
    <Modal title={v ? v.name : "Add vendor"} onClose={onClose} wide>
      {v && (
        <div className="mb-4 flex gap-2">
          {([["purchases", "🧾 Purchase history"], ["info", "🏢 Details"], ["history", "🕘 Changes"]] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>{l}</button>
          ))}
        </div>
      )}
      {tab === "purchases" && v ? <VendorPurchases v={v} /> : tab === "history" && v ? <RecordHistory model="vendor" id={v.id} /> : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Business name"><input className="input !py-2" required value={f.name} onChange={set("name")} /></Field>
            <Field label="Contact person"><input className="input !py-2" value={f.contact_name} onChange={set("contact_name")} /></Field>
            <Field label="Phone"><input className="input !py-2" type="tel" placeholder="(555) 123-4567" value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Email"><input className="input !py-2" type="email" value={f.email} onChange={set("email")} /></Field>
            <Field label="Website / ordering portal"><input className="input !py-2" value={f.website} onChange={set("website")} /></Field>
            <Field label="Your account #"><input className="input !py-2" value={f.account_number} onChange={set("account_number")} /></Field>
            <Field label="Street address"><input className="input !py-2" value={f.address} onChange={set("address")} /></Field>
            <div className="grid grid-cols-[1fr_80px_90px] gap-2 sm:col-span-2">
              <Field label="City"><input className="input !py-2" value={f.city} onChange={set("city")} /></Field>
              <Field label="State">
                <select className="input !py-2 !pl-2" value={f.state} onChange={set("state")}><option value="">—</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
              <Field label="ZIP"><input className="input !py-2" inputMode="numeric" maxLength={10} value={f.zip_code} onChange={set("zip_code")} /></Field>
            </div>
          </div>
          <div className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10 sm:grid-cols-3">
            <Field label="Payment terms">
              <select className="input !py-2" value={f.payment_terms} onChange={set("payment_terms")}>{TERMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>
            <Field label="What you buy here"><input className="input !py-2" placeholder="Meat, produce, paper goods" value={f.categories} onChange={set("categories")} /></Field>
            <div className="flex flex-col justify-end gap-2 pb-1 text-sm font-semibold">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.w9_on_file} onChange={set("w9_on_file")} /> W-9 on file (needed for 1099s)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active} onChange={set("is_active")} /> Active</label>
            </div>
          </div>
          <Field label="Notes"><textarea className="input !py-2" rows={2} placeholder="Delivery days, rep, minimum order…" value={f.notes} onChange={set("notes")} /></Field>
          {v && <Field label="Why are you changing it?"><input className="input !py-2" required={level < 5} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          <ErrorBox error={err} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">{level >= 5 ? "Saved right away." : `Goes to a ${["", "", "supervisor", "super admin", "admin"][level]} for approval.`}</p>
            <button className="btn-primary" disabled={busy}>{v ? "Send change" : "Add vendor"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function VendorPurchases({ v }: { v: Vendor }) {
  const { data } = useLoad(() => manageApi.purchases({ vendor: String(v.id) }), [v.id]);
  const [open, setOpen] = useState<Purchase | null>(null);
  const [status, setStatus] = useState("");
  const list = (data ?? []).filter((p) => !status || p.status === status);
  const byMonth = new Map<string, number>();
  (data ?? []).filter((p) => p.status === "approved").forEach((p) => byMonth.set(p.purchase_date.slice(0, 7), (byMonth.get(p.purchase_date.slice(0, 7)) ?? 0) + parseFloat(p.total)));
  if (open) return <PurchaseDetail p={open} canReview onClose={() => setOpen(null)} onChanged={(p) => setOpen(p)} />;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[...byMonth.entries()].slice(0, 6).map(([m, t]) => (
          <span key={m} className="rounded-xl bg-white px-3 py-1.5 text-xs ring-1 ring-ink/5">
            <b>{new Date(`${m}-15T12:00:00`).toLocaleDateString([], { month: "short", year: "numeric" })}</b> {usd(t)}</span>
        ))}
        <select className="input ml-auto !w-auto !py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="approved">Approved</option><option value="pending">Waiting</option><option value="rejected">Rejected</option>
        </select>
      </div>
      {!data ? <p className="text-sm text-ink-soft">Loading…</p> : list.length === 0 ? <Empty>No purchases from {v.name} yet.</Empty> : (
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
              <th className="py-2">Date</th><th>Store</th><th>Items</th><th>By</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {list.map((p) => (
                <tr key={p.id} onClick={() => setOpen(p)} className="cursor-pointer hover:bg-white">
                  <td className="py-2.5 whitespace-nowrap">{d(p.purchase_date)}</td><td>{p.branch_name}</td>
                  <td className="max-w-56 truncate">{p.lines.map((l) => l.name).join(", ")}</td><td>{p.submitted_by_name}</td>
                  <td><Badge status={p.status}>{p.status === "pending" ? `Needs ${p.needs_role}` : p.status_display}</Badge></td>
                  <td className="text-right font-bold tabular-nums">{usd(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">Tap a purchase to see it, print it, or correct it (corrections are approved role-wise). <Link className="font-semibold text-flame" href={`/manage/purchases?vendor=${v.id}`}>Open in Purchases →</Link></p>
    </div>
  );
}
