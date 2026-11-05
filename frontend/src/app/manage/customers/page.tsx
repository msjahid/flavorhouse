"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useEffect, useState } from "react";
import { RecordHistory } from "@/components/manage/ChangeViews";
import { Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, useBranchFilter, useLoad, usd } from "@/components/manage/ui";
import { downloadWithToken, manageApi, type CustomerRow } from "@/lib/manage";
import { STATUS_STYLE } from "@/lib/pos";

const LETTERS = ["All", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];
const SORTS: [string, string][] = [["name", "Name A–Z"], ["spent", "Top spenders"], ["recent", "Most recent"], ["orders", "Most orders"]];

export default function CustomersPage() {
  const { branch, picker } = useBranchFilter();
  const [letter, setLetter] = useState("All");
  const [sort, setSort] = useState("name");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const params = { q: search, letter: letter === "All" ? "" : letter, sort, branch };
  const { data, error, reload } = useLoad(() => manageApi.customers(params), [search, letter, sort, branch]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { const t = setTimeout(() => setSearch(q), 300); return () => clearTimeout(t); }, [q]);

  return (
    <div>
      <PageHeader title="Customers" sub="Everyone who ordered with a phone number or email, and everything they bought. Only the admin edits customer details.">
        {picker}
        <input className="input !w-64 !py-2" placeholder="Search name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={sort} onChange={setSort} options={SORTS.map(([k, l]) => ({ value: k, label: l, icon: "↕" }))} />
        <button className="btn-dark !py-2" onClick={() => downloadWithToken(manageApi.customersCsvUrl(params), "customers.csv")}>⬇ CSV</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-1">
        {LETTERS.map((l) => (
          <button key={l} onClick={() => setLetter(l)}
            className={`h-9 min-w-9 rounded-lg px-2 text-sm font-bold ${letter === l ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10 hover:ring-flame"}`}>{l}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      <Card>
        {data?.items.length === 0 ? <Empty>No customers {letter !== "All" ? `starting with “${letter}”` : "yet"}. Customers appear once an order has a phone number or email.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b-2 border-ink/10 text-left text-xs uppercase tracking-wide text-ink-soft">
                <th className="px-3 py-2.5">Customer</th><th className="px-3">Phone</th><th className="px-3">Email</th>
                <th className="px-3 text-right">Orders</th><th className="px-3 text-right">Spent</th><th className="px-3">Last order</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data?.items.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer hover:bg-cream/60">
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mustard/60 text-xs font-extrabold">
                          {(c.name || c.email || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>
                        <span className="font-semibold">{c.name || <span className="text-ink-soft">No name</span>}
                          {c.notes && <span className="block max-w-56 truncate text-xs font-normal text-ink-soft">📝 {c.notes}</span>}</span>
                      </span>
                    </td>
                    <td className="px-3 tabular-nums">{c.phone || "—"}</td>
                    <td className="px-3">{c.email || "—"}</td>
                    <td className="px-3 text-right tabular-nums">{c.orders}</td>
                    <td className="px-3 text-right font-bold tabular-nums">{usd(c.spent)}</td>
                    <td className="px-3">{c.last_order ? d(c.last_order) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <p className="mt-3 text-xs text-ink-soft">{data.count} customer{data.count === 1 ? "" : "s"}</p>}
      </Card>
      {open && <CustomerModal id={open} branch={branch} onClose={() => setOpen(null)} onSaved={reload} />}
    </div>
  );
}

function CustomerModal({ id, branch, onClose, onSaved }: { id: number; branch: number | null; onClose: () => void; onSaved: () => void }) {
  const { data, error, setData } = useLoad(() => manageApi.customer(id, branch), [id, branch]);
  const [tab, setTab] = useState<"items" | "orders" | "edit" | "history">("items");
  const [f, setF] = useState<Partial<CustomerRow>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ name: data.name, email: data.email, phone: data.phone, notes: data.notes }); }, [data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { setData(await manageApi.saveCustomer(id, f)); setMsg("Saved ✓"); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  const tabs: [typeof tab, string][] = [["items", "🛍 Bought (A–Z)"], ["orders", "🧾 Orders"], ...(data?.can_edit ? [["edit", "✏️ Edit"] as [typeof tab, string]] : []), ["history", "🕘 History"]];

  return (
    <Modal title={data?.name || data?.email || "Customer"} onClose={onClose} wide>
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Orders", String(data.orders)], ["Spent", usd(data.spent)], ["First order", data.first_order ? d(data.first_order) : "—"], ["Last order", data.last_order ? d(data.last_order) : "—"]].map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-white p-3 ring-1 ring-ink/5"><p className="text-[11px] font-bold uppercase text-ink-soft">{l}</p><p className="font-display text-lg font-extrabold">{v}</p></div>
            ))}
          </div>
          <p className="mb-3 text-sm">📞 {data.phone || "—"} · ✉️ {data.email || "—"}{data.notes && <> · 📝 {data.notes}</>}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === k ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>{l}</button>
            ))}
          </div>
          {tab === "items" && (data.items.length === 0 ? <Empty>Nothing bought yet.</Empty> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft"><th className="py-2">Item</th><th className="text-right">Qty</th><th className="text-right">Spent</th><th className="pl-4">Last bought</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {data.items.map((i) => (
                  <tr key={i.name}><td className="py-2 font-semibold">{i.name}</td><td className="text-right tabular-nums">{i.quantity}</td>
                    <td className="text-right tabular-nums">{usd(i.spent)}</td><td className="pl-4">{d(i.last)}</td></tr>
                ))}
              </tbody>
            </table>
          ))}
          {tab === "orders" && (
            <ul className="max-h-[50vh] divide-y divide-ink/5 overflow-y-auto text-sm">
              {data.order_list.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span>
                    <b>#{o.short_number}</b> · {dt(o.created_at)} · {o.branch_name}
                    <span className="block text-xs text-ink-soft">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
                  </span>
                  <span className="text-right">
                    <b className="tabular-nums">{usd(o.total)}</b>
                    <span className={`mt-0.5 block rounded-full px-2 text-[11px] font-bold ${STATUS_STYLE[o.status]}`}>{o.status_display}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {tab === "edit" && data.can_edit && (
            <form onSubmit={save} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name"><input className="input !py-2" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Phone"><input className="input !py-2" type="tel" value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                <Field label="Email"><input className="input !py-2" type="email" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              </div>
              <Field label="Notes (allergies, preferences, VIP…)"><textarea className="input !py-2" rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              <ErrorBox error={err} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-leaf">{msg}</span>
                <button className="btn-primary">Save customer</button>
              </div>
              {data.edited_by_name && <p className="text-xs text-ink-soft">Last changed by {data.edited_by_name} · {dt(data.updated_at)}</p>}
            </form>
          )}
          {tab === "history" && <RecordHistory model="customer" id={id} />}
        </>
      )}
    </Modal>
  );
}
