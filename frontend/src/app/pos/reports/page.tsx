"use client";

import { DatePicker } from "@/components/Pickers";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { localDateISO, posApi, type Breakdown, type DailyReport } from "@/lib/pos";
import { usePosAuth } from "@/context/PosAuth";

export default function ReportsPage() {
  const { branchId, branchName } = usePosAuth();
  const [date, setDate] = useState(localDateISO());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setError(null);
    posApi.dailyReport(date, branchId)
      .then((r) => !off && setReport(r))
      .catch((e: Error) => !off && setError(e.message));
    return () => { off = true; };
  }, [date, branchId]);

  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(localDateISO(d));
  };

  return (
    <div className="h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto max-w-6xl p-6">
        <div className="flex flex-wrap items-center gap-2 print:[&>*:not(h1)]:hidden">
          <h1 className="mr-auto font-display text-3xl font-extrabold">Daily sales <span className="text-lg text-ink-soft">· {branchName}</span></h1>
          <button className="btn-ghost !px-3 !py-2" onClick={() => shift(-1)} aria-label="Previous day">←</button>
          <DatePicker value={date} max={localDateISO()} onChange={setDate} />
          <button className="btn-ghost !px-3 !py-2" onClick={() => shift(1)} aria-label="Next day">→</button>
          <button className="btn-ghost !py-2" onClick={() => setDate(localDateISO())}>Today</button>
          <button className="btn-dark !py-2" onClick={() => window.print()}>🖨 Print</button>
        </div>

        {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}
        {report && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Total sales" value={money(report.gross)} hero />
              <Stat label="Orders" value={String(report.orders)} />
              <Stat label="Average order" value={money(report.average_order)} />
              <Stat label="Refunds" value={money(report.refunds.total)} sub={`${report.refunds.count} orders`} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <Mini label="Food & drink (net)" value={money(report.net)} />
              <Mini label="Tax collected" value={money(report.tax)} />
              <Mini label="Delivery fees" value={money(report.delivery_fees)} />
            </div>

            <section className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <h2 className="font-display text-lg font-bold">Sales by hour</h2>
              <HourChart data={report.by_hour} />
            </section>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <BreakdownCard title="Payment method" rows={report.by_payment} gross={report.gross} />
              <BreakdownCard title="Where orders came from" rows={report.by_source} gross={report.gross} />
              <BreakdownCard title="Order type" rows={report.by_fulfillment} gross={report.gross} />
            </div>

            <section className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <h2 className="font-display text-lg font-bold">Best sellers</h2>
              {report.top_items.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">No sales on this day.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
                    <tr><th className="py-2">#</th><th>Item</th><th className="text-right">Sold</th><th className="text-right">Revenue</th></tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {report.top_items.map((t, i) => (
                      <tr key={t.name}>
                        <td className="py-2 text-ink-soft">{i + 1}</td>
                        <td className="font-semibold">{t.name}</td>
                        <td className="text-right tabular-nums">{t.qty}</td>
                        <td className="text-right tabular-nums">{money(t.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <p className="mt-4 text-xs text-ink-soft">
              Counts paid, preparing, ready and completed orders. Cancelled and refunded orders are excluded.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div className={`rounded-3xl p-5 ${hero ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/5"}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${hero ? "text-cream/60" : "text-ink-soft"}`}>{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-ink/5">
      <span className="text-ink-soft">{label}</span>
      <b className="tabular-nums">{value}</b>
    </div>
  );
}

function BreakdownCard({ title, rows, gross }: { title: string; rows: Breakdown[]; gross: string }) {
  const g = parseFloat(gross) || 0;
  return (
    <section className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {rows.length === 0 && <p className="mt-3 text-sm text-ink-soft">No sales.</p>}
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const pct = g ? (parseFloat(r.total) / g) * 100 : 0;
          return (
            <li key={r.key}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{r.label}</span>
                <span className="tabular-nums"><b>{money(r.total)}</b> <span className="text-ink-soft">· {r.count}</span></span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-cream-dark">
                <div className="h-2 rounded-full bg-flame" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Single-series bar chart: one hue, thin bars, rounded tops, hover tooltip per bar. */
function HourChart({ data }: { data: DailyReport["by_hour"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const withSales = data.filter((d) => d.count > 0).map((d) => d.hour);
  const first = withSales.length ? Math.min(...withSales, 10) : 10;
  const last = withSales.length ? Math.max(...withSales, 22) : 22;
  const hours = data.filter((d) => d.hour >= first && d.hour <= last);
  const max = Math.max(...hours.map((d) => parseFloat(d.total)), 1);
  const nice = niceMax(max);
  const label = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

  return (
    <div className="mt-4">
      <div className="relative flex h-48 items-end gap-[2px] border-b border-ink/15 pl-12">
        {[0.5, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute left-12 right-0 border-t border-dashed border-ink/10" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -left-12 -top-2 w-10 text-right text-[11px] text-ink-soft tabular-nums">{money(nice * f).replace(".00", "")}</span>
          </div>
        ))}
        {hours.map((d) => {
          const v = parseFloat(d.total);
          return (
            <div key={d.hour} className="relative flex h-full flex-1 items-end justify-center"
                 onMouseEnter={() => setHover(d.hour)} onMouseLeave={() => setHover(null)}>
              <div className={`w-full max-w-8 rounded-t-[4px] transition-colors ${hover === d.hour ? "bg-flame-dark" : "bg-flame"}`}
                   style={{ height: `${(v / nice) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
              {hover === d.hour && (
                <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-cream shadow">
                  <b>{label(d.hour)}–{label((d.hour + 1) % 24)}</b> · {money(v)} · {d.count} orders
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] pl-12">
        {hours.map((d) => (
          <span key={d.hour} className="flex-1 text-center text-[11px] text-ink-soft">{d.hour % 2 === 0 ? label(d.hour) : ""}</span>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}
