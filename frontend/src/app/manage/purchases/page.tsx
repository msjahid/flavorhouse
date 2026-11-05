"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PurchaseDetail, PurchaseForm } from "@/components/manage/PurchaseViews";
import { Badge, Card, d, Empty, ErrorBox, PageHeader, PeriodPicker, Stat, useBranchFilter, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, PURCHASE_CATEGORIES, type Purchase, type Vendor } from "@/lib/manage";

export default function PurchasesPage() {
  return <Suspense><PurchasesInner /></Suspense>;
}

function PurchasesInner() {
  const { user } = usePosAuth();
  const period = usePeriod("month");
  const { branch, picker } = useBranchFilter();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const params = useSearchParams();
  const [vendor, setVendor] = useState(params.get("vendor") ?? "");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  useEffect(() => { manageApi.vendors(true).then(setVendors).catch(() => {}); }, []);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Purchase | null>(null);
  const { data, error, reload } = useLoad(
    () => manageApi.purchases({ ...period.params, branch, status, category, vendor }), [period.key, branch, status, category, vendor]);

  const sum = (st: string) => (data ?? []).filter((p) => p.status === st).reduce((s, p) => s + parseFloat(p.total), 0);

  return (
    <div>
      <PageHeader title="Purchases" sub="Everything bought for the restaurant, with receipts and approvals">
        <button className="btn-primary" onClick={() => setAdding(true)}>+ New purchase</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {picker}
        <PeriodPicker value={period.value} onChange={period.setValue} />
        <Select value={status} onChange={setStatus} options={[{ value: "", label: "All statuses" }, { value: "pending", label: "Waiting for approval", icon: "⏳" },
          { value: "approved", label: "Approved", icon: "✅" }, { value: "rejected", label: "Rejected", icon: "⛔" }]} />
        <Select value={vendor} onChange={setVendor} options={[{ value: "", label: "All vendors", icon: "🚚" }, ...vendors.map((v) => ({ value: String(v.id), label: v.name }))]} />
        <Select value={category} onChange={setCategory} options={[{ value: "", label: "All categories", icon: "🏷" }, ...PURCHASE_CATEGORIES.map(([k, l]) => ({ value: k, label: l }))]} />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Approved" value={usd(sum("approved"))} tone="dark" />
        <Stat label="Waiting for approval" value={usd(sum("pending"))} sub={`${(data ?? []).filter((p) => p.status === "pending").length} purchases`} />
        <Stat label="Rejected" value={usd(sum("rejected"))} />
      </div>
      <ErrorBox error={error} />
      <Card>
        {data && data.length === 0 ? <Empty>No purchases for this period.</Empty> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-soft">
              <tr><th className="py-2">Date</th><th>Branch</th><th>Vendor</th><th>Category</th><th>Paid with</th><th>By</th><th>Status</th><th className="text-right">Total</th><th>🧾</th></tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {(data ?? []).map((p) => (
                <tr key={p.id} onClick={() => setOpen(p)} className="cursor-pointer hover:bg-cream">
                  <td className="py-2.5 whitespace-nowrap">{d(p.purchase_date)}</td><td>{p.branch_name}</td>
                  <td className="font-semibold">{p.vendor}{p.invoice_number && <span className="block text-xs font-normal text-ink-soft">#{p.invoice_number}</span>}</td>
                  <td>{p.category_display}</td><td>{p.paid_with_display}</td><td>{p.submitted_by_name}</td>
                  <td><Badge status={p.status}>{p.status === "pending" ? `Needs ${p.needs_role}` : p.status_display}</Badge></td>
                  <td className="text-right font-bold tabular-nums">{usd(p.total)}</td><td>{p.receipt_url ? "📎" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {adding && <PurchaseForm onClose={() => setAdding(false)} onDone={(p) => { setAdding(false); reload(); setOpen(p); }} />}
      {open && <PurchaseDetail p={open} onClose={() => setOpen(null)} canReview={(user?.level ?? 0) >= 3}
        onChanged={(p) => { setOpen(p); reload(); }} />}
    </div>
  );
}
