"use client";

import { useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import ApprovalModal from "./ApprovalModal";

export interface Discount {
  percent: number;
  reason: string;
  approval?: string;
  approver?: string;
}

const PRESETS = [5, 10, 15, 20, 25, 50, 75, 100];
const REASONS = ["Regular customer", "Staff meal", "Complaint / remake", "Promotion", "Manager's choice"];

export default function DiscountModal({
  current,
  onApply,
  onClose,
}: {
  current: Discount | null;
  onApply: (d: Discount | null) => void;
  onClose: () => void;
}) {
  const { user } = usePosAuth();
  const limit = user?.discount_limit ?? 0;
  const [percent, setPercent] = useState<number>(current?.percent ?? 10);
  const [reason, setReason] = useState(current?.reason ?? "");
  const [askApproval, setAskApproval] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = () => {
    if (!(percent > 0 && percent <= 100)) return setErr("Enter a discount from 1 to 100%.");
    if (!reason.trim()) return setErr("Choose or type a reason.");
    if (percent > limit) return setAskApproval(true);
    onApply({ percent, reason: reason.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-cream p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl font-extrabold">Discount</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {limit > 0 ? `You can give up to ${limit}% yourself.` : "Discounts need a manager's approval."} Larger discounts ask for a manager.
        </p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => { setPercent(p); setErr(null); }}
              className={`rounded-xl py-3 text-lg font-bold ring-1 ${percent === p ? "bg-flame text-white ring-flame" : "bg-white ring-ink/10"}`}>
              {p}%{p > limit && <span className="block text-[10px] font-semibold opacity-75">🔐 approval</span>}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
          Other %
          <input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))}
                 className="input !w-24 !py-2" />
        </label>
        <p className="mt-4 text-sm font-semibold">Reason</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${reason === r ? "bg-ink text-cream ring-ink" : "bg-white ring-ink/10"}`}>{r}</button>
          ))}
        </div>
        <input className="input mt-2 !py-2" placeholder="Or type a reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="mt-3 text-sm text-flame">{err}</p>}
        <div className="mt-5 grid grid-cols-[auto_auto_1fr] gap-2">
          <button className="btn-ghost !px-4 !py-2.5" onClick={onClose}>Close</button>
          {current && <button className="btn-ghost !px-4 !py-2.5 text-flame" onClick={() => onApply(null)}>Remove</button>}
          <button className="btn-primary !py-2.5 col-start-3" onClick={apply}>Apply {percent}%</button>
        </div>
      </div>
      {askApproval && (
        <ApprovalModal action="discount" percent={percent} onCancel={() => setAskApproval(false)}
          onApproved={(approval, approver) => onApply({ percent, reason: reason.trim(), approval, approver })} />
      )}
    </div>
  );
}
