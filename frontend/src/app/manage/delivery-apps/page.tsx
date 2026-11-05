"use client";

import { Fragment, useState } from "react";
import { DatePicker, Select } from "@/components/Pickers";
import { Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, PeriodPicker, Stat, useBranchFilter, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { localDateISO } from "@/lib/pos";
import { openPrint } from "@/lib/printDocs";
import { changeMessage, manageApi, type AppDay, type AppLedger, type AppPayoutRow, type DeliveryApp } from "@/lib/manage";

const ROLE = ["", "Employee", "Manager", "Supervisor", "Super admin", "Admin"];

/**
 * Delivery apps (Uber Eats, DoorDash, Grubhub… the admin adds more):
 * each day's sales & tax from the app's merchant report, and the money the app sent you. Supervisors and up.
 */
export default function DeliveryAppsPage() {
  const { user } = usePosAuth();
  const level = user?.level ?? 0;
  const { branch, picker } = useBranchFilter();
  const period = usePeriod("month");
  const [app, setApp] = useState("");
  const apps = useLoad(() => manageApi.deliveryApps(), []);
  const ledger = useLoad(() => manageApi.appLedger({ ...period.params, branch, partner: app }), [period.key, branch, app]);
  const [editingApp, setEditingApp] = useState<DeliveryApp | "new" | null>(null);
  const [day, setDay] = useState<AppDay | "new" | null>(null);
  const [payout, setPayout] = useState<AppPayoutRow | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const r = ledger.data;
  const canEditApps = !!apps.data?.can_edit;
  const canEdit = (submittedLevel: number) => level >= 5 || level > submittedLevel;
  const sent = (m: string) => { setDay(null); setPayout(null); setMsg(m); ledger.reload(); };

  if (level < 3) return <Card><Empty>🔒 Delivery app sales are for supervisors and above.</Empty></Card>;
  const t = r?.total;

  return (
    <div>
      <PageHeader title="Delivery apps"
        sub="Each day's sales and tax on Uber Eats, DoorDash, Grubhub and any other app (from the app's merchant report), and the money each app sent you. Supervisors add them — approved one role up; only a higher role edits.">
        <div className="flex flex-wrap gap-2">
          {r && <button className="btn-ghost !py-2" onClick={() => printLedger(r)}>📄 PDF / print</button>}
          <button className="btn-dark !py-2" onClick={() => setPayout("new")}>+ Money received</button>
          <button className="btn-primary !py-2" onClick={() => setDay("new")}>+ Day's sales</button>
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {picker}
        <PeriodPicker value={period.value} onChange={period.setValue} />
        <Select value={app} onChange={setApp}
          options={[{ value: "", label: "All apps", icon: "🛵" }, ...(apps.data?.apps ?? []).map((a) => ({ value: String(a.id), label: a.name, icon: a.emoji }))]} />
      </div>
      <ErrorBox error={ledger.error ?? apps.error} />
      {msg && <p className="mb-4 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{msg}</p>}

      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Sales (before tax)" value={usd(t.sales)} tone="dark" sub={`${t.orders} orders · ${t.days} app-days`} />
          <Stat label="Sales tax" value={usd(t.tax)} sub={`with tax ${usd(t.with_tax)} · apps pay ${usd(t.app_tax)}`} />
          <Stat label="App fees" value={`−${usd(t.fees)}`} tone="bad" sub={parseFloat(t.adjustments) ? `+ ${usd(t.adjustments)} refunds / adjustments` : "commission & fees"} />
          <Stat label="Money received" value={usd(t.received)} tone="good" sub={`expected ${usd(t.expected)}`} />
          <Stat label={parseFloat(t.balance) >= 0 ? "Still owed to you" : "Received more than these days"} value={usd(Math.abs(parseFloat(t.balance)))}
            tone={Math.abs(parseFloat(t.balance)) < 0.01 ? "good" : "bad"} sub="tip: payouts often cover days before the period" />
        </div>
      )}

      {/* ---------- apps */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {r?.apps.map((a) => {
          const cfg = apps.data?.apps.find((x) => x.id === a.id);
          const bal = parseFloat(a.balance);
          return (
            <section key={a.id} className={`relative overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-ink/5 ${a.is_active ? "" : "opacity-60"}`}>
              <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: a.color }} />
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl text-2xl text-white" style={{ background: a.color }}>{a.emoji || "🛵"}</span>
                  <div><p className="font-display text-xl font-extrabold leading-tight">{a.name}</p>
                    <p className="text-xs text-ink-soft">{a.days} days recorded{cfg ? ` · fee ${parseFloat(cfg.commission_percent)}%` : ""}</p></div>
                </div>
                {canEditApps && cfg && <button className="rounded-lg px-2 py-1 text-sm font-semibold text-ink-soft hover:bg-cream hover:text-ink" onClick={() => setEditingApp(cfg)}>Settings</button>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Mini label="Sales" value={usd(a.sales)} />
                <Mini label="Tax" value={usd(a.tax)} />
                <Mini label="Fees" value={`−${usd(a.fees)}`} />
                <Mini label="Expected" value={usd(a.expected)} />
                <Mini label="Received" value={usd(a.received)} strong />
                <Mini label={bal >= 0 ? "Owed" : "Over"} value={usd(Math.abs(bal))} warn={Math.abs(bal) >= 0.01} />
              </div>
            </section>
          );
        })}
        {canEditApps && (
          <button onClick={() => setEditingApp("new")} className="grid min-h-40 place-items-center rounded-3xl border-2 border-dashed border-ink/15 text-ink-soft hover:border-flame hover:text-flame">
            <span className="text-center font-semibold"><span className="block text-3xl">＋</span>Add another app</span>
          </button>
        )}
      </div>

      {r && r.waiting.length > 0 && (
        <Card title={`⏳ Waiting for approval (${r.waiting.length})`} className="mb-4">
          <ul className="divide-y divide-ink/5 text-sm">
            {r.waiting.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><b>{c.summary}</b><span className="block text-xs text-ink-soft">by {c.submitted_by_name} · {dt(c.created_at)}{c.reason && ` · “${c.reason}”`}</span></span>
                <span className="rounded-full bg-mustard/30 px-3 py-1 text-xs font-bold">Needs {c.need_role}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Approve or reject in <b>Approvals</b>.</p>
        </Card>
      )}

      <Card title="📅 Day by day — sales & tax" className="mb-4">
        {r?.daily.length === 0 ? <Empty>No app sales recorded for these dates. Press “+ Day's sales”.</Empty> : (
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b-2 border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="py-2">Day</th><th>App</th><th>Store</th><th className="text-right">Orders</th><th className="text-right">Sales</th>
              <th className="text-right">Tax</th><th className="text-right">With tax</th><th className="text-right">Fees</th><th className="text-right">Expected</th><th className="pl-4">Entered by</th><th /></tr></thead>
            <tbody>
              {r?.daily.map((g) => (
                <Fragment key={g.date}>
                  {g.apps.map((x, i) => (
                    <tr key={x.id} className={`hover:bg-cream/60 ${i === 0 ? "border-t border-ink/10" : ""}`}>
                      <td className="py-2 font-semibold">{i === 0 ? d(g.date) : ""}</td>
                      <td><span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: x.color }}>{x.emoji} {x.partner_name}</span></td>
                      <td className="text-ink-soft">{x.branch_name}</td>
                      <td className="text-right tabular-nums">{x.orders}</td>
                      <td className="text-right tabular-nums">{usd(x.sales)}</td>
                      <td className="text-right tabular-nums">{usd(x.tax)}{x.tax_by_app && <span className="block text-[10px] text-ink-soft">app pays</span>}</td>
                      <td className="text-right font-semibold tabular-nums">{usd(x.with_tax)}</td>
                      <td className="text-right tabular-nums text-flame">−{usd(x.fees)}</td>
                      <td className="text-right font-bold tabular-nums">{usd(x.expected)}</td>
                      <td className="pl-4 text-xs">{x.submitted_by_name}<span className="block text-ink-soft">✓ {x.approved_by_name}</span></td>
                      <td className="text-right">{canEdit(x.submitted_level) && <button className="rounded-lg px-2.5 py-1 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setDay(x)}>Edit</button>}</td>
                    </tr>
                  ))}
                  {g.apps.length > 1 && (
                    <tr className="bg-cream/50 text-xs font-bold">
                      <td /><td colSpan={2}>Day total</td><td className="text-right">{g.orders}</td><td className="text-right">{usd(g.sales)}</td>
                      <td className="text-right">{usd(g.tax)}</td><td className="text-right">{usd(g.with_tax)}</td><td colSpan={4} />
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {t && (
              <tfoot><tr className="border-t-2 border-ink/10 font-bold">
                <td className="py-2">Total</td><td colSpan={2} /><td className="text-right">{t.orders}</td><td className="text-right">{usd(t.sales)}</td>
                <td className="text-right">{usd(t.tax)}</td><td className="text-right">{usd(t.with_tax)}</td><td className="text-right text-flame">−{usd(t.fees)}</td>
                <td className="text-right">{usd(t.expected)}</td><td colSpan={2} /></tr></tfoot>
            )}
          </table>
        )}
      </Card>

      <Card title="💰 Money received from the apps">
        {r?.payouts.length === 0 ? <Empty>No payouts recorded for these dates. Press “+ Money received” when an app deposit arrives.</Empty> : (
          <ul className="divide-y divide-ink/5 text-sm">
            {r?.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="mr-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: p.color }}>{p.emoji} {p.partner_name}</span>
                  <b>{d(p.received_on)}</b> · {p.branch_name}
                  <span className="block text-xs text-ink-soft">{p.covers_from ? `for sales ${d(p.covers_from)} – ${d(p.covers_to ?? p.covers_from)}` : ""}{p.reference && ` · ref ${p.reference}`}{p.note && ` · ${p.note}`} · by {p.submitted_by_name} ✓ {p.approved_by_name}</span>
                </span>
                <span className="flex items-center gap-2"><b className="tabular-nums text-leaf">{usd(p.amount)}</b>
                  {canEdit(p.submitted_level) && <button className="rounded-lg px-2.5 py-1 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setPayout(p)}>Edit</button>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {day && apps.data && <DayModal x={day === "new" ? null : day} apps={apps.data.apps} defaultBranch={branch ?? user?.branch?.id ?? user?.branches[0]?.id ?? null}
        level={level} onClose={() => setDay(null)} onSent={sent} />}
      {payout && apps.data && <PayoutModal x={payout === "new" ? null : payout} apps={apps.data.apps} defaultBranch={branch ?? user?.branch?.id ?? user?.branches[0]?.id ?? null}
        level={level} onClose={() => setPayout(null)} onSent={sent} />}
      {editingApp && (
        <AppModal app={editingApp === "new" ? null : editingApp} onClose={() => setEditingApp(null)}
          onSaved={() => { setEditingApp(null); apps.reload(); ledger.reload(); }} />
      )}
    </div>
  );
}

function Mini({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-cream/70 px-2 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`font-display text-sm font-extrabold tabular-nums ${strong ? "text-leaf" : warn ? "text-flame" : ""}`}>{value}</p>
    </div>
  );
}

function StorePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { user } = usePosAuth();
  if (!user || user.branches.length <= 1) return <p className="rounded-xl bg-white px-3 py-2 ring-1 ring-ink/10">🏪 {user?.branch?.name ?? user?.branches[0]?.name}</p>;
  return <Select className="w-full" value={value} onChange={onChange} options={user.branches.map((b) => ({ value: String(b.id), label: b.name, icon: "🏪" }))} />;
}

function sendNote(level: number) {
  return level >= 5 ? "As admin, it's saved right away." : `It's added once a ${ROLE[level + 1].toLowerCase()} approves it.`;
}

function DayModal({ x, apps, defaultBranch, level, onClose, onSent }: {
  x: AppDay | null; apps: DeliveryApp[]; defaultBranch: number | null; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const first = apps.find((a) => a.is_active) ?? apps[0];
  const [f, setF] = useState({
    partner: String(x?.partner ?? first?.id ?? ""), branch: String(x?.branch ?? defaultBranch ?? ""), date: x?.date ?? localDateISO(),
    orders: String(x?.orders ?? ""), sales: x?.sales ?? "", tax: x?.tax ?? "", fees: x?.fees ?? "", adjustments: x?.adjustments ?? "0",
    tax_by_app: x?.tax_by_app ?? first?.collects_tax ?? true, note: x?.note ?? "",
  });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const pick = apps.find((a) => String(a.id) === f.partner);
  const n = (v: string) => parseFloat(v) || 0;
  const expected = n(f.sales) + (f.tax_by_app ? 0 : n(f.tax)) - n(f.fees) - n(f.adjustments);
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSent(changeMessage(x ? await manageApi.editAppDay(x.id, { ...f, change_reason: reason }) : await manageApi.addAppDay(f))); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  return (
    <Modal title={x ? `Edit ${x.partner_name} · ${d(x.date)}` : "Add a day's app sales"} onClose={onClose}>
      {!x && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {apps.filter((a) => a.is_active).map((a) => (
            <button key={a.id} type="button" onClick={() => set({ partner: String(a.id), tax_by_app: a.collects_tax })}
              style={f.partner === String(a.id) ? { background: a.color, borderColor: a.color } : { borderColor: `${a.color}55` }}
              className={`rounded-xl border-2 px-3 py-1.5 text-sm font-bold ${f.partner === String(a.id) ? "text-white" : "bg-white"}`}>{a.emoji} {a.name}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day"><DatePicker value={f.date} max={localDateISO()} onChange={(v) => set({ date: v })} className="w-full" /></Field>
        <Field label="Store">{x ? <p className="rounded-xl bg-white px-3 py-2 ring-1 ring-ink/10">🏪 {x.branch_name}</p> : <StorePick value={f.branch} onChange={(v) => set({ branch: v })} />}</Field>
        <Field label="Orders"><input className="input !py-2" type="number" min="0" value={f.orders} onChange={(e) => set({ orders: e.target.value })} /></Field>
        <Field label="Sales before tax ($)"><input className="input !py-2" type="number" min="0" step="0.01" value={f.sales} onChange={(e) => set({ sales: e.target.value })} /></Field>
        <Field label="Sales tax ($)"><input className="input !py-2" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set({ tax: e.target.value })} /></Field>
        <Field label={`${pick?.name ?? "App"} fees ($)`} hint={pick ? `about ${parseFloat(pick.commission_percent)}% → ${usd(n(f.sales) * parseFloat(pick.commission_percent) / 100)}` : undefined}>
          <input className="input !py-2" type="number" min="0" step="0.01" value={f.fees} onChange={(e) => set({ fees: e.target.value })} /></Field>
        <Field label="Refunds / adjustments ($)"><input className="input !py-2" type="number" min="0" step="0.01" value={f.adjustments} onChange={(e) => set({ adjustments: e.target.value })} /></Field>
        <Field label="Note"><input className="input !py-2" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Toggle on={f.tax_by_app} onChange={(v) => set({ tax_by_app: v })} label="The app collected & paid this tax"
        hint="Marketplace facilitator — then the tax isn't part of what you pay, and it isn't in the payout." /></div>
      {x && <div className="mt-3"><Field label="Why are you changing it? (required)"><input className="input !py-2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>}
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-ink p-4 text-cream">
        <span><span className="block text-[11px] uppercase text-cream/60">Sales with tax</span><b className="font-display text-xl">{usd(n(f.sales) + n(f.tax))}</b></span>
        <span className="text-right"><span className="block text-[11px] uppercase text-cream/60">The app should pay you</span><b className="font-display text-xl text-mustard">{usd(expected)}</b></span>
      </div>
      <ErrorBox error={err} />
      <button className="btn-primary mt-4 w-full" disabled={busy || !(n(f.sales) > 0) || !f.partner || !f.branch || (!!x && !reason.trim())} onClick={save}>
        {busy ? "Saving…" : level >= 5 ? "Save" : `Send to ${ROLE[level + 1]} for approval`}</button>
      <p className="mt-2 text-center text-xs text-ink-soft">{sendNote(level)}</p>
    </Modal>
  );
}

function PayoutModal({ x, apps, defaultBranch, level, onClose, onSent }: {
  x: AppPayoutRow | null; apps: DeliveryApp[]; defaultBranch: number | null; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const first = apps.find((a) => a.is_active) ?? apps[0];
  const [f, setF] = useState({
    partner: String(x?.partner ?? first?.id ?? ""), branch: String(x?.branch ?? defaultBranch ?? ""), received_on: x?.received_on ?? localDateISO(),
    amount: x?.amount ?? "", covers_from: x?.covers_from ?? "", covers_to: x?.covers_to ?? "", reference: x?.reference ?? "", note: x?.note ?? "",
  });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSent(changeMessage(x ? await manageApi.editAppPayout(x.id, { ...f, change_reason: reason }) : await manageApi.addAppPayout(f))); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  return (
    <Modal title={x ? `Edit ${x.partner_name} payout` : "Money received from an app"} onClose={onClose}>
      {!x && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {apps.filter((a) => a.is_active).map((a) => (
            <button key={a.id} type="button" onClick={() => set({ partner: String(a.id) })}
              style={f.partner === String(a.id) ? { background: a.color, borderColor: a.color } : { borderColor: `${a.color}55` }}
              className={`rounded-xl border-2 px-3 py-1.5 text-sm font-bold ${f.partner === String(a.id) ? "text-white" : "bg-white"}`}>{a.emoji} {a.name}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Received on"><DatePicker value={f.received_on} max={localDateISO()} onChange={(v) => set({ received_on: v })} className="w-full" /></Field>
        <Field label="Amount ($)"><input className="input !py-2" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
        <Field label="Store">{x ? <p className="rounded-xl bg-white px-3 py-2 ring-1 ring-ink/10">🏪 {x.branch_name}</p> : <StorePick value={f.branch} onChange={(v) => set({ branch: v })} />}</Field>
        <Field label="Payout / transfer ID"><input className="input !py-2" value={f.reference} onChange={(e) => set({ reference: e.target.value })} /></Field>
        <Field label="For sales from"><DatePicker value={f.covers_from} max={localDateISO()} onChange={(v) => set({ covers_from: v })} className="w-full" /></Field>
        <Field label="to"><DatePicker value={f.covers_to} min={f.covers_from || undefined} max={localDateISO()} onChange={(v) => set({ covers_to: v })} className="w-full" /></Field>
      </div>
      <div className="mt-3"><Field label="Note"><input className="input !py-2" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field></div>
      {x && <div className="mt-3"><Field label="Why are you changing it? (required)"><input className="input !py-2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>}
      <ErrorBox error={err} />
      <button className="btn-primary mt-4 w-full" disabled={busy || !(parseFloat(f.amount) > 0) || !f.partner || !f.branch || (!!x && !reason.trim())} onClick={save}>
        {busy ? "Saving…" : level >= 5 ? "Save" : `Send to ${ROLE[level + 1]} for approval`}</button>
      <p className="mt-2 text-center text-xs text-ink-soft">{sendNote(level)}</p>
    </Modal>
  );
}

const SWATCHES = ["#06C167", "#FF3008", "#F63440", "#000000", "#FFC72C", "#7B2CBF", "#00A3E0", "#E5431B"];

function AppModal({ app, onClose, onSaved }: { app: DeliveryApp | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: app?.name ?? "", emoji: app?.emoji ?? "🛵", color: app?.color ?? "#00A3E0",
    commission_percent: app ? String(parseFloat(app.commission_percent)) : "25",
    markup_percent: app ? String(parseFloat(app.markup_percent)) : "0",
    collects_tax: app?.collects_tax ?? true, payout_schedule: app?.payout_schedule ?? "", account_id: app?.account_id ?? "",
    notes: app?.notes ?? "", is_active: app?.is_active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const save = async () => {
    setBusy(true); setErr(null);
    try { app ? await manageApi.editDeliveryApp(app.id, f) : await manageApi.addDeliveryApp(f); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };
  const remove = async () => {
    if (!app || !confirm(`Delete ${app.name}?`)) return;
    try { await manageApi.deleteDeliveryApp(app.id); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Modal title={app ? `Edit ${app.name}` : "Add a delivery app"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-[80px_1fr] gap-3">
          <Field label="Icon"><input className="input !py-2 text-center text-xl" maxLength={4} value={f.emoji} onChange={(e) => set({ emoji: e.target.value })} /></Field>
          <Field label="App name"><input className="input !py-2" placeholder="e.g. Postmates, Seamless, ezCater" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        </div>
        <Field label="Brand colour">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c}
                className={`h-8 w-8 rounded-full ring-offset-2 ${f.color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ink" : ""}`} style={{ background: c }} />
            ))}
            <input type="color" value={f.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="App fee (%)" hint="What the app keeps from the food total">
            <input className="input !py-2" type="number" min="0" max="100" step="0.5" value={f.commission_percent} onChange={(e) => set({ commission_percent: e.target.value })} /></Field>
          <Field label="Price markup (%)" hint="Menu prices on the app vs. in store">
            <input className="input !py-2" type="number" min="0" max="100" step="0.5" value={f.markup_percent} onChange={(e) => set({ markup_percent: e.target.value })} /></Field>
          <Field label="Payout schedule"><input className="input !py-2" placeholder="e.g. Weekly on Monday" value={f.payout_schedule} onChange={(e) => set({ payout_schedule: e.target.value })} /></Field>
          <Field label="Your store ID on the app"><input className="input !py-2" value={f.account_id} onChange={(e) => set({ account_id: e.target.value })} /></Field>
        </div>
        <Toggle on={f.collects_tax} onChange={(v) => set({ collects_tax: v })} label="The app collects and pays the sales tax"
          hint="Marketplace-facilitator rule — true for Uber Eats, DoorDash and Grubhub in most US states. Then that tax isn't part of what you pay." />
        <Toggle on={f.is_active} onChange={(v) => set({ is_active: v })} label="Show on the register" hint="Turn off to stop taking orders from this app (its history stays)." />
        <Field label="Notes"><input className="input !py-2" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {app?.updated_by_name && <p className="mt-2 text-xs text-ink-soft">Last changed by {app.updated_by_name} · {dt(app.updated_at)}</p>}
      <ErrorBox error={err} />
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
        {app ? <button className="btn-ghost text-flame" onClick={remove}>Delete</button> : <span />}
        <button className="btn-primary" onClick={save} disabled={busy || !f.name.trim()}>{busy ? "Saving…" : app ? "Save changes" : "Add app"}</button>
      </div>
    </Modal>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-ink/10">
      <span className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${on ? "bg-leaf" : "bg-ink/20"}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-5" : ""}`} />
      </span>
      <span><span className="block text-sm font-semibold">{label}</span>{hint && <span className="block text-xs text-ink-soft">{hint}</span>}</span>
    </button>
  );
}


function printLedger(r: AppLedger) {
  const m = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const apps = r.apps.map((a) => `<tr><td>${a.name}</td><td class="n">${a.days}</td><td class="n">${a.orders}</td><td class="n">${m(a.sales)}</td><td class="n">${m(a.tax)}</td>
    <td class="n">${m(a.with_tax)}</td><td class="n">-${m(a.fees)}</td><td class="n">${m(a.expected)}</td><td class="n">${m(a.received)}</td><td class="n b">${m(a.balance)}</td></tr>`).join("");
  const days = r.daily.flatMap((g) => g.apps.map((x) => `<tr><td>${x.date}</td><td>${x.partner_name}</td><td>${x.branch_name}</td><td class="n">${x.orders}</td>
    <td class="n">${m(x.sales)}</td><td class="n">${m(x.tax)}${x.tax_by_app ? "*" : ""}</td><td class="n">${m(x.with_tax)}</td><td class="n">-${m(x.fees)}</td><td class="n">${m(x.expected)}</td></tr>`)).join("");
  const pays = r.payouts.map((p) => `<tr><td>${p.received_on}</td><td>${p.partner_name}</td><td>${p.branch_name}</td><td>${p.reference}</td><td class="n b">${m(p.amount)}</td></tr>`).join("");
  const t = r.total;
  openPrint(`Delivery apps ${r.from} to ${r.to}`, `
    <h1>${SITE_NAME} — Delivery apps</h1><p>${r.from} to ${r.to} · printed ${new Date().toLocaleString()}</p>
    <table><tr><th>App</th><th class="n">Days</th><th class="n">Orders</th><th class="n">Sales</th><th class="n">Tax</th><th class="n">With tax</th><th class="n">Fees</th><th class="n">Expected</th><th class="n">Received</th><th class="n">Owed</th></tr>
    ${apps}<tr class="b"><td>Total</td><td class="n">${t.days}</td><td class="n">${t.orders}</td><td class="n">${m(t.sales)}</td><td class="n">${m(t.tax)}</td><td class="n">${m(t.with_tax)}</td>
    <td class="n">-${m(t.fees)}</td><td class="n">${m(t.expected)}</td><td class="n">${m(t.received)}</td><td class="n">${m(t.balance)}</td></tr></table>
    <h2 style="font-size:14px;margin-top:16px">Day by day</h2>
    <table><tr><th>Day</th><th>App</th><th>Store</th><th class="n">Orders</th><th class="n">Sales</th><th class="n">Tax</th><th class="n">With tax</th><th class="n">Fees</th><th class="n">Expected</th></tr>${days}</table>
    <p style="font-size:10px">* tax collected &amp; paid by the app (marketplace facilitator)</p>
    <h2 style="font-size:14px;margin-top:16px">Money received</h2>
    <table><tr><th>Date</th><th>App</th><th>Store</th><th>Ref</th><th class="n">Amount</th></tr>${pays}</table>`, "letter");
}
