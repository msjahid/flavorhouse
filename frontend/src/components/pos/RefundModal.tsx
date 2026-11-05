"use client";

import { useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { money } from "@/lib/format";
import type { PosOrder } from "@/lib/pos";
import ApprovalModal from "./ApprovalModal";

const REASONS = ["Wrong order", "Food quality", "Long wait", "Customer changed mind", "Charged twice"];

export default function RefundModal({ order, onConfirm, onCancel }: {
  order: PosOrder;
  onConfirm: (reason: string, approval?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { user } = usePosAuth();
  const [reason, setReason] = useState("");
  const [askApproval, setAskApproval] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (approval?: string) => {
    setBusy(true); setErr(null);
    try { await onConfirm(reason.trim(), approval); } catch (e) { setErr(e instanceof Error ? e.message : "Refund failed."); setBusy(false); }
  };
  const start = () => {
    if (!reason.trim()) return setErr("Choose or type a reason.");
    if (!user?.can_refund) return setAskApproval(true);
    go();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-3xl bg-cream p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl font-extrabold">Refund {order.number}?</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {money(order.total)} · {order.payment_method === "stripe"
            ? "goes back to the customer's card automatically."
            : "give the money back by cash / on the card machine."}
          {!user?.can_refund && " A manager must approve."}
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${reason === r ? "bg-ink text-cream ring-ink" : "bg-white ring-ink/10"}`}>{r}</button>
          ))}
        </div>
        <input className="input mt-2 !py-2" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="mt-3 text-sm text-flame">{err}</p>}
        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">
          <button className="btn-ghost !px-4 !py-2.5" onClick={onCancel}>Cancel</button>
          <button className="btn !py-2.5 bg-purple-700 text-white hover:bg-purple-800" onClick={start} disabled={busy}>
            {busy ? "Refunding…" : user?.can_refund ? "↩ Refund" : "🔐 Get approval & refund"}
          </button>
        </div>
      </div>
      {askApproval && (
        <ApprovalModal action="refund" onCancel={() => setAskApproval(false)}
          onApproved={(token) => { setAskApproval(false); go(token); }} />
      )}
    </div>
  );
}
