"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useEffect, useState } from "react";
import Denominations, { countTotal, toCounts } from "@/components/Denominations";
import { RecordHistory } from "@/components/manage/ChangeViews";
import { Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, PeriodPicker, Stat, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { localDateISO, posApi } from "@/lib/pos";
import { canEditEntry, changeMessage, manageApi, type DailyClose, type Deposit } from "@/lib/manage";

export default function CashPage() {
  const { user } = usePosAuth();
  const [branch, setBranch] = useState<number | null>(user?.branch?.id ?? user?.branches[0]?.id ?? null);
  const multi = (user?.level ?? 0) >= 3 && (user?.branches.length ?? 0) > 1;

  return (
    <div>
      <PageHeader title="Cash & deposits" sub="Close the drawer, record cash drops and bank deposits">
        {multi ? (
          <Select value={String(branch ?? "")} onChange={(v) => setBranch(Number(v))} options={user!.branches.map((b) => ({ value: String(b.id), label: b.name, icon: "🏪" }))} />
        ) : <span className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-ink/10">🏪 {user?.branch?.name}</span>}
      </PageHeader>
      {branch && (
        <div className="space-y-4">
          <StartOfDay branch={branch} />
          <CloseDay branch={branch} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Drops branch={branch} />
            <Deposits branch={branch} canVerify={(user?.level ?? 0) >= 3} canEdit={(user?.level ?? 0) >= 4} />
          </div>
          <DropHistory branch={branch} />
          <PastCloses branch={branch} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- end of day

function StartOfDay({ branch }: { branch: number }) {
  const { user } = usePosAuth();
  const { data, reload } = useLoad(() => posApi.day(branch), [branch]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return null;
  const start = async () => {
    setErr(null);
    try { await posApi.startDay(branch, toCounts(counts), note); setOpen(false); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Card title="☀️ Start of day" action={!data.started && (user?.level ?? 0) >= 2 && <button className="btn-primary !px-4 !py-1.5 text-sm" onClick={() => setOpen(true)}>Count opening cash</button>}>
      {data.started ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="rounded-full bg-leaf/15 px-3 py-1 font-bold text-leaf">✓ Open</span>
          <span>Opening float <b className="tabular-nums">{usd(data.opening_float ?? 0)}</b></span>
          <span className="text-ink-soft">by {data.opened_by} · {data.opened_at && dt(data.opened_at)}</span>
        </div>
      ) : (
        <p className="text-sm"><span className="mr-2 rounded-full bg-mustard/40 px-3 py-1 font-bold">Not started</span>
          The register is locked until a manager (or higher) counts the opening cash. Suggested float {usd(data.suggested_float)}.</p>
      )}
      {open && (
        <Modal title="Start the day" onClose={() => setOpen(false)} wide>
          <p className="mb-3 text-sm text-ink-soft">Count the cash in the drawer before the first sale. Last close left {usd(data.suggested_float)}.</p>
          <Denominations value={counts} onChange={setCounts} />
          <input className="input mt-3" placeholder="Note (required if it differs from last close)" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorBox error={err} />
          <button className="btn-primary mt-4 w-full" disabled={countTotal(counts) <= 0} onClick={start}>Open with {usd(countTotal(counts))}</button>
        </Modal>
      )}
    </Card>
  );
}

function CloseDay({ branch }: { branch: number }) {
  const { user } = usePosAuth();
  const [date, setDate] = useState(localDateISO());
  const { data, error, reload } = useLoad(() => manageApi.closePreview(branch, date), [branch, date]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<DailyClose | null>(null);

  useEffect(() => {
    const saved = data?.saved?.denominations ?? {};
    setCounts(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v)])));
    setNotes(data?.saved?.notes ?? "");
  }, [data]);

  const counted = countTotal(counts);
  const n = data?.numbers;
  const saved = data?.saved ?? null;
  const expected = n ? parseFloat(saved ? saved.expected_cash : n.expected_cash) : 0;
  const diff = Math.round((counted - expected) * 100) / 100;
  const canEdit = !!saved && !!user && canEditEntry(user.level, saved.closed_by_level, saved.closed_by === user.id);

  const save = async () => {
    setErr(null);
    try {
      const r = await manageApi.saveClose({ branch, date, notes, denominations: toCounts(counts) });
      setMsg(`Day closed. Over/short ${usd(r.over_short)} · cash to deposit ${usd(r.cash_to_deposit)}`);
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Card title="🔒 End-of-day close" action={<DatePicker size="sm" max={localDateISO()} value={date} onChange={(v) => { setDate(v); setMsg(null); }} label="Closing date" />}>
      <ErrorBox error={error} />
      {n && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="mb-2 text-sm font-semibold">What the drawer should have</p>
            <dl className="space-y-1 text-sm">
              {[["Opening float", n.opening_float], ["+ Cash sales", n.cash_sales], ["− Cash refunds", n.cash_refunds],
                ["− Paid outs & cash purchases", n.paid_outs], ["+ Paid ins", n.paid_ins], ["− Dropped to safe", n.safe_drops]].map(([l, v]) => (
                <div key={l} className="flex justify-between"><dt className="text-ink-soft">{l}</dt><dd className="tabular-nums">{usd(v)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-ink/10 pt-1 text-base font-bold"><dt>Expected cash</dt><dd className="tabular-nums">{usd(n.expected_cash)}</dd></div>
            </dl>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-cream p-2">Card<br /><b className="text-sm">{usd(n.card_sales)}</b></div>
              <div className="rounded-xl bg-cream p-2">Online<br /><b className="text-sm">{usd(n.online_sales)}</b></div>
              <div className="rounded-xl bg-cream p-2">All sales<br /><b className="text-sm">{usd(n.total_sales)}</b></div>
            </div>
            {(parseFloat(n.app_sales ?? "0") > 0 || parseFloat(n.tips ?? "0") > 0) && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-xl bg-cream p-2">🛵 Delivery apps (paid on the app)<br /><b className="text-sm">{usd(n.app_sales ?? 0)}</b></div>
                <div className="rounded-xl bg-cream p-2">💛 Tips (inside cash / card above)<br /><b className="text-sm">{usd(n.tips ?? 0)}</b></div>
              </div>
            )}
            {n.unpaid_kiosk_orders > 0 && <p className="mt-3 rounded-xl bg-mustard/30 p-2 text-sm">⚠️ {n.unpaid_kiosk_orders} kiosk orders were never paid — cancel them in POS → Orders.</p>}
          </div>
          {saved ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Closed ✓</p>
                {canEdit && <button className="btn-dark !px-3 !py-1.5 text-xs" onClick={() => setEditing(saved)}>✏️ Edit closing</button>}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label="Counted" value={usd(saved.counted_cash)} tone="dark" />
                <Stat label={parseFloat(saved.over_short) >= 0 ? "Over" : "Short"} value={usd(Math.abs(parseFloat(saved.over_short)))}
                      tone={Math.abs(parseFloat(saved.over_short)) >= 5 ? "bad" : Math.abs(parseFloat(saved.over_short)) < 0.01 ? "good" : "default"} />
                <Stat label="To deposit" value={usd(saved.cash_to_deposit)} />
              </div>
              {saved.notes && <p className="mt-3 rounded-xl bg-cream p-3 text-sm">📝 {saved.notes}</p>}
              <p className="mt-2 text-xs text-ink-soft">Closed by {saved.closed_by_name}{saved.edited_by_name && ` · last changed by ${saved.edited_by_name}`}.
                {!canEdit && " You can’t change your own closing — a higher role can."}</p>
              {msg && <p className="mt-2 rounded-xl bg-leaf/10 p-2 text-sm text-leaf">{msg}</p>}
            </div>
          ) : (
            <div>
              <p className="mb-2 text-sm font-semibold">Count the drawer</p>
              <Denominations value={counts} onChange={setCounts} />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="Counted" value={usd(counted)} tone="dark" />
                <Stat label={diff > 0 ? "Over" : diff < 0 ? "Short" : "Balanced"} value={usd(Math.abs(diff))}
                      tone={Math.abs(diff) >= 5 ? "bad" : Math.abs(diff) < 0.01 ? "good" : "default"} />
              </div>
              <textarea className="input mt-3 !py-2" rows={2} placeholder="Notes (explain any over/short)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <ErrorBox error={err} />
              {msg && <p className="mt-2 rounded-xl bg-leaf/10 p-2 text-sm text-leaf">{msg}</p>}
              <button className="btn-primary mt-3 w-full" onClick={save}>Close the day</button>
            </div>
          )}
        </div>
      )}
      {editing && <EditClose c={editing} onClose={() => setEditing(null)} onSent={(m) => { setEditing(null); setMsg(m); reload(); }} />}
    </Card>
  );
}

function EditClose({ c, onClose, onSent }: { c: DailyClose; onClose: () => void; onSent: (m: string) => void }) {
  const [counts, setCounts] = useState<Record<string, string>>(Object.fromEntries(Object.entries(c.denominations).map(([k, v]) => [k, String(v)])));
  const [notes, setNotes] = useState(c.notes);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const send = async () => {
    setErr(null);
    try { onSent(changeMessage(await manageApi.editClose(c.id, { denominations: toCounts(counts), notes, reason }))); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Modal title={`Closing · ${c.branch_name} · ${d(c.date)}`} onClose={onClose} wide>
      <div className="mb-4 flex gap-2">
        {(["edit", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
            {t === "edit" ? "✏️ Correct the count" : "🕘 History"}</button>
        ))}
      </div>
      {tab === "edit" ? (
        <>
          <p className="mb-2 text-sm text-ink-soft">Was counted {usd(c.counted_cash)} by {c.closed_by_name}. Expected {usd(c.expected_cash)}.</p>
          <Denominations value={counts} onChange={setCounts} />
          <p className="text-right text-sm">New over/short <b>{usd(countTotal(counts) - parseFloat(c.expected_cash))}</b></p>
          <textarea className="input mt-3 !py-2" rows={2} placeholder="Closing notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <input className="input mt-2" placeholder="Why are you changing it? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <ErrorBox error={err} />
          <button className="btn-primary mt-4 w-full" disabled={!reason.trim()} onClick={send}>Send change for approval</button>
        </>
      ) : <RecordHistory model="daily close" id={c.id} />}
    </Modal>
  );
}

// ---------------------------------------------------------------- drops

function DrawerNow({ branch, tick }: { branch: number; tick: number }) {
  const { data } = useLoad(() => manageApi.closePreview(branch, localDateISO()), [branch, tick]);
  const n = data?.numbers;
  if (!n) return null;
  const rows: [string, string, string][] = [
    ["Opening float", n.opening_float, ""], ["+ Cash sales", n.cash_sales, ""], ["− Cash refunds", n.cash_refunds, "text-flame"],
    ["− Paid out & cash purchases", n.paid_outs, "text-flame"], ["+ Paid in", n.paid_ins, "text-leaf"], ["− Dropped to safe", n.safe_drops, ""],
  ];
  return (
    <div className="mb-4 rounded-2xl bg-ink p-4 text-cream">
      <p className="text-xs font-bold uppercase tracking-wide text-cream/60">Drawer should have right now</p>
      <p className="font-display text-3xl font-extrabold tabular-nums">{usd(n.expected_cash)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between"><dt className="text-cream/60">{l}</dt><dd className="tabular-nums">{usd(v)}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-cream/50">Count the drawer any time and compare — a lower count means cash is short by the difference.</p>
    </div>
  );
}

function Drops({ branch }: { branch: number }) {
  const [tick, setTick] = useState(0);
  const { data, reload: reloadList } = useLoad(() => manageApi.drops({ period: "today", branch }), [branch]);
  const reload = () => { reloadList(); setTick((t) => t + 1); };
  const [f, setF] = useState({ kind: "safe_drop", amount: "", note: "", witnessed_by: "" });
  const [err, setErr] = useState<string | null>(null);
  const preview = useLoad(() => manageApi.closePreview(branch, localDateISO()), [branch, tick]);
  const inDrawer = parseFloat(preview.data?.numbers?.expected_cash ?? "NaN");
  const takesOut = f.kind !== "paid_in";
  const over = takesOut && !Number.isNaN(inDrawer) && parseFloat(f.amount) > inDrawer + 1e-9;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (over) { setErr(`Only ${usd(inDrawer)} should be in the drawer — you can't take out more.`); return; }
    try { await manageApi.addDrop({ ...f, branch }); setF({ ...f, amount: "", note: "" }); reload(); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Card title="💵 Cash drops & paid outs (today)">
      <DrawerNow branch={branch} tick={tick} />
      <form onSubmit={add} className="grid grid-cols-2 gap-2">
        <select className="input !py-2" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="safe_drop">Drop to safe</option><option value="paid_out">Paid out (petty cash)</option><option value="paid_in">Paid in (cash added)</option>
        </select>
        <input className={`input !py-2 ${over ? "!border-flame text-flame" : ""}`} type="number" step="0.01" min="0.01" required
          max={takesOut && !Number.isNaN(inDrawer) ? inDrawer.toFixed(2) : undefined}
          placeholder={takesOut && !Number.isNaN(inDrawer) ? `Amount (up to ${usd(inDrawer)})` : "Amount"} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input className="input !py-2" placeholder="Note (e.g. ice delivery)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <input className="input !py-2" placeholder="Witness" value={f.witnessed_by} onChange={(e) => setF({ ...f, witnessed_by: e.target.value })} />
        <button className="btn-dark col-span-2 !py-2" disabled={over}>{over ? `More than the drawer has (${usd(inDrawer)})` : "Record"}</button>
      </form>
      <ErrorBox error={err} />
      <ul className="mt-3 divide-y divide-ink/5 text-sm">
        {data?.length === 0 && <Empty>Nothing recorded today</Empty>}
        {data && data.length > 0 && (
          <li className="flex justify-between py-2 text-xs font-semibold text-ink-soft">
            <span>Today: out {usd(data.filter((x) => x.kind === "paid_out").reduce((t, x) => t + parseFloat(x.amount), 0))} · in {usd(data.filter((x) => x.kind === "paid_in").reduce((t, x) => t + parseFloat(x.amount), 0))} · to safe {usd(data.filter((x) => x.kind === "safe_drop").reduce((t, x) => t + parseFloat(x.amount), 0))}</span>
            <span>Full history below ↓</span>
          </li>
        )}
        {data?.slice(0, 4).map((x) => (
          <li key={x.id} className="flex justify-between py-2">
            <span>{x.kind_display}{x.note && <span className="text-ink-soft"> · {x.note}</span>}<span className="block text-xs text-ink-soft">{dt(x.created_at)} · {x.made_by_name}{x.witnessed_by && ` · witness ${x.witnessed_by}`}</span></span>
            <b className="tabular-nums">{usd(x.amount)}</b>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- deposits

function Deposits({ branch, canVerify, canEdit }: { branch: number; canVerify: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState<Deposit | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const period = usePeriod("month");
  const { data, reload: reloadList } = useLoad(() => manageApi.deposits({ ...period.params, branch }), [branch, period.key]);
  const safe = useLoad(() => manageApi.safeCash(branch), [branch]);
  const reload = () => { reloadList(); safe.reload(); };
  const inSafe = parseFloat(safe.data?.in_safe ?? "NaN");
  const [f, setF] = useState({ date: localDateISO(), amount: "", bank_name: "", account_last4: "", slip_number: "", covers_from: "", covers_to: "", note: "" });
  const [slip, setSlip] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!Number.isNaN(inSafe) && parseFloat(f.amount) > inSafe + 1e-9) { setErr(`Only ${usd(inSafe)} cash is in the safe — you can't deposit more.`); return; }
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
    fd.append("branch", String(branch));
    if (slip) fd.append("slip", slip);
    try { await manageApi.addDeposit(fd); setShow(false); setF({ ...f, amount: "", slip_number: "", note: "" }); reload(); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Card title="🏦 Bank deposits" action={<div className="flex gap-2"><PeriodPicker value={period.value} onChange={period.setValue} /><button className="btn-dark !px-3 !py-1.5 text-sm" onClick={() => setShow(!show)}>+ Add</button></div>}>
      {!Number.isNaN(inSafe) && (
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-cream">
          <span className="text-sm"><span className="block text-[11px] font-bold uppercase tracking-wide text-cream/60">Cash in the safe — ready to deposit</span>
            closed days + safe drops − earlier deposits</span>
          <b className="font-display text-2xl tabular-nums">{usd(inSafe)}</b>
        </div>
      )}
      {show && (
        <form onSubmit={add} className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-cream p-3">
          <Field label="Date"><input type="date" className="input !py-1.5" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Amount" hint={!Number.isNaN(inSafe) ? `Up to ${usd(inSafe)}` : undefined}>
            <input type="number" step="0.01" min="0.01" max={!Number.isNaN(inSafe) ? inSafe.toFixed(2) : undefined} required
              className={`input !py-1.5 ${!Number.isNaN(inSafe) && parseFloat(f.amount) > inSafe ? "!border-flame text-flame" : ""}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Bank"><input className="input !py-1.5" value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} /></Field>
          <Field label="Account (last 4 only)"><input className="input !py-1.5" maxLength={4} inputMode="numeric" value={f.account_last4} onChange={(e) => setF({ ...f, account_last4: e.target.value })} /></Field>
          <Field label="Slip #"><input className="input !py-1.5" value={f.slip_number} onChange={(e) => setF({ ...f, slip_number: e.target.value })} /></Field>
          <Field label="Slip photo"><input type="file" accept="image/*,application/pdf" capture="environment" className="text-xs" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Sales from"><input type="date" className="input !py-1.5" value={f.covers_from} onChange={(e) => setF({ ...f, covers_from: e.target.value })} /></Field>
          <Field label="Sales to"><input type="date" className="input !py-1.5" value={f.covers_to} onChange={(e) => setF({ ...f, covers_to: e.target.value })} /></Field>
          <button className="btn-primary col-span-2 !py-2" disabled={!Number.isNaN(inSafe) && parseFloat(f.amount) > inSafe}>
            {!Number.isNaN(inSafe) && parseFloat(f.amount) > inSafe ? `More than the safe has (${usd(inSafe)})` : "Save deposit"}</button>
          <div className="col-span-2"><ErrorBox error={err} /></div>
        </form>
      )}
      {msg && <p className="mb-2 rounded-xl bg-leaf/10 p-2 text-sm text-leaf">{msg}</p>}
      {editing && <EditDeposit x={editing} onClose={() => setEditing(null)} onSent={(m) => { setEditing(null); setMsg(m); reload(); }} />}
      <ul className="divide-y divide-ink/5 text-sm">
        {data?.length === 0 && <Empty>No deposits in this period</Empty>}
        {data?.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              {d(x.date)} · {x.bank_name || "Bank"}{x.account_last4 && ` ••${x.account_last4}`}{x.slip_number && ` · slip ${x.slip_number}`}
              <span className="block text-xs text-ink-soft">by {x.deposited_by_name}{x.covers_from && ` · sales ${d(x.covers_from)}–${d(x.covers_to ?? x.covers_from)}`}
                {x.slip_url && <> · <a href={x.slip_url} target="_blank" rel="noreferrer" className="underline">slip</a></>}</span>
            </span>
            <span className="text-right">
              <b className="tabular-nums">{usd(x.amount)}</b>
              {canEdit && <button className="ml-2 text-xs font-semibold text-ink-soft hover:text-flame" onClick={() => setEditing(x)}>Edit</button>}
              <span className="block text-xs">{x.verified_by_name ? <span className="text-leaf">✓ {x.verified_by_name}</span>
                : canVerify ? <button className="font-semibold text-flame" onClick={async () => { await manageApi.verifyDeposit(x.id); reload(); }}>Verify</button>
                : <span className="text-ink-soft">unverified</span>}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EditDeposit({ x, onClose, onSent }: { x: Deposit; onClose: () => void; onSent: (m: string) => void }) {
  const [f, setF] = useState({ date: x.date, amount: x.amount, bank_name: x.bank_name, account_last4: x.account_last4, slip_number: x.slip_number, note: x.note });
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    setErr(null);
    try { onSent(changeMessage(await manageApi.editDeposit(x.id, { ...f, change_reason: reason }))); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Modal title={`Edit deposit · ${d(x.date)}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className="input !py-2" value={f.date} onChange={set("date")} /></Field>
        <Field label="Amount"><input type="number" step="0.01" className="input !py-2" value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Bank"><input className="input !py-2" value={f.bank_name} onChange={set("bank_name")} /></Field>
        <Field label="Account last 4"><input className="input !py-2" maxLength={4} value={f.account_last4} onChange={set("account_last4")} /></Field>
        <Field label="Slip #"><input className="input !py-2" value={f.slip_number} onChange={set("slip_number")} /></Field>
        <Field label="Note"><input className="input !py-2" value={f.note} onChange={set("note")} /></Field>
      </div>
      <input className="input mt-3" placeholder="Why are you changing it? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="mt-2 text-xs text-ink-soft">Only super admins and admins change deposits. A super admin’s change needs the admin’s approval.</p>
      <ErrorBox error={err} />
      <button className="btn-primary mt-3 w-full" disabled={!reason.trim()} onClick={send}>Save change</button>
      <div className="mt-4 border-t border-ink/10 pt-3"><p className="mb-1 text-sm font-semibold">History</p><RecordHistory model="bank deposit" id={x.id} /></div>
    </Modal>
  );
}

const KIND_STYLE: Record<string, string> = { paid_out: "bg-flame/15 text-flame", paid_in: "bg-leaf/15 text-leaf", safe_drop: "bg-ink/10" };

function DropHistory({ branch }: { branch: number }) {
  const period = usePeriod("month");
  const [kind, setKind] = useState("");
  const { data } = useLoad(() => manageApi.drops({ ...period.params, branch }), [branch, period.key]);
  const list = (data ?? []).filter((x) => !kind || x.kind === kind);
  const sum = (k: string) => (data ?? []).filter((x) => x.kind === k).reduce((t, x) => t + parseFloat(x.amount), 0);
  return (
    <Card title="🧾 Paid outs, paid ins & safe drops — history"
      action={<div className="flex flex-wrap gap-2">
        <Select size="sm" value={kind} onChange={setKind} options={[{ value: "", label: "All kinds" }, { value: "paid_out", label: "Paid out", icon: "➖" },
          { value: "paid_in", label: "Paid in", icon: "➕" }, { value: "safe_drop", label: "Drop to safe", icon: "🔒" }]} />
        <PeriodPicker value={period.value} onChange={period.setValue} /></div>}>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Paid out (leaves the drawer)" value={usd(sum("paid_out"))} tone={sum("paid_out") ? "bad" : "default"} />
        <Stat label="Paid in (added to the drawer)" value={usd(sum("paid_in"))} tone={sum("paid_in") ? "good" : "default"} />
        <Stat label="Dropped to safe" value={usd(sum("safe_drop"))} />
      </div>
      {list.length === 0 ? <Empty>Nothing in this period.</Empty> : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b-2 border-ink/10 text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2.5">When</th><th className="px-3">Kind</th><th className="px-3">Note</th><th className="px-3">By</th><th className="px-3">Witness</th><th className="px-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {list.map((x) => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap px-3 py-2.5">{dt(x.created_at)}</td>
                  <td className="px-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${KIND_STYLE[x.kind] ?? ""}`}>{x.kind_display}</span></td>
                  <td className="px-3">{x.note || "—"}</td><td className="px-3">{x.made_by_name}</td><td className="px-3">{x.witnessed_by || "—"}</td>
                  <td className={`px-3 text-right font-bold tabular-nums ${x.kind === "paid_out" ? "text-flame" : x.kind === "paid_in" ? "text-leaf" : ""}`}>
                    {x.kind === "paid_out" || x.kind === "safe_drop" ? "−" : "+"}{usd(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-soft">Paid outs, cash purchases and safe drops are taken off the expected cash; paid ins are added. That is what the over / short is measured against at closing.</p>
    </Card>
  );
}

function PastCloses({ branch }: { branch: number }) {
  const { user } = usePosAuth();
  const period = usePeriod("month");
  const { data, reload } = useLoad(() => manageApi.closes({ ...period.params, branch }), [branch, period.key]);
  const [editing, setEditing] = useState<DailyClose | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const H = "px-3 py-2.5 font-semibold";
  return (
    <Card title="📒 Closing history" action={<PeriodPicker value={period.value} onChange={period.setValue} />}>
      {msg && <p className="mb-3 rounded-xl bg-leaf/10 p-2 text-sm text-leaf">{msg}</p>}
      {data?.length === 0 ? <Empty>No closings in this period</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b-2 border-ink/10 text-xs uppercase tracking-wide text-ink-soft">
                <th className={`${H} text-left`}>Date</th>
                <th className={`${H} text-right`}>Sales</th>
                <th className={`${H} text-right`}>Float</th>
                <th className={`${H} text-right`}>+ Cash sales</th>
                <th className={`${H} text-right`}>− Refunds</th>
                <th className={`${H} text-right`}>− Paid out</th>
                <th className={`${H} text-right`}>+ Paid in</th>
                <th className={`${H} text-right`}>− To safe</th>
                <th className={`${H} text-right`}>= Expected</th>
                <th className={`${H} text-right`}>Counted</th>
                <th className={`${H} text-right`}>Over / short</th>
                <th className={`${H} text-right`}>To deposit</th>
                <th className={`${H} text-left`}>Closed by</th>
                <th className={`${H} w-20`} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data?.map((c) => {
                const os = parseFloat(c.over_short);
                const can = !!user && canEditEntry(user.level, c.closed_by_level, c.closed_by === user.id);
                return (
                  <tr key={c.id} className="hover:bg-cream/60">
                    <td className="whitespace-nowrap px-3 py-3 font-semibold">{d(c.date)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{usd(c.total_sales)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{usd(c.opening_float)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{usd(c.cash_sales)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{usd(c.cash_refunds)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${parseFloat(c.paid_outs) ? "text-flame" : "text-ink-soft"}`}>{usd(c.paid_outs)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${parseFloat(c.paid_ins) ? "text-leaf" : "text-ink-soft"}`}>{usd(c.paid_ins)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{usd(c.safe_drops)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{usd(c.expected_cash)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{usd(c.counted_cash)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${Math.abs(os) < 0.01 ? "bg-leaf/15 text-leaf" : Math.abs(os) >= 5 ? "bg-flame/15 text-flame" : "bg-mustard/30"}`}>
                        {os > 0 ? "+" : ""}{usd(os)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">{usd(c.cash_to_deposit)}</td>
                    <td className="px-3 py-3">
                      {c.closed_by_name}
                      {c.edited_by_name && <span className="block text-xs text-ink-soft">edited by {c.edited_by_name}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button className="rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setEditing(c)}>
                        {can ? "Edit" : "History"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (canEditEntry(user?.level ?? 0, editing.closed_by_level, editing.closed_by === user?.id)
        ? <EditClose c={editing} onClose={() => setEditing(null)} onSent={(m) => { setEditing(null); setMsg(m); reload(); }} />
        : <Modal title={`Closing · ${d(editing.date)}`} onClose={() => setEditing(null)}><RecordHistory model="daily close" id={editing.id} /></Modal>)}
    </Card>
  );
}
