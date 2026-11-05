"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useEffect, useState } from "react";
import { HistoryList } from "@/components/manage/ChangeViews";
import { Badge, Card, d, dt, Empty, ErrorBox, Field, Modal, PageHeader, Stat, useBranchFilter, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { localDateISO } from "@/lib/pos";
import { canEditEntry, changeMessage, downloadWithToken, manageApi, type PayrollRow, type SalaryRow, type SalaryWeek, type TimeEntry } from "@/lib/manage";

function monday(date: Date) {
  const x = new Date(date);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (x: Date, n: number) => { const y = new Date(x); y.setDate(y.getDate() + n); return y; };
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

export default function PayrollPage() {
  const [tab, setTab] = useState<"hours" | "salary">("salary");
  const { branch, picker } = useBranchFilter();
  const tabs = (
    <div className="mb-4 flex gap-2">
      {([["salary", "💵 Salary · paid & unpaid"], ["hours", "⏱ Hours by week"]] as const).map(([k, l]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>{l}</button>
      ))}
    </div>
  );
  if (tab === "salary") return <SalaryView tabs={tabs} branch={branch} picker={picker} />;
  return <HoursView tabs={tabs} branch={branch} picker={picker} />;
}

function HoursView({ tabs, branch, picker }: { tabs: React.ReactNode; branch: number | null; picker: React.ReactNode }) {
  const [weekStart, setWeekStart] = useState(monday(new Date()));
  const from = localDateISO(weekStart);
  const to = localDateISO(addDays(weekStart, 6));
  const { data, error } = useLoad(() => manageApi.payroll({ from, to, branch }), [from, branch]);
  const [person, setPerson] = useState<PayrollRow | null>(null);
  const ot = (data?.rows ?? []).reduce((s, r) => s + parseFloat(r.overtime_hours), 0);

  return (
    <div>
      <PageHeader title="Hours & wages" sub="Weekly hours, overtime (1.5× after 40 hours) and gross pay. Taxes are handled by your payroll provider.">
        {picker}
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-3 !py-2" onClick={() => setWeekStart(addDays(weekStart, -7))}>←</button>
          <span className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-ink/10">{d(from)} – {d(to)}</span>
          <button className="btn-ghost !px-3 !py-2" onClick={() => setWeekStart(addDays(weekStart, 7))}>→</button>
        </div>
        <button className="btn-dark !py-2" onClick={() => downloadWithToken(manageApi.payrollCsvUrl({ from, to, branch }), `payroll_${from}.csv`)}>⬇ CSV for payroll</button>
      </PageHeader>
      {tabs}
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Gross wages" value={usd(data.total_gross)} tone="dark" />
            <Stat label="Hours worked" value={data.total_hours} />
            <Stat label="Overtime hours" value={ot.toFixed(2)} tone={ot > 0 ? "bad" : "default"} />
          </div>
          <Card>
            {data.rows.length === 0 ? <Empty>No staff.</Empty> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ink-soft">
                  <tr><th className="py-2">Employee</th><th>Branch</th><th>Pay</th><th className="text-right">Shifts</th><th className="text-right">Hours</th>
                    <th className="text-right">OT hrs</th><th className="text-right">Regular</th><th className="text-right">Overtime</th><th className="text-right">Tips</th><th className="text-right">Gross</th><th className="pl-4">Paid by</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {data.rows.map((r) => (
                    <tr key={r.staff_id} onClick={() => setPerson(r)} className="cursor-pointer hover:bg-cream">
                      <td className="py-2.5 font-semibold">{r.name}<span className="block text-xs font-normal text-ink-soft">{r.employee_id} · {r.role}</span></td>
                      <td>{r.branch}</td>
                      <td className="tabular-nums">{r.pay_type.startsWith("Salary") ? `${usd(r.weekly_salary)}/wk` : `${usd(r.rate)}/hr`}</td>
                      <td className="text-right tabular-nums">{r.shifts}</td><td className="text-right tabular-nums">{r.hours}</td>
                      <td className={`text-right tabular-nums ${parseFloat(r.overtime_hours) > 0 ? "font-bold text-flame" : ""}`}>{r.overtime_hours}</td>
                      <td className="text-right tabular-nums">{usd(r.regular_pay)}</td><td className="text-right tabular-nums">{usd(r.overtime_pay)}</td>
                      <td className="text-right tabular-nums">{usd(r.tips)}</td><td className="text-right font-bold tabular-nums">{usd(r.gross_pay)}</td><td className="pl-4">{r.pay_method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="mt-3 text-xs text-ink-soft">Click someone to see or fix their clock-ins. Gross pay = regular hours × rate + overtime hours × rate × 1.5 (salary: weekly amount). Tips are shown separately.</p>
        </>
      )}
      {person && <Shifts row={person} from={from} to={to} onClose={() => setPerson(null)} />}
    </div>
  );
}

function Shifts({ row, from, to, onClose }: { row: PayrollRow; from: string; to: string; onClose: () => void }) {
  const { user } = usePosAuth();
  const { data, reload } = useLoad(() => manageApi.time({ from, to, staff: row.staff_id }), [row.staff_id, from]);
  const [edit, setEdit] = useState<TimeEntry | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"shifts" | "history">("shifts");
  const history = useLoad(() => (tab === "history" ? manageApi.history({ model: "clock-in", q: row.name }) : Promise.resolve([])), [tab, row.staff_id, from]);
  const isMe = row.employee_id === user?.employee_id;
  const can = (e: TimeEntry) => !!user && canEditEntry(user.level, e.staff_level, isMe);
  const canAdd = !!user && (user.level >= 5 || (!isMe && (data?.[0] ? user.level > data[0].staff_level : user.level >= 2)));
  const total = (data ?? []).reduce((s, e) => s + parseFloat(e.hours), 0);

  return (
    <Modal title={`${row.name} · shifts`} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["shifts", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
            {t === "shifts" ? "⏱ Shifts" : "🕘 Change history"}</button>
        ))}
        <span className="ml-auto text-sm text-ink-soft">{d(from)} – {d(to)} · <b className="text-ink">{total.toFixed(2)} h</b></span>
      </div>
      {msg && <p className="mb-3 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{msg}</p>}
      {isMe && (user?.level ?? 0) < 5 && <p className="mb-3 rounded-xl bg-mustard/25 p-3 text-sm">These are your own shifts — someone in a higher role has to correct them.</p>}
      {(user?.level ?? 0) >= 5 && <p className="mb-3 rounded-xl bg-leaf/10 p-3 text-sm text-leaf">As admin you can edit or add any shift — it&apos;s saved right away.</p>}

      {tab === "history" ? (history.data ? <HistoryList items={history.data} /> : <p className="text-sm text-ink-soft">Loading…</p>) : (
        <>
          {data?.length === 0 && <Empty>No clock-ins this week.</Empty>}
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink/5">
            {data?.map((e) => (
              <div key={e.id} className="grid grid-cols-[1fr_1fr_80px_80px_70px] items-center gap-3 border-b border-ink/5 px-4 py-3 text-sm last:border-0">
                <div>
                  <p className="text-[11px] font-bold uppercase text-ink-soft">In</p>
                  <p className="font-semibold">{dt(e.clock_in)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase text-ink-soft">Out</p>
                  <p className="font-semibold">{e.clock_out ? dt(e.clock_out) : <span className="text-leaf">● On shift</span>}</p>
                </div>
                <div className="text-right"><p className="text-[11px] font-bold uppercase text-ink-soft">Hours</p><p className="font-bold tabular-nums">{e.hours}</p></div>
                <div className="text-right"><p className="text-[11px] font-bold uppercase text-ink-soft">Tips</p><p className="tabular-nums">{usd(e.tips)}</p></div>
                <div className="text-right">
                  {can(e) ? <button className="rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setEdit(e)}>Edit</button>
                    : <span className="text-xs text-ink-soft">—</span>}
                </div>
                {(e.note || e.edited_by_name) && (
                  <p className="col-span-full -mt-1 text-xs text-ink-soft">{e.branch_name}{e.note && ` · “${e.note}”`}{e.edited_by_name && ` · last changed by ${e.edited_by_name}`}</p>
                )}
              </div>
            ))}
          </div>
          {canAdd && <button className="btn-ghost mt-3 !py-2 text-sm" onClick={() => setEdit("new")}>+ Add a missed shift</button>}
        </>
      )}
      {edit && (
        <ShiftEditor e={edit === "new" ? null : edit} staffId={row.staff_id} name={row.name} defaultBranch={data?.[0]?.branch ?? user?.branch?.id ?? null}
          onClose={() => setEdit(null)} onSent={(m) => { setEdit(null); setMsg(m); reload(); }} />
      )}
    </Modal>
  );
}

function ShiftEditor({ e, staffId, name, defaultBranch, onClose, onSent }: {
  e: TimeEntry | null; staffId: number; name: string; defaultBranch: number | null; onClose: () => void; onSent: (m: string) => void;
}) {
  const { user } = usePosAuth();
  const [cin, setCin] = useState(toLocalInput(e?.clock_in ?? null));
  const [cout, setCout] = useState(toLocalInput(e?.clock_out ?? null));
  const [tips, setTips] = useState(e?.tips ?? "0");
  const [reason, setReason] = useState("");
  const [branch, setBranch] = useState<number | null>(e?.branch ?? defaultBranch);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hours = cin && cout ? (new Date(cout).getTime() - new Date(cin).getTime()) / 3_600_000 : null;

  const send = async (del = false) => {
    if (!reason.trim()) { setErr("Say why this is being changed."); return; }
    if (!del && hours !== null && hours <= 0) { setErr("Clock-out must be after clock-in."); return; }
    setBusy(true); setErr(null);
    try {
      const body = { clock_in: new Date(cin).toISOString(), clock_out: cout ? new Date(cout).toISOString() : null, tips: tips || "0", reason };
      const cr = del ? await manageApi.deleteTime(e!.id, reason)
        : e ? await manageApi.updateTime(e.id, body)
        : await manageApi.addTime({ ...body, staff: staffId, branch });
      onSent(changeMessage(cr));
    } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-cream p-6 shadow-2xl" onClick={(x) => x.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-2xl font-extrabold">{e ? "Edit shift" : "Add missed shift"}</h3>
            <p className="text-sm text-ink-soft">{name}{e && ` · was ${dt(e.clock_in)} → ${e.clock_out ? dt(e.clock_out) : "on shift"}`}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/10">✕</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clock in"><input type="datetime-local" className="input" value={cin} onChange={(x) => setCin(x.target.value)} /></Field>
          <Field label="Clock out" hint="Leave empty if still on shift"><input type="datetime-local" className="input" value={cout} onChange={(x) => setCout(x.target.value)} /></Field>
          <Field label="Cash tips ($)"><input type="number" step="0.01" min="0" className="input" value={tips} onChange={(x) => setTips(x.target.value)} /></Field>
          {!e && (user?.branches.length ?? 0) > 1 ? (
            <Field label="Store">
              <select className="input" value={branch ?? ""} onChange={(x) => setBranch(Number(x.target.value))}>
                {user!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : (
            <div className="rounded-2xl bg-white p-3 text-center ring-1 ring-ink/5">
              <p className="text-[11px] font-bold uppercase text-ink-soft">Shift length</p>
              <p className="font-display text-2xl font-extrabold tabular-nums">{hours !== null && hours > 0 ? `${hours.toFixed(2)} h` : "—"}</p>
            </div>
          )}
          <div className="sm:col-span-2">
            <Field label="Why is it changing?"><input className="input" placeholder="Forgot to clock out at close" value={reason} onChange={(x) => setReason(x.target.value)} /></Field>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-soft">{(user?.level ?? 0) >= 5 ? "As admin, this is saved right away." : "This goes to the next role up for approval before the hours change."}</p>
        <ErrorBox error={err} />
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {e ? <button className="btn-ghost !py-2 text-flame" disabled={busy} onClick={() => send(true)}>🗑 Remove shift</button> : <span />}
          <div className="flex gap-2">
            <button className="btn-ghost !py-2" onClick={onClose}>Cancel</button>
            <button className="btn-primary !py-2" disabled={busy || !cin} onClick={() => send()}>{e ? "Send change" : "Add shift"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- salary: running week, history, paid / unpaid

const STATUS: Record<SalaryWeek["status"], { label: string; cls: string }> = {
  running: { label: "● Running", cls: "bg-mustard/40 text-ink" },
  paid: { label: "✓ Paid", cls: "bg-leaf/15 text-leaf" },
  partial: { label: "Part paid", cls: "bg-mustard/40 text-ink" },
  unpaid: { label: "Unpaid", cls: "bg-flame/15 text-flame" },
};
const METHOD_LABEL: Record<string, string> = { cash: "💵 Cash", check: "🧾 Check", direct_deposit: "🏦 Direct deposit" };

function PayFrequency({ onChanged }: { onChanged: () => void }) {
  const { user } = usePosAuth();
  const { data, setData } = useLoad(() => manageApi.paySettings(), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ frequency: "weekly", anchor: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setF({ frequency: data.frequency, anchor: data.anchor }); }, [data]);
  if (!data) return null;
  const save = async () => {
    setErr(null);
    try { setData(await manageApi.savePaySettings(f)); setOpen(false); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <>
      <button className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-ink/10" onClick={() => (user?.level ?? 0) >= 5 && setOpen(true)}
        title={(user?.level ?? 0) >= 5 ? "Change pay frequency" : "Set by the admin"}>
        📅 Paid {data.frequency_display.toLowerCase()} · now {d(data.current.from).replace(/, \d{4}$/, "")} – {d(data.current.to)}
      </button>
      {open && (
        <Modal title="Pay frequency" onClose={() => setOpen(false)}>
          <div className="grid grid-cols-2 gap-2">
            {([["weekly", "Every week"], ["biweekly", "Every 2 weeks"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setF({ ...f, frequency: k })}
                className={`rounded-2xl p-4 text-left font-bold ring-2 ${f.frequency === k ? "bg-cream ring-flame" : "bg-white ring-ink/10"}`}>{l}</button>
            ))}
          </div>
          {f.frequency === "biweekly" && (
            <Field label="A Monday that starts a pay period" hint="Pick the first day of any past or current 2-week pay period.">
              <input type="date" className="input !py-2" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value })} />
            </Field>
          )}
          <p className="mt-3 text-xs text-ink-soft">Overtime is still worked out per week (over 40 h in a Mon–Sun week), so a 2-week period is never off from the weeks inside it. Weeks already marked paid are added into the 2-week period.</p>
          <ErrorBox error={err} />
          <button className="btn-primary mt-4 w-full" onClick={save}>Save</button>
        </Modal>
      )}
    </>
  );
}

function SalaryView({ tabs, branch, picker }: { tabs: React.ReactNode; branch: number | null; picker: React.ReactNode }) {
  const { user } = usePosAuth();
  const [weeks, setWeeks] = useState(8);
  const [filter, setFilter] = useState<"all" | "unpaid">("all");
  const { data, error, reload } = useLoad(() => manageApi.salary({ weeks, branch }), [weeks, branch]);
  const [open, setOpen] = useState<number | null>(null);
  const [mark, setMark] = useState<{ row: SalaryRow; week: SalaryWeek; paid: boolean } | null>(null);
  const [hours, setHours] = useState<{ row: SalaryRow; week: SalaryWeek } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canHours = (r: SalaryRow) => !!user && (user.level >= 5 || (r.employee_id !== user.employee_id && user.level > r.level));
  const rows = (data?.rows ?? []).filter((r) => filter === "all" || r.unpaid_count > 0);
  const running = (data?.rows ?? []).reduce((s, r) => s + parseFloat(r.weeks[0]?.running ? r.weeks[0].gross_pay : "0"), 0);

  return (
    <div>
      <PageHeader title="Hours & wages" sub="Each person's running pay period, past periods and whether they were paid — in full, in part, or not yet. Paying (cash, check, deposit or a mix) is approved role-wise.">
        {picker}
        <PayFrequency onChanged={reload} />
        <Select value={String(weeks)} onChange={(v) => setWeeks(Number(v))}
          options={[4, 8, 12, 26].map((n) => ({ value: String(n), label: `Last ${n} ${data?.frequency === "biweekly" ? "pay periods" : "weeks"}`, icon: "🗓" }))} />
        <Select value={filter} onChange={(v) => setFilter(v as "all" | "unpaid")}
          options={[{ value: "all", label: "Everyone", icon: "👥" }, { value: "unpaid", label: "Only owed", icon: "⏳" }]} />
      </PageHeader>
      {tabs}
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      {data && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={`This ${data.frequency === "biweekly" ? "pay period" : "week"} so far (running)`} value={usd(running)} tone="dark" sub="before taxes" />
          <Stat label="Still owed" value={usd(data.unpaid_total)} tone={parseFloat(data.unpaid_total) > 0 ? "bad" : "good"}
                sub={`${(data.rows ?? []).reduce((s, r) => s + r.unpaid_count, 0)} periods unpaid or part paid`} />
          <Stat label="People" value={String(data.rows.length)} />
        </div>
      )}
      <div className="space-y-3">
        {rows.map((r) => {
          const now = r.weeks.find((w) => w.running);
          const isOpen = open === r.staff_id;
          return (
            <div key={r.staff_id} className="overflow-hidden rounded-3xl bg-white ring-1 ring-ink/5">
              <button onClick={() => setOpen(isOpen ? null : r.staff_id)} className="grid w-full grid-cols-2 items-center gap-3 px-4 py-4 text-left hover:bg-cream/50 sm:grid-cols-[1.4fr_1fr_1fr_1fr_24px] sm:px-5">
                <span className="col-span-2 sm:col-span-1">
                  <span className="font-bold">{r.name}</span>
                  <span className="block text-xs text-ink-soft">{r.employee_id} · {r.role} · {r.branch} · {r.pay_type}</span>
                </span>
                <span><span className="block text-[11px] font-bold uppercase text-ink-soft">Now (running)</span>
                  <span className="font-semibold tabular-nums">{now ? `${now.hours} h · ${usd(now.gross_pay)}` : "—"}</span></span>
                <span><span className="block text-[11px] font-bold uppercase text-ink-soft">Owed</span>
                  <span className={`font-semibold tabular-nums ${r.unpaid_count ? "text-flame" : "text-leaf"}`}>{r.unpaid_count ? `${usd(r.unpaid_total)} · ${r.unpaid_count} period${r.unpaid_count > 1 ? "s" : ""}` : "All paid ✓"}</span></span>
                <span className="hidden sm:block"><span className="block text-[11px] font-bold uppercase text-ink-soft">Paid by</span><span className="font-semibold">{r.pay_method}</span></span>
                <span className="hidden text-ink-soft sm:block">{isOpen ? "▴" : "▾"}</span>
              </button>
              {isOpen && (
                <div className="overflow-x-auto border-t border-ink/5 px-5 pb-4">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink-soft">
                      <th className="py-2.5">Pay period</th><th className="text-right">Hours</th><th className="text-right">OT</th><th className="text-right">Tips</th>
                      <th className="text-right">Gross</th><th className="text-right">Paid</th><th className="pl-5">Status</th><th>How it was paid</th><th className="text-right" /></tr></thead>
                    <tbody className="divide-y divide-ink/5">
                      {r.weeks.map((w) => (
                        <tr key={w.from}>
                          <td className="py-2.5 font-semibold">{d(w.from)} – {d(w.to)}</td>
                          <td className="text-right tabular-nums">{w.hours}</td>
                          <td className={`text-right tabular-nums ${parseFloat(w.overtime_hours) > 0 ? "font-bold text-flame" : ""}`}>{w.overtime_hours}</td>
                          <td className="text-right tabular-nums">{usd(w.tips)}</td>
                          <td className="text-right font-bold tabular-nums">{usd(w.gross_pay)}</td>
                          <td className="text-right tabular-nums">{w.running ? "—" : usd(w.paid_amount)}
                            {w.status === "partial" && <span className="block text-[11px] text-flame">owes {usd(w.balance)}</span>}</td>
                          <td className="pl-5">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[w.status].cls}`}>{STATUS[w.status].label}</span>
                            {w.pending && <span className="mt-1 block text-[11px] text-ink-soft">⏳ {w.pending.paid ? "Paid" : "Unpaid"} waiting for {w.pending.need_role}</span>}
                          </td>
                          <td className="text-xs">{w.payments.length ? <>
                              {w.payments.map((p, k) => <span key={k} className="block">{METHOD_LABEL[p.method] ?? p.method_display} {usd(p.amount)}{p.reference && ` #${p.reference}`}</span>)}
                              {w.paid_on && <span className="block text-ink-soft">on {d(w.paid_on)}</span>}</> : "—"}</td>
                          <td className="text-right">
                            <span className="inline-flex flex-wrap justify-end gap-1">
                            {canHours(r) && <button className="rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" title="Fix or add shifts in this period"
                              onClick={() => setHours({ row: r, week: w })}>✏️ Hours</button>}
                            {r.can_mark && !w.running && !w.pending && (
                              <span className="inline-flex gap-1">
                                {w.status !== "paid" && <button className="rounded-lg bg-leaf px-3 py-1.5 text-xs font-bold text-white" onClick={() => setMark({ row: r, week: w, paid: true })}>{w.status === "partial" ? "Pay / edit" : "Mark paid"}</button>}
                                {w.status === "paid" && <button className="rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-ink/10" onClick={() => setMark({ row: r, week: w, paid: true })}>Edit</button>}
                                {w.status !== "unpaid" && <button className="rounded-lg px-3 py-1.5 text-xs font-bold text-flame ring-1 ring-flame/30" onClick={() => setMark({ row: r, week: w, paid: false })}>Unpaid</button>}
                              </span>)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!r.can_mark && <p className="mt-2 text-xs text-ink-soft">{r.employee_id === user?.employee_id ? "This is your own pay — a higher role marks it." : "You can view but not change this person's pay."}</p>}
                </div>
              )}
            </div>
          );
        })}
        {data && rows.length === 0 && <Card><Empty>{filter === "unpaid" ? "Nobody has unpaid weeks 🎉" : "No staff."}</Empty></Card>}
      </div>
      <p className="mt-3 text-xs text-ink-soft">Gross = regular hours × rate + overtime × 1.5 (salary: weekly amount). Tips are shown separately. Taxes come from your payroll provider.</p>
      {mark && <MarkPay {...mark} level={user?.level ?? 0} onClose={() => setMark(null)} onSent={(m) => { setMark(null); setMsg(m); reload(); }} />}
      {hours && (
        <Shifts from={hours.week.from} to={hours.week.to} onClose={() => { setHours(null); reload(); }}
          row={{ staff_id: hours.row.staff_id, employee_id: hours.row.employee_id, name: hours.row.name, role: hours.row.role,
                 branch: hours.row.branch, pay_type: hours.row.pay_type, pay_method: hours.row.pay_method } as PayrollRow} />
      )}
    </div>
  );
}

function MarkPay({ row, week, paid, level, onClose, onSent }: {
  row: SalaryRow; week: SalaryWeek; paid: boolean; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const gross = parseFloat(week.gross_pay);
  const start = week.payments.length ? week.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference }))
    : [{ method: row.pay_method_key || "direct_deposit", amount: gross.toFixed(2), reference: "" }];
  const [parts, setParts] = useState(start);
  const [paidOn, setPaidOn] = useState(week.paid_on ?? localDateISO());
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = Math.round(parts.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) * 100) / 100;
  const left = Math.round((gross - total) * 100) / 100;
  const setPart = (i: number, p: Partial<(typeof parts)[number]>) => setParts(parts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      onSent(changeMessage(await manageApi.markSalary({ staff: row.staff_id, from: week.from, paid, paid_on: paidOn, change_reason: reason,
        ...(paid ? { payments: parts.filter((p) => parseFloat(p.amount) > 0).map((p) => ({ method: p.method, amount: parseFloat(p.amount).toFixed(2), reference: p.reference })) } : {}) })));
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  };
  return (
    <Modal title={paid ? "Record pay" : "Mark as unpaid"} onClose={onClose} wide={paid}>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/5">
        <p className="font-bold">{row.name}</p>
        <p className="text-sm text-ink-soft">{d(week.from)} – {d(week.to)} · {week.hours} h{parseFloat(week.overtime_hours) > 0 && ` (${week.overtime_hours} overtime)`} · tips {usd(week.tips)}</p>
        <p className="mt-1 font-display text-3xl font-extrabold">{usd(gross)} <span className="text-base font-semibold text-ink-soft">earned</span></p>
      </div>
      {paid && (
        <>
          <p className="mt-4 text-sm font-semibold">How it was paid <span className="font-normal text-ink-soft">— split it if part was cash, part check, part deposit</span></p>
          <div className="mt-2 space-y-2">
            {parts.map((p, i) => (
              <div key={i} className="grid grid-cols-[1.2fr_1fr_1.2fr_28px] items-end gap-2 rounded-2xl bg-white p-3 ring-1 ring-ink/10">
                <Field label="Method">
                  <select className="input !py-2" value={p.method} onChange={(e) => setPart(i, { method: e.target.value })}>
                    <option value="direct_deposit">🏦 Direct deposit</option><option value="check">🧾 Check</option><option value="cash">💵 Cash</option>
                  </select>
                </Field>
                <Field label="Amount ($)"><input className="input !py-2" type="number" step="0.01" min="0" value={p.amount} onChange={(e) => setPart(i, { amount: e.target.value })} /></Field>
                <Field label={p.method === "check" ? "Check #" : p.method === "direct_deposit" ? "Transfer ref (optional)" : "Note (optional)"}>
                  <input className="input !py-2" value={p.reference} onChange={(e) => setPart(i, { reference: e.target.value })} /></Field>
                <button className="pb-2 text-ink-soft hover:text-flame" onClick={() => setParts(parts.filter((_, j) => j !== i))} disabled={parts.length === 1}>✕</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button className="text-sm font-semibold text-flame" onClick={() => setParts([...parts, { method: "cash", amount: left > 0 ? left.toFixed(2) : "", reference: "" }])}>+ Add another part</button>
            <p className={`text-sm font-bold ${left < -0.004 ? "text-flame" : left > 0.004 ? "text-ink" : "text-leaf"}`}>
              Paid {usd(total)} of {usd(gross)} · {left > 0.004 ? `${usd(left)} still owed (part paid)` : left < -0.004 ? `${usd(-left)} too much` : "fully paid ✓"}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Paid on"><input type="date" className="input !py-2" max={localDateISO()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="input !py-2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </>
      )}
      {!paid && <input className="input mt-3" placeholder="Why is it unpaid? (e.g. check bounced)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <p className="mt-2 text-xs text-ink-soft">{level >= 5 ? "As admin, this is saved right away." : `Goes to a ${["", "", "supervisor", "super admin", "admin"][level]} for approval.`}</p>
      <ErrorBox error={err} />
      <button className={`${paid ? "btn-primary" : "btn-dark"} mt-4 w-full`} disabled={busy || (!paid && !reason.trim()) || (paid && (total <= 0 || left < -0.004))} onClick={send}>
        {paid ? (left > 0.004 ? `Save part payment (${usd(total)})` : "Save as paid") : "Mark unpaid"}</button>
    </Modal>
  );
}
