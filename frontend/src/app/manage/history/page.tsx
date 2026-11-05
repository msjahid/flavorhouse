"use client";

import { DatePicker, Select } from "@/components/Pickers";
import { useState } from "react";
import { HistoryList } from "@/components/manage/ChangeViews";
import { Card, ErrorBox, PageHeader, PeriodPicker, useBranchFilter, useLoad, usePeriod } from "@/components/manage/ui";
import { manageApi } from "@/lib/manage";

const MODELS: [string, string][] = [
  ["", "Everything"], ["purchase", "Purchases"], ["daily close", "Closings"], ["day start", "Day starts"], ["bank deposit", "Bank deposits"],
  ["cash drop", "Cash drops"], ["clock-in", "Clock-ins"], ["staff", "Staff"], ["pay rate", "Pay rates"], ["pay statement", "Earnings"],
  ["store access", "Store access"], ["vendor", "Vendors"], ["menu item", "Menu items"], ["menu section", "Menu sections"], ["offer", "Offers"],
  ["TV screen", "TV screens"], ["order", "Refunds"], ["device", "Devices"], ["session", "Sign-ins"], ["delivery app", "Delivery apps"], ["tip settings", "Tip options"], ["tax filing", "Sales tax filings"], ["monthly bill", "Monthly bills"], ["delivery app day", "App daily sales"], ["delivery app payout", "App payouts"],
];

export default function HistoryPage() {
  const period = usePeriod("week");
  const { branch, picker } = useBranchFilter();
  const [model, setModel] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, loading } = useLoad(() => manageApi.history({ ...period.params, branch, model, q: search }), [period.key, branch, model, search]);

  return (
    <div>
      <PageHeader title="History" sub="Every change: who did it, who approved it, what it was before and after." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {picker}
        <PeriodPicker value={period.value} onChange={period.setValue} />
        <Select value={model} onChange={setModel} options={MODELS.map(([k, l]) => ({ value: k, label: l }))} />
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q); }} className="flex gap-2">
          <input className="input !w-56 !py-2" placeholder="Search name or text…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-dark !px-4 !py-2">Search</button>
        </form>
      </div>
      <ErrorBox error={error} />
      <Card>{loading && !data ? <p className="text-sm text-ink-soft">Loading…</p> : <HistoryList items={data ?? []} />}</Card>
      {data && data.length >= 500 && <p className="mt-2 text-xs text-ink-soft">Showing the latest 500 — narrow the dates to see more.</p>}
    </div>
  );
}
