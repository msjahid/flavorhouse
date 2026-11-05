"use client";

import { useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type ChangeRequest, type HistoryEntry } from "@/lib/manage";
import { Badge, d, dt, Empty, ErrorBox, useLoad } from "./ui";

const HIDE = new Set(["_delete", "staff"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === "object" && "options" in (v[0] as object)) {
      return (v as { name: string; options: { name: string; price_delta: string }[] }[])
        .map((g) => `${g.name}: ${g.options.map((o) => `${o.name}${parseFloat(o.price_delta) ? ` +$${parseFloat(o.price_delta).toFixed(2)}` : ""}`).join(", ")}`).join(" | ");
    }
    if (v.length && typeof v[0] === "object" && "method" in (v[0] as object) && "amount" in (v[0] as object)) {
      const M: Record<string, string> = { cash: "Cash", check: "Check", direct_deposit: "Direct deposit", card: "Card" };
      return (v as { method: string; amount: string; reference?: string }[])
        .map((x) => `${M[x.method] ?? x.method} $${parseFloat(x.amount).toFixed(2)}${x.reference ? ` #${x.reference}` : ""}`).join(" + ");
    }
    if (v.length && typeof v[0] === "object") {
      return (v as Record<string, unknown>[]).map((l) => `${l.quantity ?? ""} ${l.unit ?? ""} ${l.name ?? ""} @ $${l.unit_cost ?? ""}`.trim()).join("; ");
    }
    return v.join(", ");
  }
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => `${k}×${x}`).join(", ");
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return dt(s.replace(" ", "T"));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return d(s);
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(s)) return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());  // direct_deposit → Direct deposit
  return s;
}

/** Comparable form: same moment / same number count as unchanged. */
function norm(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return String(new Date(s.replace(" ", "T")).getTime());
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(parseFloat(s));
  return s;
}

const LABELS: Record<string, string> = { option_groups: "Options", paid: "Paid", staff: "Employee", from: "Period from", to: "Period to", payments: "Paid with", paid_amount: "Amount paid" };
const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/\bid\b/, "").trim();

/** Old → new table for a change waiting for approval (or already reviewed). */
export function ChangeDiff({ c }: { c: ChangeRequest }) {
  const keys = Object.keys(c.payload).filter((k) => !HIDE.has(k))
    .sort((a, b) => Number(norm(c.before?.[b]) !== norm(c.payload[b])) - Number(norm(c.before?.[a]) !== norm(c.payload[a])));
  const isNew = c.action === "New";
  if (c.payload._delete) return <p className="rounded-xl bg-flame/10 p-3 text-sm text-flame">Delete this entry.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-ink-soft">
        <tr><th className="w-40 py-1">Field</th>{!isNew && <th>Now</th>}<th>{isNew ? "Value" : "Change to"}</th></tr>
      </thead>
      <tbody className="divide-y divide-ink/5 align-top">
        {keys.map((k) => {
          const changed = isNew || norm(c.before?.[k]) !== norm(c.payload[k]);
          return (
            <tr key={k} className={changed ? "" : "text-ink-soft"}>
              <td className="py-1.5 pr-2 font-semibold capitalize">{label(k)}</td>
              {!isNew && <td className={`py-1.5 pr-2 text-ink-soft ${changed ? "line-through decoration-flame/50" : ""}`}>{show(c.before?.[k])}</td>}
              <td className={`py-1.5 ${changed ? "font-semibold text-leaf" : ""}`}>{show(c.payload[k])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ChangeCard({ c, onDone, compact }: { c: ChangeRequest; onDone?: (c: ChangeRequest) => void; compact?: boolean }) {
  const { user } = usePosAuth();
  const [open, setOpen] = useState(!compact);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canReview = c.status === "pending" && (user?.level ?? 0) >= c.need_level;

  const review = async (d: "approve" | "reject") => {
    setBusy(true); setErr(null);
    try { onDone?.(await manageApi.reviewChange(c.id, d, note)); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };

  return (
    <article className="rounded-2xl bg-cream/60 p-4 ring-1 ring-ink/5">
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(!open)}>
        <div>
          <p className="font-bold">
            <span className="mr-2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold uppercase text-cream">{c.action} {c.label}</span>
            {c.summary}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {c.branch_name && <>🏪 {c.branch_name} · </>}by {c.submitted_by_name} · {dt(c.created_at)}
            {c.reason && <> · “{c.reason}”</>}
          </p>
        </div>
        <Badge status={c.status}>{c.status === "pending" ? `Needs ${c.need_role}` : c.status}</Badge>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <ChangeDiff c={c} />
          {c.file_url && <a className="text-sm font-semibold text-flame underline" href={c.file_url} target="_blank" rel="noreferrer">📎 Attached file</a>}
          {c.reviewed_by_name && <p className="text-xs text-ink-soft">{c.status === "approved" ? "Approved" : "Rejected"} by {c.reviewed_by_name}{c.reviewed_at && ` · ${dt(c.reviewed_at)}`}{c.review_note && ` — “${c.review_note}”`}</p>}
          {canReview && (
            <div className="space-y-2 border-t border-ink/10 pt-3">
              <input className="input !py-2" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
              <ErrorBox error={err} />
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-ghost !py-2 text-flame" disabled={busy} onClick={() => review("reject")}>✕ Reject</button>
                <button className="btn-primary !py-2" disabled={busy} onClick={() => review("approve")}>✓ Approve</button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const ACTION_ICON: Record<string, string> = {
  created: "➕", updated: "✏️", deleted: "🗑", approved: "✅", rejected: "⛔", verified: "✅", refunded: "↩️",
  "signed in": "🔑", "signed out": "🚪",
};

export function HistoryList({ items }: { items: HistoryEntry[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return <Empty>No history yet.</Empty>;
  return (
    <ul className="divide-y divide-ink/5">
      {items.map((h) => (
        <li key={h.id} className="py-2.5 text-sm">
          <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === h.id ? null : h.id)}>
            <span className="w-6 shrink-0 text-center">{ACTION_ICON[h.action] ?? "•"}</span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{h.summary}</span>
              <span className="block text-xs text-ink-soft">
                {h.actor_name ?? "System"}{h.approved_by_name && ` · approved by ${h.approved_by_name}`}
                {h.branch_name && ` · ${h.branch_name}`} · {dt(h.created_at)}
              </span>
            </span>
            {Object.keys(h.changes).length > 0 && <span className="text-xs text-flame">{open === h.id ? "Hide" : "Details"}</span>}
          </button>
          {open === h.id && Object.keys(h.changes).length > 0 && (
            <table className="ml-9 mt-2 text-xs">
              <tbody>
                {Object.entries(h.changes).map(([k, [a, b]]) => (
                  <tr key={k}><td className="pr-3 font-semibold capitalize">{label(k)}</td>
                    <td className="pr-3 text-ink-soft line-through">{show(a)}</td><td className="text-leaf">{show(b)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      ))}
    </ul>
  );
}

/** History of one record, e.g. <RecordHistory model="purchase" id={12} /> */
export function RecordHistory({ model, id }: { model: string; id: number }) {
  const { data } = useLoad(() => manageApi.history({ model, object_id: id }), [model, id]);
  return data ? <HistoryList items={data} /> : <p className="text-sm text-ink-soft">Loading…</p>;
}
