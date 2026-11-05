"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useState } from "react";
import { Card, d, Empty, ErrorBox, Field, Modal, PageHeader, Stat, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { localDateISO } from "@/lib/pos";
import { manageApi, type OwnerRow } from "@/lib/manage";

const METHODS: [string, string][] = [["bank_transfer", "Bank transfer"], ["check", "Check"], ["cash", "Cash from store"], ["other", "Other"]];
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString([], { month: "long" });

export default function OwnersPage() {
  const { user } = usePosAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const split = useLoad(() => manageApi.ownerSplit(year), [year]);
  const draws = useLoad(() => manageApi.ownerDraws({ from: `${year}-01-01`, to: `${year}-12-31` }), [year]);
  const [editOwner, setEditOwner] = useState<Partial<OwnerRow> | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if ((user?.level ?? 0) < 5) {
    return <Card><Empty>🔒 Only the admin manages owners, draws and the profit split.</Empty></Card>;
  }
  const s = split.data;
  const owners = s?.owners ?? [];
  const nameOf = (id: number) => owners.find((o) => o.id === id)?.name ?? "—";
  const reload = () => { split.reload(); draws.reload(); };
  const yearProfit = (s?.months ?? []).reduce((t, m) => t + parseFloat(m.net_profit), 0);
  const yearTaken = (s?.months ?? []).reduce((t, m) => t + parseFloat(m.taken_total), 0);
  const del = async (id: number) => {
    if (!confirm("Delete this draw record?")) return;
    try { await manageApi.deleteOwnerDraw(id); reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div>
      <PageHeader title="Owners & profit split" sub="Money the owners take out of the business, and each owner's share of the monthly profit. Only the admin sees this page.">
        <Select value={String(year)} onChange={(v) => setYear(Number(v))} options={[0, 1, 2, 3].map((n) => String(new Date().getFullYear() - n)).map((y) => ({ value: y, label: y, icon: "🗓" }))} />
        <button className="btn-ghost !py-2" onClick={() => setEditOwner({ share_percent: "0", is_active: true })}>+ Owner</button>
        <button className="btn-primary" onClick={() => setAdding(true)} disabled={!owners.length}>+ Record money taken</button>
      </PageHeader>
      <ErrorBox error={split.error || err} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Net profit ${year}`} value={usd(yearProfit)} tone={yearProfit >= 0 ? "dark" : "bad"} sub="sales − food cost − expenses − labor" />
        <Stat label="Taken by owners" value={usd(yearTaken)} />
        <Stat label="Left in the business" value={usd(yearProfit - yearTaken)} tone={yearProfit - yearTaken >= 0 ? "good" : "bad"} />
        <Stat label="Shares set" value={`${s?.share_total ?? "0"}%`} tone={s && parseFloat(s.share_total) === 100 ? "good" : "bad"}
              sub={s && parseFloat(s.share_total) !== 100 ? "Should add up to 100%" : "Adds up to 100% ✓"} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {owners.map((o) => {
          const t = s?.totals.find((x) => x.owner === o.id);
          const bal = parseFloat(t?.balance ?? "0");
          return (
            <button key={o.id} onClick={() => setEditOwner(o)} className={`rounded-3xl bg-white p-5 text-left ring-1 ring-ink/5 hover:ring-flame ${o.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between">
                <p className="font-display text-xl font-extrabold">{o.name}</p>
                <span className="rounded-full bg-ink px-3 py-1 font-display text-lg font-extrabold text-cream">{parseFloat(o.share_percent)}%</span>
              </div>
              {o.notes && <p className="text-xs text-ink-soft">{o.notes}</p>}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-[11px] font-bold uppercase text-ink-soft">Share {year}</dt><dd className="font-bold tabular-nums">{usd(t?.share ?? 0)}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase text-ink-soft">Taken</dt><dd className="font-bold tabular-nums">{usd(t?.taken ?? 0)}</dd></div>
                <div><dt className="text-[11px] font-bold uppercase text-ink-soft">{bal >= 0 ? "Still due" : "Over-drawn"}</dt>
                  <dd className={`font-bold tabular-nums ${bal >= 0 ? "text-leaf" : "text-flame"}`}>{usd(Math.abs(bal))}</dd></div>
              </dl>
            </button>
          );
        })}
        {owners.length === 0 && <Card className="md:col-span-2 xl:col-span-3"><Empty>Add each owner and their share (for example 60% and 40%).</Empty></Card>}
      </div>

      <Card title={`📅 Month by month · ${year}`} className="mb-4">
        {!s?.months.length ? <Empty>No months yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b-2 border-ink/10 text-left text-xs uppercase tracking-wide text-ink-soft">
                  <th className="px-3 py-2.5">Month</th><th className="px-3 text-right">Net sales</th><th className="px-3 text-right">Costs</th>
                  <th className="px-3 text-right">Net profit</th>
                  {owners.map((o) => <th key={o.id} className="px-3 text-right">{o.name} ({parseFloat(o.share_percent)}%)<span className="block font-normal normal-case">share / taken</span></th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {s.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-3 py-3 font-semibold">{monthName(m.month)}{m.running && <span className="ml-2 rounded-full bg-mustard/40 px-2 text-[11px] font-bold">so far</span>}</td>
                    <td className="px-3 text-right tabular-nums">{usd(m.net_sales)}</td>
                    <td className="px-3 text-right tabular-nums text-ink-soft">{usd(parseFloat(m.cogs) + parseFloat(m.expenses) + parseFloat(m.labor))}</td>
                    <td className={`px-3 text-right font-bold tabular-nums ${parseFloat(m.net_profit) < 0 ? "text-flame" : ""}`}>{usd(m.net_profit)}</td>
                    {m.owners.map((x) => (
                      <td key={x.owner} className="px-3 text-right tabular-nums">{usd(x.share)}<span className="block text-xs text-ink-soft">taken {usd(x.taken)}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-soft">Net profit = net sales − food cost (COGS) − other expenses − labor, from approved purchases and hours. A loss month gives a negative share.</p>
      </Card>

      <Card title={`💸 Money taken out · ${year}`}>
        {draws.data?.length === 0 ? <Empty>No money taken out this year.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
              <th className="py-2">Date</th><th>Owner</th><th>How</th><th>From store</th><th>Note</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {draws.data?.map((x) => (
                <tr key={x.id}>
                  <td className="py-2.5">{d(x.date)}</td><td className="font-semibold">{x.owner_name}</td>
                  <td>{x.method_display}{x.reference && <span className="block text-xs text-ink-soft">#{x.reference}</span>}</td>
                  <td>{x.branch_name ?? "Business account"}</td><td className="text-ink-soft">{x.note}</td>
                  <td className="text-right font-bold tabular-nums">{usd(x.amount)}</td>
                  <td className="text-right"><button className="text-xs text-ink-soft hover:text-flame" onClick={() => del(x.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editOwner && <OwnerForm o={editOwner} onClose={() => setEditOwner(null)} onSaved={() => { setEditOwner(null); reload(); }} />}
      {adding && <DrawForm owners={owners.filter((o) => o.is_active)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} nameOf={nameOf} />}
    </div>
  );
}

function OwnerForm({ o, onClose, onSaved }: { o: Partial<OwnerRow>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: o.name ?? "", share_percent: o.share_percent ?? "0", notes: o.notes ?? "", is_active: o.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await manageApi.saveOwner({ ...f, ...(o.id ? { id: o.id } : {}) }); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Modal title={o.id ? `Owner · ${o.name}` : "Add owner"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Name"><input className="input !py-2" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Share of profit"><div className="relative"><input className="input !py-2 !pr-8" type="number" step="0.01" min="0" max="100" required
            value={f.share_percent} onChange={(e) => setF({ ...f, share_percent: e.target.value })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold">%</span></div></Field>
        </div>
        <Field label="Note"><input className="input !py-2" placeholder="e.g. Founding partner" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active owner (gets a share)</label>
        <ErrorBox error={err} />
        <button className="btn-primary w-full">Save</button>
      </form>
    </Modal>
  );
}

function DrawForm({ owners, onClose, onSaved }: { owners: OwnerRow[]; onClose: () => void; onSaved: () => void; nameOf: (id: number) => string }) {
  const { user } = usePosAuth();
  const [f, setF] = useState({ owner: String(owners[0]?.id ?? ""), date: localDateISO(), amount: "", method: "bank_transfer", branch: "", reference: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await manageApi.addOwnerDraw({ ...f, owner: Number(f.owner), branch: f.branch ? Number(f.branch) : null }); onSaved(); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Modal title="Record money taken out" onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <Field label="Owner"><select className="input !py-2" value={f.owner} onChange={set("owner")}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" className="input !py-2" max={localDateISO()} value={f.date} onChange={set("date")} /></Field>
        <Field label="Amount ($)"><input type="number" step="0.01" min="0.01" required className="input !py-2" value={f.amount} onChange={set("amount")} /></Field>
        <Field label="How"><select className="input !py-2" value={f.method} onChange={set("method")}>{METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="From which store"><select className="input !py-2" value={f.branch} onChange={set("branch")}>
          <option value="">Business bank account</option>{user?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Check # / reference"><input className="input !py-2" value={f.reference} onChange={set("reference")} /></Field>
        <div className="col-span-2"><Field label="Note"><input className="input !py-2" placeholder="October profit share" value={f.note} onChange={set("note")} /></Field></div>
        <div className="col-span-2"><ErrorBox error={err} /></div>
        <button className="btn-primary col-span-2">Save</button>
      </form>
    </Modal>
  );
}
