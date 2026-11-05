"use client";

import { useEffect, useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { localDateISO } from "@/lib/pos";
import { canEditEntry, changeMessage, manageApi, PAID_WITH, PURCHASE_CATEGORIES, type Purchase, type PurchaseLine, type Vendor } from "@/lib/manage";
import { RecordHistory } from "./ChangeViews";
import { Badge, d, dt, ErrorBox, Field, Modal, usd } from "./ui";

const blank = (): PurchaseLine => ({ name: "", quantity: "1", unit: "", unit_cost: "" });
const OTHER = "other";
const UNITS = ["case", "lb", "box", "bag", "each", "gal", "dozen", "pack", "bottle", "tray"];

/** New purchase, or (with `existing`) an edit that goes for approval role-wise. */
export function PurchaseForm({ onDone, onClose, existing, onEditSent }: {
  onDone?: (p: Purchase) => void; onClose: () => void; existing?: Purchase; onEditSent?: (msg: string) => void;
}) {
  const { user } = usePosAuth();
  const multi = (user?.level ?? 0) >= 3 && !existing;
  const [branch, setBranch] = useState<number | "">(existing?.branch ?? (multi ? "" : user?.branch?.id ?? ""));
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorPick, setVendorPick] = useState<string>(existing ? (existing.vendor_ref ? String(existing.vendor_ref) : OTHER) : "");
  const [f, setF] = useState({
    vendor: existing && !existing.vendor_ref ? existing.vendor : "",
    invoice_number: existing?.invoice_number ?? "", category: existing?.category ?? "meat",
    paid_with: existing?.paid_with ?? "company_card", purchase_date: existing?.purchase_date ?? localDateISO(),
    tax: existing?.tax ?? "0", reason: existing?.reason ?? "",
  });
  const [lines, setLines] = useState<PurchaseLine[]>(existing?.lines.map((l) => ({ name: l.name, quantity: String(parseFloat(l.quantity)), unit: l.unit, unit_cost: l.unit_cost })) ?? [blank()]);
  const [changeReason, setChangeReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { manageApi.vendors().then(setVendors).catch(() => {}); }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const setLine = (i: number, k: keyof PurchaseLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0);
  const total = subtotal + (parseFloat(f.tax) || 0);
  const autoOk = (user?.level ?? 0) >= 4;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorPick) { setErr("Choose a vendor / store."); return; }
    setBusy(true); setErr(null);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => { if (k !== "vendor") fd.append(k, v); });
    if (vendorPick === OTHER) fd.append("vendor", f.vendor); else fd.append("vendor_ref", vendorPick);
    if (branch) fd.append("branch", String(branch));
    fd.append("lines", JSON.stringify(lines.filter((l) => l.name.trim())));
    if (file) fd.append("receipt", file);
    try {
      if (existing) {
        fd.append("change_reason", changeReason);
        const cr = await manageApi.editPurchase(existing.id, fd);
        onEditSent?.(changeMessage(cr));
      } else onDone?.(await manageApi.createPurchase(fd));
    } catch (x) { setErr(x instanceof Error ? x.message : "Could not save."); setBusy(false); }
  };

  const vendorInfo = vendors.find((v) => String(v.id) === vendorPick);

  return (
    <Modal title={existing ? `Edit purchase #${existing.id}` : "New purchase"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {multi && (
            <Field label="Branch">
              <select className="input !py-2" required value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
                <option value="">Choose…</option>
                {user!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Vendor / store" hint={vendorInfo ? [vendorInfo.phone, vendorInfo.payment_terms_display].filter(Boolean).join(" · ") : undefined}>
            <select className="input !py-2" required value={vendorPick} onChange={(e) => setVendorPick(e.target.value)}>
              <option value="">Choose…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              <option value={OTHER}>Other (type name)…</option>
            </select>
          </Field>
          {vendorPick === OTHER && (
            <Field label="Other vendor name"><input className="input !py-2" required placeholder="Store name" value={f.vendor} onChange={set("vendor")} /></Field>
          )}
          <Field label="Invoice / receipt #"><input className="input !py-2" value={f.invoice_number} onChange={set("invoice_number")} /></Field>
          <Field label="Category">
            <select className="input !py-2" value={f.category} onChange={set("category")}>
              {PURCHASE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Paid with">
            <select className="input !py-2" value={f.paid_with} onChange={set("paid_with")}>
              {PAID_WITH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Purchase date"><input type="date" className="input !py-2" max={localDateISO()} value={f.purchase_date} onChange={set("purchase_date")} /></Field>
        </div>

        <div className="rounded-2xl bg-white p-3 ring-1 ring-ink/10">
          <div className="grid grid-cols-[1fr_80px_100px_110px_90px_32px] gap-2 px-1 text-xs font-semibold uppercase text-ink-soft">
            <span>Item</span><span>Qty</span><span>Unit</span><span>Price each</span><span className="text-right">Total</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="mt-2 grid grid-cols-[1fr_80px_100px_110px_90px_32px] items-center gap-2">
              <input className="input !py-1.5" placeholder="Chicken wings 40 lb" value={l.name} onChange={(e) => setLine(i, "name", e.target.value)} />
              <input className="input !py-1.5" type="number" step="0.01" min="0" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              <select className="input !py-1.5 !pl-2 text-sm" value={UNITS.includes(l.unit) || !l.unit ? l.unit : l.unit} onChange={(e) => setLine(i, "unit", e.target.value)}>
                <option value="">—</option>
                {[...UNITS, ...(l.unit && !UNITS.includes(l.unit) ? [l.unit] : [])].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <input className="input !py-1.5" type="number" step="0.01" min="0" placeholder="0.00" value={l.unit_cost} onChange={(e) => setLine(i, "unit_cost", e.target.value)} />
              <span className="text-right text-sm tabular-nums">{usd((parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0))}</span>
              <button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank()])} className="text-ink-soft hover:text-flame" aria-label="Remove line">✕</button>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-3 text-sm">
            <button type="button" className="font-semibold text-flame" onClick={() => setLines([...lines, blank()])}>+ Add item</button>
            <div className="flex items-center gap-3">
              <span>Subtotal <b className="tabular-nums">{usd(subtotal)}</b></span>
              <label className="flex items-center gap-1">Tax <input className="input !w-24 !py-1" type="number" step="0.01" min="0" value={f.tax} onChange={set("tax")} /></label>
              <span className="font-display text-xl font-extrabold">{usd(total)}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason — why was this bought?">
            <textarea className="input !py-2" rows={3} required placeholder="Weekend stock for wings; ran out of fryer oil…" value={f.reason} onChange={set("reason")} />
          </Field>
          <Field label={existing ? "Replace receipt (optional)" : "Receipt photo or PDF"} hint="On a phone this opens the camera.">
            <input type="file" accept="image/*,application/pdf" capture="environment" className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:font-semibold file:text-cream"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        {existing && (
          <Field label="Why are you changing it?">
            <input className="input !py-2" required placeholder="Wrong quantity on line 1…" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={err} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            {existing ? ((user?.level ?? 0) >= 5 ? "As admin, your edit is saved right away." : "Your edit goes to the next role up for approval.")
              : autoOk ? "Your purchases are approved automatically (the admin is notified)."
              : `This goes to a ${(user?.level ?? 0) >= 3 ? "super admin" : "supervisor"} for approval.`}
          </p>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : existing ? "Send change" : "Submit purchase"}</button>
        </div>
      </form>
    </Modal>
  );
}

function printPurchase(p: Purchase) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const rows = p.lines.map((l) => `<tr><td>${l.name}</td><td class=r>${parseFloat(l.quantity)} ${l.unit}</td><td class=r>$${l.unit_cost}</td><td class=r>$${l.line_total}</td></tr>`).join("");
  w.document.write(`<!doctype html><title>Purchase #${p.id}</title><style>
    body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}
    td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}.r{text-align:right}.muted{color:#666;font-size:13px}
    img{max-width:100%;max-height:500px;margin-top:16px;border:1px solid #ddd}</style>
    <h1>${SITE_NAME} — Purchase #${p.id}</h1>
    <p class=muted>${p.branch_name} · ${p.purchase_date} · ${p.vendor}${p.invoice_number ? " · Invoice #" + p.invoice_number : ""}</p>
    <p class=muted>${p.category_display} · Paid with ${p.paid_with_display} · Status: ${p.status_display}</p>
    <table><tr><th>Item</th><th class=r>Qty</th><th class=r>Each</th><th class=r>Total</th></tr>${rows}
    <tr><td colspan=3 class=r>Subtotal</td><td class=r>$${p.subtotal}</td></tr><tr><td colspan=3 class=r>Tax</td><td class=r>$${p.tax}</td></tr>
    <tr><th colspan=3 class=r>Total</th><th class=r>$${p.total}</th></tr></table>
    <p><b>Reason:</b> ${p.reason}</p>
    <p class=muted>Submitted by ${p.submitted_by_name ?? "—"}${p.reviewed_by_name ? ` · Reviewed by ${p.reviewed_by_name}` : ""}</p>
    ${p.receipt_url && !/\.pdf$/i.test(p.receipt_url) ? `<img src="${p.receipt_url}">` : ""}
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>`);
  w.document.close();
}

export function PurchaseDetail({ p, onClose, onChanged, canReview }: {
  p: Purchase; onClose: () => void; onChanged?: (p: Purchase) => void; canReview?: boolean;
}) {
  const { user } = usePosAuth();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const isMine = p.submitted_by === user?.id;
  const canEdit = !!user && canEditEntry(user.level, p.submitted_by_level, isMine);
  const review = async (decision: "approve" | "reject") => {
    setErr(null);
    try { onChanged?.(await manageApi.reviewPurchase(p.id, decision, note)); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  if (editing) return <PurchaseForm existing={p} onClose={() => setEditing(false)} onEditSent={(m) => { setEditing(false); setMsg(m); }} />;
  return (
    <Modal title={`${p.vendor} · ${usd(p.total)}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge status={p.status}>{p.status_display}{p.needs_role ? ` · ${p.needs_role}` : ""}</Badge>
        <span>🏪 {p.branch_name}</span><span>· {p.category_display}</span><span>· {d(p.purchase_date)}</span>
        <span>· {p.paid_with_display}</span>{p.invoice_number && <span>· #{p.invoice_number}</span>}
        <span className="ml-auto flex gap-2">
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => printPurchase(p)}>🖨 Print</button>
          {canEdit && <button className="btn-dark !px-3 !py-1.5 text-xs" onClick={() => setEditing(true)}>✏️ Edit</button>}
        </span>
      </div>
      {msg && <p className="mt-3 rounded-xl bg-leaf/10 p-3 text-sm font-semibold text-leaf">{msg}</p>}
      {!canEdit && isMine && user && user.level < 5 && (
        <p className="mt-3 text-xs text-ink-soft">You can’t edit your own entry — a higher role can correct it.</p>
      )}
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase text-ink-soft"><tr><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Each</th><th className="text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-ink/5">
          {p.lines.map((l) => (
            <tr key={l.id}><td className="py-1.5">{l.name}</td><td className="text-right">{parseFloat(l.quantity)} {l.unit}</td>
              <td className="text-right tabular-nums">{usd(l.unit_cost)}</td><td className="text-right tabular-nums">{usd(l.line_total!)}</td></tr>
          ))}
        </tbody>
        <tfoot className="text-right">
          <tr><td colSpan={3} className="pt-2">Subtotal</td><td className="pt-2 tabular-nums">{usd(p.subtotal)}</td></tr>
          <tr><td colSpan={3}>Tax</td><td className="tabular-nums">{usd(p.tax)}</td></tr>
          <tr className="font-bold"><td colSpan={3}>Total</td><td className="tabular-nums">{usd(p.total)}</td></tr>
        </tfoot>
      </table>
      <p className="mt-4 rounded-xl bg-white p-3 text-sm ring-1 ring-ink/10"><b>Reason:</b> {p.reason}</p>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft">
        <span>Submitted by {p.submitted_by_name} · {dt(p.created_at)}</span>
        {p.reviewed_by_name && <span>{p.status === "approved" ? "Approved" : "Reviewed"} by {p.reviewed_by_name}{p.reviewed_at ? ` · ${dt(p.reviewed_at)}` : ""}{p.review_note ? ` — “${p.review_note}”` : ""}</span>}
      </div>
      {p.receipt_url ? (
        <a href={p.receipt_url} target="_blank" rel="noreferrer" className="mt-3 block">
          {/\.pdf$/i.test(p.receipt_url) ? <span className="btn-ghost !py-2 text-sm">📄 Open receipt PDF</span>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={p.receipt_url} alt="Receipt" className="max-h-72 rounded-xl ring-1 ring-ink/10" />}
        </a>
      ) : <p className="mt-3 text-sm text-ink-soft">No receipt attached.</p>}
      <div className="mt-4 border-t border-ink/10 pt-3">
        <button className="text-sm font-semibold text-flame" onClick={() => setShowHistory(!showHistory)}>🕘 {showHistory ? "Hide" : "Show"} change history</button>
        {showHistory && <div className="mt-2"><RecordHistory model="purchase" id={p.id} /></div>}
      </div>
      {canReview && p.status === "pending" && !isMine && (
        <div className="mt-5 space-y-2 border-t border-ink/10 pt-4">
          <input className="input !py-2" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <ErrorBox error={err} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost !py-2.5 text-flame" onClick={() => review("reject")}>✕ Reject</button>
            <button className="btn-primary !py-2.5" onClick={() => review("approve")}>✓ Approve</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
