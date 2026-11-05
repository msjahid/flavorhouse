"use client";

import { useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { posApi } from "@/lib/pos";

/** Quick manager approval: a manager (or higher) types their ID + password to allow ONE discount or refund. */
export default function ApprovalModal({
  action,
  percent,
  onApproved,
  onCancel,
}: {
  action: "discount" | "refund";
  percent?: number;
  onApproved: (token: string, approverName: string) => void;
  onCancel: () => void;
}) {
  const { branchId } = usePosAuth();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await posApi.authorize({ action, percent, employee_id: id.trim(), password: pw, branch_id: branchId });
      onApproved(r.approval, r.approver);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Not approved.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/70 p-4" onClick={onCancel}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-cream p-6 shadow-2xl">
        <p className="text-4xl">🔐</p>
        <h2 className="mt-2 font-display text-2xl font-extrabold">Manager approval</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {action === "discount" ? `A ${percent}% discount` : "A refund"} needs a manager or higher. Ask them to enter their ID and password.
        </p>
        <input className="input mt-4" placeholder="Manager employee ID" autoFocus autoComplete="off"
               value={id} onChange={(e) => setId(e.target.value)} required />
        <input className="input mt-2" type="password" placeholder="Password" autoComplete="off"
               value={pw} onChange={(e) => setPw(e.target.value)} required />
        {err && <p className="mt-3 rounded-xl bg-flame/10 p-2 text-sm text-flame">{err}</p>}
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <button type="button" className="btn-ghost !px-4 !py-2.5" onClick={onCancel}>Cancel</button>
          <button className="btn-primary !py-2.5" disabled={busy}>{busy ? "Checking…" : "Approve"}</button>
        </div>
      </form>
    </div>
  );
}
