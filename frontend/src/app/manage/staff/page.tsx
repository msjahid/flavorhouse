"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useEffect, useState } from "react";
import { RecordHistory } from "@/components/manage/ChangeViews";
import { Badge, Card, d, Empty, ErrorBox, Field, Modal, PageHeader, useBranchFilter, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { creatableRoles, manageApi, ROLE_LABEL, ROLE_LEVEL, type Branch, type Staff } from "@/lib/manage";
import { localDateISO, type Role } from "@/lib/pos";

export default function StaffPage() {
  const { user } = usePosAuth();
  const { branch, picker } = useBranchFilter();
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const { data, error, reload } = useLoad(() => manageApi.staff({ branch, status }), [branch, status]);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Staff" sub={user!.level === 2 ? "Employees at your branch. New employees are verified by a supervisor." : "Everyone you manage"}>
        {picker}
        <Select value={status} onChange={setStatus} options={[{ value: "", label: "Everyone", icon: "👥" }, { value: "active", label: "Active", icon: "🟢" },
          { value: "pending", label: "Waiting for verification", icon: "⏳" }, { value: "inactive", label: "Inactive", icon: "⚪" }, { value: "rejected", label: "Rejected", icon: "⛔" }]} />
        <button className="btn-primary" onClick={() => setEditing("new")}>+ Add staff</button>
      </PageHeader>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      <Card>
        {data?.length === 0 ? <Empty>No staff found.</Empty> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-soft">
              <tr><th className="py-2">ID</th><th>Name</th><th>Role</th><th>Branch</th><th>Pay</th><th>Paid by</th><th>Docs</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {data?.map((s) => (
                <tr key={s.id} onClick={() => setEditing(s)} className="cursor-pointer hover:bg-cream">
                  <td className="py-2.5 font-mono text-xs">{s.employee_id}</td>
                  <td className="font-semibold">{s.name}{s.job_title && <span className="block text-xs font-normal text-ink-soft">{s.job_title}</span>}</td>
                  <td>{s.role_display}</td><td>{s.branch_name ?? (s.stores.length ? s.stores.map((x) => x.name).join(", ") : "All")}</td>
                  <td className="tabular-nums">{s.pay_type === "salary" ? `${usd(s.weekly_salary)}/wk` : `${usd(s.hourly_rate)}/hr`}{s.pay_type === "tipped" && " + tips"}</td>
                  <td>{s.pay_method_display}</td>
                  <td className="text-xs">I-9 {s.i9_verified ? "✓" : "✗"} · W-4 {s.w4_on_file ? "✓" : "✗"}</td>
                  <td><Badge status={s.status}>{s.status_display}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <StaffForm staff={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); setMsg(m || null); reload(); }} />}
    </div>
  );
}

const STAFF_BASE: Record<Role, number> = { employee: 3, manager: 4, supervisor: 4, superadmin: 5, admin: 5 };

function StaffForm({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: (msg?: string) => void }) {
  const { user } = usePosAuth();
  const roles = creatableRoles(user!.level);
  const isManager = user!.level === 2;
  const [titles, setTitles] = useState<{ id: number; name: string }[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [stores, setStores] = useState<number[]>(staff?.stores.map((x) => x.id) ?? []);
  const [tab, setTab] = useState<"info" | "history">("info");
  useEffect(() => {
    manageApi.jobTitles().then(setTitles).catch(() => {});
    if (user!.level >= 3) manageApi.branches().then((b) => setAllBranches(b.filter((x) => x.is_active))).catch(() => {});
  }, [user]);
  const isSelf = staff?.employee_id === user?.employee_id;
  const canEdit = !staff || user!.level === 5 || (ROLE_LEVEL[staff.role] < user!.level && !isSelf);
  const [f, setF] = useState({
    employee_id: staff?.employee_id ?? "", first_name: staff?.first_name ?? "", last_name: staff?.last_name ?? "",
    email: staff?.email ?? "", phone: staff?.phone ?? "", address: staff?.address ?? "",
    date_of_birth: staff?.date_of_birth ?? "", emergency_contact: staff?.emergency_contact ?? "", emergency_phone: staff?.emergency_phone ?? "",
    role: (staff?.role ?? "employee") as Role, branch: staff?.branch ?? user?.branch?.id ?? "",
    city: staff?.city ?? "", state: staff?.state ?? "", zip_code: staff?.zip_code ?? "",
    job_title: staff?.job_title ?? "", employment_type: staff?.employment_type ?? "part_time", hire_date: staff?.hire_date ?? localDateISO(),
    pay_type: staff?.pay_type ?? "hourly", hourly_rate: staff?.hourly_rate ?? "", weekly_salary: staff?.weekly_salary ?? "0",
    pay_method: staff?.pay_method ?? "direct_deposit", i9_verified: staff?.i9_verified ?? false, w4_on_file: staff?.w4_on_file ?? false,
    notes: staff?.notes ?? "", password: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const needsBranch = f.role === "employee" || f.role === "manager";
  const needLevel = user!.level >= 5 ? 0 : Math.max(STAFF_BASE[f.role], user!.level + 1);
  const needsReview = needLevel > 0;
  const needName = ["", "", "", "supervisor", "super admin", "admin"][needLevel] ?? "admin";
  const hasStores = f.role === "supervisor" || f.role === "superadmin";
  const canSetStores = user!.level >= 4;
  const addTitle = async () => {
    const name = prompt("New job title (e.g. Dishwasher, Prep cook)");
    if (!name?.trim()) return;
    try { const t = await manageApi.addJobTitle(name.trim()); setTitles([...titles, t].sort((a, b) => a.name.localeCompare(b.name))); setF({ ...f, job_title: t.name }); }
    catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  const signOut = async () => {
    if (!confirm(`Sign ${staff!.name} out of every device now?`)) return;
    try { await manageApi.signOutStaff(staff!.id); onSaved(`${staff!.name} was signed out of all devices.`); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const body: Record<string, unknown> = { ...f, branch: needsBranch ? Number(f.branch) || null : null,
      date_of_birth: f.date_of_birth || null, weekly_salary: f.weekly_salary || "0", hourly_rate: f.hourly_rate || "0" };
    if (!body.password) delete body.password;
    if (isManager) { body.role = "employee"; body.branch = user!.branch?.id ?? null; }
    if (hasStores && canSetStores) body.assigned_branches = stores;
    try {
      const r = staff ? await manageApi.updateStaff(staff.id, body) : await manageApi.createStaff(body);
      onSaved(r.message || (staff ? "Saved ✓" : needsReview ? `${r.name} added — waiting for ${needName} verification.` : `${r.name} added ✓`));
    } catch (x) { setErr(x instanceof Error ? x.message : "Could not save."); setBusy(false); }
  };
  const setActive = async (active: boolean) => {
    try { await manageApi.setStaffActive(staff!.id, active); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };

  return (
    <Modal title={staff ? staff.name : "Add staff member"} onClose={onClose} wide>
      {staff && (
        <div className="mb-4 flex gap-2">
          {(["info", "history"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
              {t === "info" ? "👤 Details" : "🕘 History"}</button>
          ))}
        </div>
      )}
      {tab === "history" && staff ? <RecordHistory model="staff" id={staff.id} /> : (
      <form onSubmit={save}>
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Employee ID (sign-in)"><input className="input !py-2 font-mono uppercase" required placeholder="E1001" value={f.employee_id} onChange={set("employee_id")} /></Field>
            <Field label="First name"><input className="input !py-2" required value={f.first_name} onChange={set("first_name")} /></Field>
            <Field label="Last name"><input className="input !py-2" value={f.last_name} onChange={set("last_name")} /></Field>
            <Field label="Role">
              {isManager ? <div className="input !py-2 bg-cream font-semibold">{ROLE_LABEL[staff?.role ?? "employee"]}</div> : (
              <select className="input !py-2" value={f.role} onChange={set("role")}>
                {(staff && !roles.includes(staff.role) ? [staff.role, ...roles] : roles).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>)}
            </Field>
            {needsBranch && isManager && (
              <Field label="Store"><div className="input !py-2 bg-cream font-semibold">🏪 {user!.branch?.name}</div></Field>
            )}
            {needsBranch && !isManager && (
              <Field label="Branch">
                <select className="input !py-2" required value={f.branch} onChange={set("branch")}>
                  <option value="">Choose…</option>
                  {user!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Job title" hint={user!.level >= 4 ? undefined : "Super admins & admins can add new titles."}>
              <div className="flex gap-1">
                <select className="input !py-2" value={f.job_title} onChange={set("job_title")}>
                  <option value="">Choose…</option>
                  {[...titles.map((t) => t.name), ...(f.job_title && !titles.some((t) => t.name === f.job_title) ? [f.job_title] : [])].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {user!.level >= 4 && <button type="button" onClick={addTitle} className="shrink-0 rounded-xl bg-ink px-3 font-bold text-cream" title="Add a custom job title">+</button>}
              </div>
            </Field>
            <Field label="Phone"><input className="input !py-2" type="tel" value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Email"><input className="input !py-2" type="email" value={f.email} onChange={set("email")} /></Field>
            <Field label="Date of birth"><input className="input !py-2" type="date" value={f.date_of_birth ?? ""} onChange={set("date_of_birth")} /></Field>
            <Field label="Street address"><input className="input !py-2" value={f.address} onChange={set("address")} /></Field>
            <div className="grid grid-cols-[1fr_70px_90px] gap-2">
              <Field label="City"><input className="input !py-2" value={f.city} onChange={set("city")} /></Field>
              <Field label="State"><input className="input !py-2 uppercase" maxLength={2} placeholder="TX" value={f.state} onChange={set("state")} /></Field>
              <Field label="ZIP"><input className="input !py-2" inputMode="numeric" maxLength={10} value={f.zip_code} onChange={set("zip_code")} /></Field>
            </div>
            <Field label="Emergency contact"><input className="input !py-2" value={f.emergency_contact} onChange={set("emergency_contact")} /></Field>
            <Field label="Emergency phone"><input className="input !py-2" type="tel" value={f.emergency_phone} onChange={set("emergency_phone")} /></Field>
          </div>
          {hasStores && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
              <p className="text-sm font-semibold">Stores this {ROLE_LABEL[f.role].toLowerCase()} can access</p>
              <p className="mb-2 text-xs text-ink-soft">
                {canSetStores ? (user!.level >= 5 ? "Saved right away." : "A super admin’s store changes are verified by the admin.") : "Only a super admin or admin can assign stores."}
              </p>
              <div className="flex flex-wrap gap-2">
                {(allBranches.length ? allBranches : user!.branches).map((b) => {
                  const on = stores.includes(b.id);
                  return (
                    <button key={b.id} type="button" disabled={!canSetStores}
                      onClick={() => setStores(on ? stores.filter((x) => x !== b.id) : [...stores, b.id])}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${on ? "bg-ink text-cream ring-ink" : "bg-cream ring-ink/10"} disabled:opacity-60`}>
                      {on ? "✓ " : ""}{b.name}
                    </button>
                  );
                })}
              </div>
              {canSetStores && <p className="mt-2 text-xs text-ink-soft">{stores.length} store{stores.length === 1 ? "" : "s"} selected
                <button type="button" className="ml-2 font-semibold text-flame" onClick={() => setStores((allBranches.length ? allBranches : user!.branches).map((b) => b.id))}>Select all</button></p>}
            </div>
          )}
          <div className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10 sm:grid-cols-4">
            <Field label="Employment">
              <select className="input !py-2" value={f.employment_type} onChange={set("employment_type")}><option value="part_time">Part-time</option><option value="full_time">Full-time</option></select>
            </Field>
            <Field label="Hire date"><input className="input !py-2" type="date" value={f.hire_date} onChange={set("hire_date")} /></Field>
            <Field label="Pay type">
              <select className="input !py-2" value={f.pay_type} onChange={set("pay_type")}>
                <option value="hourly">Hourly</option><option value="tipped">Hourly (tipped)</option><option value="salary">Salary (weekly)</option>
              </select>
            </Field>
            {f.pay_type === "salary"
              ? <Field label="Weekly salary ($)"><input className="input !py-2" type="number" step="0.01" min="0" required value={f.weekly_salary} onChange={set("weekly_salary")} /></Field>
              : <Field label="Hourly rate ($)" hint="Must meet the branch minimum wage"><input className="input !py-2" type="number" step="0.01" min="0" required value={f.hourly_rate} onChange={set("hourly_rate")} /></Field>}
            <Field label="Paid by">
              <select className="input !py-2" value={f.pay_method} onChange={set("pay_method")}>
                <option value="direct_deposit">Direct deposit</option><option value="check">Check</option><option value="cash">Cash</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" checked={f.i9_verified} onChange={set("i9_verified")} /> I-9 completed</label>
            <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" checked={f.w4_on_file} onChange={set("w4_on_file")} /> W-4 on file</label>
            <p className="pt-5 text-xs text-ink-soft">Keep SSNs, I-9 &amp; W-4 forms with your payroll provider — they&apos;re not stored here.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notes"><textarea className="input !py-2" rows={2} value={f.notes} onChange={set("notes")} /></Field>
            <Field label={staff ? "Reset password (leave empty to keep)" : "Starting password"} hint="At least 6 characters. They can sign in to the POS with their ID + this.">
              <input className="input !py-2" type="text" autoComplete="new-password" required={!staff} minLength={6} value={f.password} onChange={set("password")} />
            </Field>
          </div>
        </fieldset>

        {staff && (
          <p className="mt-3 text-xs text-ink-soft">
            Added by {staff.created_by_name ?? "—"} · {d(staff.created_at)}
            {staff.reviewed_by_name && ` · ${staff.status === "rejected" ? "rejected" : "verified"} by ${staff.reviewed_by_name}`}
            {staff.review_note && ` — “${staff.review_note}”`}
          </p>
        )}
        <ErrorBox error={err} />
        {canEdit ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-soft">
              {!staff && (needsReview ? `⏳ A ${needName} must verify this person before they can sign in.` : "✓ Active right away.")}
              {staff && user!.level < 5 && "Pay changes go to the next role up for approval."}
            </p>
            <div className="flex gap-2">
              {staff && staff.status === "active" && <button type="button" className="btn-ghost !py-2.5" onClick={signOut} title="End all sign-ins on every device">🚪 Sign out everywhere</button>}
              {staff && staff.status === "active" && <button type="button" className="btn-ghost !py-2.5 text-flame" onClick={() => setActive(false)}>Deactivate</button>}
              {staff && staff.status === "inactive" && <button type="button" className="btn-ghost !py-2.5" onClick={() => setActive(true)}>Reactivate</button>}
              <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : staff ? "Save changes" : "Add staff member"}</button>
            </div>
          </div>
        ) : <p className="mt-4 text-sm text-ink-soft">You can view but not edit this person.</p>}
      </form>)}
    </Modal>
  );
}
