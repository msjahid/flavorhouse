"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Card, d, dt, Empty, ErrorBox, Field, Stat, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { posApi, type ClockStatus } from "@/lib/pos";
import { manageApi, type MyProfile } from "@/lib/manage";

const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function LiveShift() {
  const [st, setSt] = useState<ClockStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    posApi.clockStatus().then(setSt).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!st) return null;
  return st.clocked_in && st.since ? (
    <div className="rounded-3xl bg-leaf p-5 text-white">
      <p className="text-xs font-bold uppercase tracking-wide text-white/70">On shift now · {st.branch}</p>
      <p className="font-display text-5xl font-extrabold tabular-nums">{hms(now - new Date(st.since).getTime())}</p>
      <p className="text-sm text-white/80">Since {new Date(st.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · clock out on a store register</p>
    </div>
  ) : (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Not clocked in</p>
      <p className="font-display text-2xl font-extrabold">Today {st.today_hours} h · week {st.week_hours ?? "0"} h</p>
      <p className="text-sm text-ink-soft">Clock in on a registered store device.</p>
    </div>
  );
}

export default function MePage() {
  const { user } = usePosAuth();
  const prof = useLoad(() => manageApi.me(), []);
  const earn = useLoad(() => manageApi.myEarnings(), []);

  if (prof.error) {
    return <Card><p className="text-sm">{prof.error}</p><p className="mt-2 text-sm text-ink-soft">The owner account has no staff profile — add yourself as staff to use this page.</p></Card>;
  }
  const p = prof.data;
  const wk = earn.data?.this_week;
  return (
    <div className="space-y-4">
      {p && <ProfileHeader p={p} onSaved={prof.reload} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <LiveShift />
        {wk && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Hours this week" value={wk.hours} sub={parseFloat(wk.overtime_hours) > 0 ? `${wk.overtime_hours} overtime` : `${d(wk.from)} – ${d(wk.to)}`} />
            <Stat label="Tips" value={usd(wk.tips)} />
            <Stat label="Est. gross" value={usd(wk.gross_pay)} tone="dark" sub="before taxes" />
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="💵 My pay by pay period">
          {earn.data?.weeks.length === 0 ? <Empty>No pay yet.</Empty> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
                <th className="py-2">Week</th><th className="px-2 text-right">Hours</th><th className="px-2 text-right">Tips</th><th className="px-2 text-right">Gross</th><th className="pl-3">Status</th></tr></thead>
              <tbody className="divide-y divide-ink/5">
                {earn.data?.weeks.map((w) => (
                  <tr key={w.from}>
                    <td className="py-2.5 pr-2">{d(w.from).replace(/, \d{4}$/, "")} – {d(w.to)}</td>
                    <td className="px-2 text-right tabular-nums">{w.hours}</td>
                    <td className="px-2 text-right tabular-nums">{usd(w.tips)}</td>
                    <td className="px-2 text-right font-bold tabular-nums">{usd(w.gross_pay)}</td>
                    <td className="pl-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${w.status === "paid" ? "bg-leaf/15 text-leaf" : w.status === "running" || w.status === "partial" ? "bg-mustard/40" : "bg-flame/15 text-flame"}`}>
                        {w.status === "paid" ? "✓ Paid" : w.status === "running" ? "● Now" : w.status === "partial" ? `Part paid ${usd(w.paid_amount)}` : "Unpaid"}</span>
                      {w.payments.length > 0 && <span className="block text-[11px] text-ink-soft">{w.payments.map((p) => `${p.method_display} ${usd(p.amount)}`).join(" + ")}{w.paid_on && ` · ${d(w.paid_on)}`}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-ink-soft">Gross pay before taxes. Your pay stubs with tax details come from the payroll provider.</p>
        </Card>
        <Card title="⏱ Recent shifts">
          {earn.data?.shifts.length === 0 ? <Empty>No shifts yet.</Empty> : (
            <ul className="divide-y divide-ink/5 text-sm">
              {earn.data?.shifts.slice(0, 15).map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{dt(e.clock_in)} → {e.clock_out ? new Date(e.clock_out).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : <b className="text-leaf">on shift</b>}
                    <span className="block text-xs text-ink-soft">{e.branch_name}{e.edited_by_name && ` · corrected by ${e.edited_by_name}`}</span></span>
                  <span className="text-right"><b className="tabular-nums">{e.hours} h</b>{parseFloat(e.tips) > 0 && <span className="block text-xs">tips {usd(e.tips)}</span>}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-soft">Something wrong? Ask your manager — they can correct it (it’s then approved by the next role up).</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {p && <EditProfile p={p} onSaved={prof.reload} />}
        <ChangePassword />
      </div>
      {user && <p className="text-center text-xs text-ink-soft">Signed in as {user.employee_id} · {user.role_display}</p>}
    </div>
  );
}

function ProfileHeader({ p, onSaved }: { p: MyProfile; onSaved: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setErr("Photo must be under 5 MB."); return; }
    const fd = new FormData();
    fd.append("photo", f);
    try { await manageApi.saveMe(fd); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
  };
  const name = p.preferred_name || p.first_name;
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-3xl bg-ink p-6 text-cream">
      <button onClick={() => file.current?.click()} className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-full ring-4 ring-mustard" title="Change photo">
        {p.photo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.photo_url} alt="" className="h-full w-full object-cover" />
          : <span className="grid h-full w-full place-items-center bg-mustard font-display text-3xl font-extrabold text-ink">{p.first_name[0]}{p.last_name[0] ?? ""}</span>}
        <span className="absolute inset-0 grid place-items-center bg-ink/60 text-xs font-bold opacity-0 transition group-hover:opacity-100">📷 Change</span>
      </button>
      <input ref={file} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-3xl font-extrabold">Hi, {name} 👋</p>
        <p className="text-cream/70">{p.job_title || p.role_display} · {p.branch_name ?? "All stores"} · ID {p.employee_id}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-cream/10 px-3 py-1">Since {p.hire_date ? d(p.hire_date) : "—"}</span>
          <span className="rounded-full bg-cream/10 px-3 py-1">{p.pay_type === "salary" ? `${usd(p.weekly_salary)} / week` : `${usd(p.hourly_rate)} / hour`}</span>
          <span className="rounded-full bg-cream/10 px-3 py-1">Paid by {p.pay_method_display}</span>
        </div>
        {err && <p className="mt-2 text-sm text-mustard">{err}</p>}
      </div>
    </div>
  );
}

function EditProfile({ p, onSaved }: { p: MyProfile; onSaved: () => void }) {
  const [f, setF] = useState({
    preferred_name: p.preferred_name, phone: p.phone, address: p.address, city: p.city, state: p.state, zip_code: p.zip_code,
    emergency_contact: p.emergency_contact, emergency_phone: p.emergency_phone,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
    try { await manageApi.saveMe(fd); setMsg("Saved ✓"); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Card title="📇 My details">
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preferred name" hint="What you like to be called"><input className="input !py-2" value={f.preferred_name} onChange={set("preferred_name")} /></Field>
          <Field label="Mobile phone"><input className="input !py-2" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Street address"><input className="input !py-2" autoComplete="street-address" value={f.address} onChange={set("address")} /></Field>
        <div className="grid grid-cols-[1fr_90px_100px] gap-3">
          <Field label="City"><input className="input !py-2" value={f.city} onChange={set("city")} /></Field>
          <Field label="State">
            <select className="input !py-2 !pl-2" value={f.state} onChange={set("state")}><option value="">—</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</select>
          </Field>
          <Field label="ZIP"><input className="input !py-2" inputMode="numeric" maxLength={10} value={f.zip_code} onChange={set("zip_code")} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Emergency contact"><input className="input !py-2" value={f.emergency_contact} onChange={set("emergency_contact")} /></Field>
          <Field label="Emergency phone"><input className="input !py-2" type="tel" value={f.emergency_phone} onChange={set("emergency_phone")} /></Field>
        </div>
        <p className="text-xs text-ink-soft">Email: {p.email || "—"} · Date of birth: {p.date_of_birth ? d(p.date_of_birth) : "—"} — ask your manager to change these, your pay or your role.</p>
        <ErrorBox error={err} />
        <div className="flex items-center justify-between">
          {msg ? <Badge status="active">{msg}</Badge> : <span />}
          <button className="btn-primary !py-2.5">Save my details</button>
        </div>
      </form>
    </Card>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ old: "", next: "", again: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setMsg(null);
    if (f.next !== f.again) { setErr("The new passwords don’t match."); return; }
    try { await manageApi.changePassword(f.old, f.next); setMsg("Password changed ✓"); setF({ old: "", next: "", again: "" }); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Card title="🔑 Password">
      <form onSubmit={save} className="space-y-3">
        <Field label="Current password"><input className="input !py-2" type="password" autoComplete="current-password" required value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password" hint="At least 6 characters"><input className="input !py-2" type="password" autoComplete="new-password" minLength={6} required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="New password again"><input className="input !py-2" type="password" autoComplete="new-password" required value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
        </div>
        <ErrorBox error={err} />
        <div className="flex items-center justify-between">
          {msg ? <Badge status="active">{msg}</Badge> : <span />}
          <button className="btn-dark !py-2.5">Change password</button>
        </div>
      </form>
    </Card>
  );
}
