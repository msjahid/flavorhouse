"use client";

import Link from "next/link";
import BarChart from "@/components/BarChart";
import { Card, Empty, ErrorBox, PageHeader, PeriodPicker, Stat, useBranchFilter, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type Breakdown } from "@/lib/manage";

export default function OverviewPage() {
  const { user } = usePosAuth();
  const period = usePeriod("week");
  const { branch, picker } = useBranchFilter();
  const { data, error, loading } = useLoad(() => manageApi.summary({ ...period.params, branch }), [period.key, branch]);
  const s = data?.sales;
  const estProfit = data
    ? parseFloat(data.sales.net) - parseFloat(data.purchases.approved_total) - parseFloat(data.labor)
    : 0;

  return (
    <div>
      <PageHeader title={`Hi ${user?.name.split(" ")[0]} 👋`} sub="Sales, purchases, labor and cash at a glance">
        {picker}
        <PeriodPicker value={period.value} onChange={period.setValue} />
      </PageHeader>
      <ErrorBox error={error} />
      {data && s && (
        <div className={loading ? "opacity-60" : ""}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Sales (incl. tax)" value={usd(s.gross)} sub={`${s.orders} orders · avg ${usd(s.average_order)}`} tone="dark" />
            <Stat label="Net food & drink sales" value={usd(s.net)} sub={`after ${usd(s.discounts)} discounts`} />
            <Stat label="Purchases (approved)" value={usd(data.purchases.approved_total)}
                  sub={data.purchases.pending.count ? `${data.purchases.pending.count} waiting · ${usd(data.purchases.pending.total)}` : "nothing waiting"} />
            <Stat label="Labor (gross wages)" value={usd(data.labor)} />
            <Stat label="Est. profit" value={usd(estProfit)} sub="net sales − purchases − labor" tone={estProfit >= 0 ? "good" : "bad"} />
            <Stat label="Refunds" value={usd(s.refunds.total)} sub={`${s.refunds.count} orders`} />
            <Stat label="Discounts given" value={usd(s.discounts)} sub={`${s.discounted_orders} orders`} />
            <Stat label="Cash over / short" value={usd(data.cash.over_short)} sub={`${data.cash.closes} days closed`}
                  tone={Math.abs(parseFloat(data.cash.over_short)) >= 5 ? "bad" : "default"} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Sales by day" className="lg:col-span-2">
              {s.by_day.length > 1 ? (
                <BarChart data={s.by_day.map((d) => ({
                  label: new Date(`${d.date}T12:00`).toLocaleDateString([], { month: "short", day: "numeric" }),
                  value: parseFloat(d.total), tip: `${d.count} orders`,
                }))} labelEvery={Math.ceil(s.by_day.length / 12)} />
              ) : (
                <BarChart data={s.by_hour.filter((h) => h.hour >= 10 && h.hour <= 23).map((h) => ({
                  label: `${h.hour % 12 || 12}${h.hour < 12 ? "a" : "p"}`, value: parseFloat(h.total), tip: `${h.count} orders`,
                }))} labelEvery={2} />
              )}
            </Card>
            <Card title="Best sellers">
              {s.top_items.length === 0 ? <Empty>No sales yet</Empty> : (
                <ol className="space-y-1.5 text-sm">
                  {s.top_items.slice(0, 8).map((t, i) => (
                    <li key={t.name} className="flex justify-between gap-2">
                      <span><span className="text-ink-soft">{i + 1}.</span> {t.name}</span>
                      <span className="tabular-nums text-ink-soft">{t.qty} · <b className="text-ink">{usd(t.total)}</b></span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          {data.branches && (
            <Card title="Branches side by side" className="mt-4">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ink-soft">
                  <tr><th className="py-2">Branch</th><th className="text-right">Orders</th><th className="text-right">Sales</th><th className="text-right">Net</th><th className="text-right">Avg order</th><th className="text-right">Discounts</th></tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {data.branches.map((b) => (
                    <tr key={b.id}><td className="py-2 font-semibold">🏪 {b.name}</td><td className="text-right tabular-nums">{b.orders}</td>
                      <td className="text-right tabular-nums font-bold">{usd(b.gross)}</td><td className="text-right tabular-nums">{usd(b.net)}</td>
                      <td className="text-right tabular-nums">{usd(b.average_order)}</td><td className="text-right tabular-nums">{usd(b.discounts)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <SplitCard title="Payment" rows={s.by_payment} />
            <SplitCard title="Where orders came from" rows={s.by_source} />
            <Card title="Purchases by category" action={<Link href="/manage/purchases" className="text-sm font-semibold text-flame">All →</Link>}>
              {data.purchases.by_category.length === 0 ? <Empty>No approved purchases</Empty> : <Bars rows={data.purchases.by_category} />}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SplitCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  return <Card title={title}>{rows.length === 0 ? <Empty>No sales</Empty> : <Bars rows={rows} />}</Card>;
}

function Bars({ rows }: { rows: Breakdown[] }) {
  const max = Math.max(...rows.map((r) => parseFloat(r.total)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums"><b>{usd(r.total)}</b> <span className="text-ink-soft">· {r.count}</span></span></div>
          <div className="mt-1 h-2 rounded-full bg-cream-dark"><div className="h-2 rounded-full bg-flame" style={{ width: `${(parseFloat(r.total) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
