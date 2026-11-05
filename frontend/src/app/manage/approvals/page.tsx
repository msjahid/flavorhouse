"use client";

import { useState } from "react";
import { ChangeCard } from "@/components/manage/ChangeViews";
import { PurchaseDetail } from "@/components/manage/PurchaseViews";
import { Badge, Card, d, dt, Empty, ErrorBox, Modal, PageHeader, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type Purchase, type Staff } from "@/lib/manage";

const TABS = [["waiting", "Waiting for me"], ["mine", "My requests"], ["done", "Recently decided"]] as const;
type Tab = (typeof TABS)[number][0];

const yes = (b: boolean) => (b ? "✓ Yes" : "✗ No");

/** Full staff record shown before the reviewer can verify. */
function StaffReview({ s, onClose, onDone }: { s: Staff; onClose: () => void; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (decision: "approve" | "reject") => {
    if (decision === "reject" && !note.trim()) { setErr("Write why you are rejecting."); return; }
    setBusy(true); setErr(null);
    try { await manageApi.reviewStaff(s.id, decision, note); onDone(`${s.name} ${decision === "approve" ? "verified ✓" : "rejected"}`); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setBusy(false); }
  };
  const rows: [string, React.ReactNode][][] = [
    [["Employee ID", s.employee_id], ["Role", s.role_display], ["Job title", s.job_title || "—"],
     ["Store", s.branch_name ?? (s.stores.length ? s.stores.map((x) => x.name).join(", ") : "All stores")]],
    [["Email", s.email || "—"], ["Phone", s.phone || "—"], ["Address", [s.address, s.city, s.state, s.zip_code].filter(Boolean).join(", ") || "—"],
     ["Date of birth", s.date_of_birth ? d(s.date_of_birth) : "—"], ["Emergency contact", [s.emergency_contact, s.emergency_phone].filter(Boolean).join(" · ") || "—"]],
    [["Employment", s.employment_type === "full_time" ? "Full-time" : "Part-time"], ["Hire date", s.hire_date ? d(s.hire_date) : "—"],
     ["Pay", s.pay_type === "salary" ? `${usd(s.weekly_salary)} / week (salary)` : `${usd(s.hourly_rate)} / hour (${s.pay_type_display})`],
     ["Paid by", s.pay_method_display], ["I-9 checked", yes(s.i9_verified)], ["W-4 on file", yes(s.w4_on_file)]],
  ];
  return (
    <Modal title="Review new staff" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-mustard font-display text-xl font-extrabold">
          {s.first_name[0]}{s.last_name[0]}
        </span>
        <div>
          <p className="font-display text-2xl font-extrabold">{s.name}</p>
          <p className="text-sm text-ink-soft">Added by {s.created_by_name} · {dt(s.created_at)}</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((group, i) => (
          <dl key={i} className="space-y-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-ink/5">
            {group.map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold uppercase text-ink-soft">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
        ))}
      </div>
      {s.notes && <p className="mt-3 rounded-xl bg-white p-3 text-sm ring-1 ring-ink/5">📝 {s.notes}</p>}
      {(!s.i9_verified || !s.w4_on_file) && (
        <p className="mt-3 rounded-xl bg-mustard/30 p-3 text-sm">⚠️ {!s.i9_verified && "Form I-9 isn’t marked as checked. "}{!s.w4_on_file && "No W-4 on file yet."}</p>
      )}
      <input className="input mt-4" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorBox error={err} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn-ghost text-flame" disabled={busy} onClick={() => act("reject")}>✕ Reject</button>
        <button className="btn-primary" disabled={busy} onClick={() => act("approve")}>✓ Verify {s.first_name}</button>
      </div>
    </Modal>
  );
}

export default function ApprovalsPage() {
  const { user } = usePosAuth();
  const [tab, setTab] = useState<Tab>("waiting");
  const waiting = useLoad(() => manageApi.approvals(), []);
  const mine = useLoad(() => (tab === "mine" ? manageApi.changes({ mine: "1" }) : Promise.resolve([])), [tab]);
  const done = useLoad(() => (tab === "done" ? manageApi.changes({ status: "approved" }).then(async (a) => {
    const r = await manageApi.changes({ status: "rejected" });
    return [...a, ...r].sort((x, y) => (y.reviewed_at ?? "").localeCompare(x.reviewed_at ?? "")).slice(0, 60);
  }) : Promise.resolve([])), [tab]);
  const [open, setOpen] = useState<Purchase | null>(null);
  const [review, setReview] = useState<Staff | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const data = waiting.data;

  return (
    <div>
      <PageHeader title="Approvals" sub="Role-wise: manager → supervisor → super admin → admin. Nobody approves their own entry." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === k ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
            {l}{k === "waiting" && data ? ` (${data.count})` : ""}
          </button>
        ))}
      </div>
      <ErrorBox error={waiting.error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}

      {tab === "waiting" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title={`✏️ Changes & new entries (${data?.changes.length ?? 0})`} className="xl:col-span-2">
            {data?.changes.length === 0 && <Empty>No changes waiting 🎉</Empty>}
            <div className="grid gap-3 lg:grid-cols-2">
              {data?.changes.map((c) => (
                <ChangeCard key={c.id} c={c} compact onDone={(r) => { setMsg(`${r.label}: ${r.status}`); waiting.reload(); }} />
              ))}
            </div>
          </Card>
          <Card title={`🧾 Purchases (${data?.purchases.length ?? 0})`}>
            {data?.purchases.length === 0 && <Empty>Nothing to approve 🎉</Empty>}
            <ul className="space-y-2">
              {data?.purchases.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setOpen(p)} className="w-full rounded-2xl bg-cream/60 p-4 text-left ring-1 ring-ink/5 hover:ring-flame">
                    <div className="flex justify-between gap-2">
                      <p className="font-bold">{p.vendor} <span className="font-normal text-ink-soft">· {p.category_display}</span></p>
                      <p className="font-display text-xl font-extrabold">{usd(p.total)}</p>
                    </div>
                    <p className="text-sm text-ink-soft">🏪 {p.branch_name} · by {p.submitted_by_name} · {dt(p.created_at)} {p.receipt_url && "· 📎 receipt"}</p>
                    <p className="mt-1 line-clamp-2 text-sm">{p.reason}</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={`👥 New staff to verify (${data?.staff.length ?? 0})`}>
            {data?.staff.length === 0 && <Empty>Nobody waiting</Empty>}
            <ul className="space-y-2">
              {data?.staff.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setReview(s)} className="w-full rounded-2xl bg-cream/60 p-4 text-left ring-1 ring-ink/5 hover:ring-flame">
                    <div className="flex justify-between gap-2">
                      <p className="font-bold">{s.name} <span className="font-normal text-ink-soft">· {s.employee_id}</span></p>
                      <Badge status="pending">{s.role_display}</Badge>
                    </div>
                    <p className="text-sm text-ink-soft">
                      🏪 {s.branch_name ?? (s.stores.map((x) => x.name).join(", ") || "All branches")} · {s.job_title || "—"} ·{" "}
                      {s.pay_type === "salary" ? `${usd(s.weekly_salary)}/week` : `${usd(s.hourly_rate)}/hr`}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-flame">Tap to review details →</p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "mine" && (
        <Card>
          {mine.loading ? <p className="text-sm text-ink-soft">Loading…</p> : mine.data?.length === 0 ? <Empty>You haven’t sent any changes.</Empty> : (
            <div className="grid gap-3 lg:grid-cols-2">{mine.data?.map((c) => <ChangeCard key={c.id} c={c} compact />)}</div>
          )}
        </Card>
      )}

      {tab === "done" && (
        <Card>
          {done.loading ? <p className="text-sm text-ink-soft">Loading…</p> : done.data?.length === 0 ? <Empty>Nothing decided yet.</Empty> : (
            <div className="grid gap-3 lg:grid-cols-2">{done.data?.map((c) => <ChangeCard key={c.id} c={c} compact />)}</div>
          )}
        </Card>
      )}

      {open && <PurchaseDetail p={open} canReview={(user?.level ?? 0) >= 3} onClose={() => setOpen(null)}
        onChanged={(p) => { setOpen(null); setMsg(`${p.vendor} ${p.status}`); waiting.reload(); }} />}
      {review && <StaffReview s={review} onClose={() => setReview(null)} onDone={(m) => { setReview(null); setMsg(m); waiting.reload(); }} />}
    </div>
  );
}
