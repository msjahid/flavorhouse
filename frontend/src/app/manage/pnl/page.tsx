"use client";

import BarChart from "@/components/BarChart";
import { Card, ErrorBox, PageHeader, PeriodPicker, Stat, useLoad, usePeriod, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type PnlBlock } from "@/lib/manage";

const ROWS: [keyof PnlBlock, string, "money" | "pct" | "int", string?][] = [
  ["orders", "Orders", "int"],
  ["gross_sales", "Gross sales (incl. tax)", "money"],
  ["discounts", "− Discounts", "money"],
  ["refunds", "Refunds (excluded)", "money"],
  ["app_sales", "  incl. delivery-app sales (entered daily)", "money"],
  ["net_sales", "Net food & drink sales", "money", "font-bold"],
  ["cogs", "− Food & drink purchases (COGS)", "money"],
  ["gross_profit", "Gross profit", "money", "font-bold"],
  ["expenses", "− Other expenses (supplies, rent, repairs…)", "money"],
  ["bills", "− Monthly bills (electric, gas, trash, internet…)", "money"],
  ["labor", "− Labor (gross wages)", "money"],
  ["app_fees", "− Delivery app fees (Uber Eats, DoorDash…)", "money"],
  ["net_profit", "Net profit", "money", "font-extrabold text-base"],
  ["profit_margin", "Profit margin", "pct"],
  ["food_cost_pct", "Food cost %", "pct"],
  ["labor_cost_pct", "Labor cost %", "pct"],
  ["prime_cost_pct", "Prime cost % (food + labor)", "pct"],
  ["tax_collected", "Sales tax collected (owed to the state)", "money"],
  ["tips", "Tips paid by customers (owed to staff, not a sale)", "money"],
  ["cash_to_deposit", "Cash to deposit (from closings)", "money"],
  ["deposited", "Deposited to bank", "money"],
  ["deposits_unverified", "Deposits not yet verified", "int"],
  ["over_short", "Cash over / short", "money"],
];

function fmt(v: unknown, kind: string) {
  if (kind === "money") return usd(String(v));
  if (kind === "pct") return `${v}%`;
  return String(v);
}

export default function PnlPage() {
  const { user } = usePosAuth();
  const period = usePeriod("month");
  const { data, error, loading } = useLoad(() => manageApi.pnl(period.params), [period.key]);

  if ((user?.level ?? 0) < 4) return <p className="text-ink-soft">Profit &amp; loss is for super admins and admins.</p>;
  const t = data?.total;
  const profit = t ? parseFloat(t.net_profit) : 0;
  const gap = t ? parseFloat(t.cash_to_deposit) - parseFloat(t.deposited) : 0;

  return (
    <div>
      <PageHeader title="Profit & loss" sub="Final report across both branches">
        <PeriodPicker value={period.value} onChange={period.setValue} />
        <button className="btn-dark !py-2 print:hidden" onClick={() => window.print()}>🖨 Print</button>
      </PageHeader>
      <ErrorBox error={error} />
      {t && data && (
        <div className={loading ? "opacity-60" : ""}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Net sales" value={usd(t.net_sales)} sub={`${t.orders} orders`} tone="dark" />
            <Stat label="Net profit" value={usd(t.net_profit)} sub={`${t.profit_margin}% margin`} tone={profit >= 0 ? "good" : "bad"} />
            <Stat label="Food cost" value={`${t.food_cost_pct}%`} sub="typical 28–35%" tone={parseFloat(t.food_cost_pct) > 35 ? "bad" : "default"} />
            <Stat label="Labor cost" value={`${t.labor_cost_pct}%`} sub="typical 25–35%" tone={parseFloat(t.labor_cost_pct) > 35 ? "bad" : "default"} />
            <Stat label="Cash not yet deposited" value={usd(gap)} sub={`${t.deposits_unverified} deposits unverified`} tone={gap > 1 ? "bad" : "good"} />
          </div>

          <Card title="Statement" className="mt-4">
            <table className="w-full text-sm">
              <thead className="text-right text-xs uppercase text-ink-soft">
                <tr><th className="py-2 text-left">&nbsp;</th>{data.branches.map((b) => <th key={b.name}>{b.name === "Head office" ? "🏢" : "🏪"} {b.name}</th>)}<th className="text-ink">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {ROWS.map(([k, label, kind, cls]) => (
                  <tr key={k} className={cls ?? ""}>
                    <td className="py-2">{label}</td>
                    {data.branches.map((b) => <td key={b.name} className="text-right tabular-nums">{fmt(b[k], kind)}</td>)}
                    <td className={`text-right tabular-nums ${k === "net_profit" ? (profit >= 0 ? "text-leaf" : "text-flame") : ""}`}>{fmt(t[k], kind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Sales by day (all branches)" className="lg:col-span-2">
              <BarChart data={t.by_day.map((x) => ({ label: new Date(`${x.date}T12:00`).toLocaleDateString([], { month: "short", day: "numeric" }), value: parseFloat(x.total), tip: `${x.count} orders` }))}
                        labelEvery={Math.ceil(t.by_day.length / 12)} />
            </Card>
            <Card title="Where the money went (purchases)">
              <ul className="space-y-1.5 text-sm">
                {t.by_category.map((c) => <li key={c.key} className="flex justify-between"><span>{c.label}</span><b className="tabular-nums">{usd(c.total)}</b></li>)}
                {t.by_category.length === 0 && <li className="text-ink-soft">No approved purchases</li>}
              </ul>
            </Card>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Head office = salaried supervisors, super admins and admins who aren&apos;t tied to one branch, so every column adds up to the total.
            Net sales exclude tax, discounts and refunds. Purchases count on their purchase date (approved only). Labor is gross wages from clock-ins
            (before employer payroll taxes). This is a management report — your accountant prepares the official books.
          </p>
        </div>
      )}
    </div>
  );
}
