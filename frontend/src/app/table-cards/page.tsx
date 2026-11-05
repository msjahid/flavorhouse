"use client";

import { useEffect, useState } from "react";
import { SITE_NAME } from "@/lib/format";
import { siteUrl } from "@/lib/restaurant";
import QrCode from "@/components/QrCode";

/** Printable QR table cards — 4 per page, with dashed cut lines. */
export default function TableCardsPage() {
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(8);
  const [url, setUrl] = useState("");
  const [showNumbers, setShowNumbers] = useState(true);

  useEffect(() => setUrl(siteUrl() + "/menu"), []);

  const count = Math.max(0, Math.min(100, to - from + 1));
  const tables = Array.from({ length: count }, (_, i) => from + i);
  const pages: number[][] = [];
  for (let i = 0; i < tables.length; i += 4) pages.push(tables.slice(i, i + 4));

  return (
    <div className="min-h-screen bg-cream-dark/60 py-8 print:bg-white print:py-0">
      <style>{`@page { size: letter; margin: 0; }`}</style>

      <div className="mx-auto mb-6 max-w-[8.5in] space-y-3 px-4 print:hidden">
        <h1 className="font-display text-2xl font-extrabold">QR table cards</h1>
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10">
          <label className="text-sm font-semibold">From table
            <input type="number" min={1} value={from} onChange={(e) => setFrom(Math.max(1, +e.target.value || 1))} className="input mt-1 !w-24 !py-2" />
          </label>
          <label className="text-sm font-semibold">To table
            <input type="number" min={from} value={to} onChange={(e) => setTo(+e.target.value || from)} className="input mt-1 !w-24 !py-2" />
          </label>
          <label className="flex-1 text-sm font-semibold">QR code opens
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="input mt-1 !py-2" />
          </label>
          <label className="flex items-center gap-2 pb-3 text-sm font-semibold">
            <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> Table numbers
          </label>
          <button onClick={() => window.print()} className="btn-primary">🖨 Print {count} cards</button>
        </div>
        <p className="text-sm text-ink-soft">
          Prints 4 cards per US Letter page. Cut along the dashed lines and put them in table stands, or fold in half
          to stand on their own. Test-scan one card with your phone before printing them all.
        </p>
      </div>

      {url && pages.map((page, p) => (
        <div key={p} className={`mx-auto mb-6 grid h-[11in] w-[8.5in] grid-cols-2 grid-rows-2 bg-white shadow-xl print:mb-0 print:shadow-none ${p < pages.length - 1 ? "print:[break-after:page]" : ""}`}
             style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
          {page.map((n) => (
            <div key={n} className="flex flex-col items-center justify-between border border-dashed border-ink/25 px-6 py-8 text-center">
              <div>
                <p className="font-display text-[26px] font-extrabold leading-none text-ink">
                  <span className="text-flame">🔥</span> {SITE_NAME}
                </p>
                <p className="mt-1 text-[12px] text-ink-soft">Wings · Burgers · Shakes · Cakes</p>
              </div>
              <div className="rounded-2xl border-4 border-ink p-3">
                <QrCode value={url} className="h-[2.1in] w-[2.1in]" />
              </div>
              <div>
                <p className="font-display text-[20px] font-extrabold text-ink">Scan for our menu</p>
                <p className="text-[12px] text-ink-soft">Browse flavours &amp; order from your phone</p>
                {showNumbers && (
                  <p className="mx-auto mt-3 inline-block rounded-full bg-flame px-5 py-1.5 font-display text-[18px] font-extrabold text-white">
                    Table {n}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
