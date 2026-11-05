import type { Metadata } from "next";
import { getFullMenu } from "@/lib/api";
import { money, SITE_NAME } from "@/lib/format";
import { describeGroup, isFromPrice, sharedGroups } from "@/lib/menuText";
import { RESTAURANT } from "@/lib/restaurant";
import PrintButton from "@/components/PrintButton";
import SiteQr from "@/components/SiteQr";

export const metadata: Metadata = { title: "Printable menu", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Printable menu card. /menu-card (US Letter) or /menu-card?size=a4 */
export default async function MenuCardPage({ searchParams }: { searchParams: Promise<{ size?: string }> }) {
  const { size } = await searchParams;
  const a4 = size === "a4";
  const cats = (await getFullMenu().catch(() => [])).filter((c) => c.items.length);

  return (
    <div className="min-h-screen bg-cream-dark/60 py-8 print:bg-white print:py-0">
      <style>{`@page { size: ${a4 ? "A4" : "letter"}; margin: 0.4in; }`}</style>

      <div className="mx-auto mb-6 flex max-w-[8.5in] flex-wrap items-center gap-3 px-4 print:hidden">
        <h1 className="mr-auto font-display text-2xl font-extrabold">Printable menu</h1>
        <a href={a4 ? "/menu-card" : "/menu-card?size=a4"} className="btn-ghost !py-2 text-sm">
          Switch to {a4 ? "US Letter" : "A4"}
        </a>
        <PrintButton />
        <p className="w-full text-sm text-ink-soft">
          Uses your live menu and prices. Sold-out items are left out. In the print window choose your printer, or
          <b> Save as PDF</b> to send to a print shop. Turn on <b>Background graphics</b> for colour.
        </p>
      </div>

      <article className="mx-auto bg-white px-[0.55in] py-[0.5in] text-ink shadow-xl print:p-0 print:shadow-none"
               style={{ width: a4 ? "210mm" : "8.5in", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
        <header className="flex items-end justify-between border-b-4 border-ink pb-2">
          <div>
            <p className="font-display text-[30px] font-extrabold leading-none">
              <span className="text-flame">🔥</span> {SITE_NAME}
            </p>
            <p className="mt-1 text-[12px] text-ink-soft">{RESTAURANT.tagline}</p>
          </div>
          <p className="font-display text-[20px] font-extrabold uppercase tracking-[0.2em] text-flame">Menu</p>
        </header>

        <div className="mt-3 gap-7 text-[10.5px] leading-[1.3] [column-count:2] [column-fill:balance]">
          {cats.map((c) => {
            const { shared, isShared } = sharedGroups(c.items);
            return (
            <section key={c.id} className="mb-3 break-inside-avoid">
              <h2 className="mb-1.5 flex items-center gap-1.5 border-b border-ink/15 pb-1 font-display text-[17px] font-extrabold uppercase tracking-wide">
                <span>{c.emoji}</span>{c.name}
              </h2>
              {shared.length > 0 && (
                <div className="mb-2 rounded-md bg-cream px-2 py-1 text-[10px]">
                  {shared.map((g) => <p key={g.id}><b>All {c.name.toLowerCase()} · </b>{describeGroup(g)}</p>)}
                </div>
              )}
              {c.items.map((i) => (
                <div key={i.id} className="mb-1.5 break-inside-avoid">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12.5px] font-bold">{i.name}</span>
                    {i.is_spicy && <span title="Spicy">🌶</span>}
                    {i.is_vegetarian && <span title="Vegetarian">🌱</span>}
                    <span className="mb-[3px] flex-1 border-b border-dotted border-ink/30" />
                    <span className="text-[12.5px] font-extrabold tabular-nums">
                      {isFromPrice(i) && <span className="mr-0.5 text-[9px] font-semibold text-ink-soft">from</span>}
                      {money(i.price)}
                    </span>
                  </div>
                  {i.description && <p className="text-ink-soft">{i.description}</p>}
                  {i.option_groups.filter((g) => !isShared(g)).map((g) => (
                    <p key={g.id} className="text-[10px] text-ink-soft">{describeGroup(g)}</p>
                  ))}
                </div>
              ))}
            </section>
            );
          })}
        </div>

        <footer className="mt-1 flex break-inside-avoid items-center gap-5 border-t-4 border-ink pt-3 text-[11px]">
          <SiteQr path="/menu" className="h-[0.8in] w-[0.8in]" showUrl={false} />
          <div className="flex-1">
            <p className="font-display text-[15px] font-extrabold">Order online — scan the code</p>
            <p className="text-ink-soft">Pickup or delivery · pay securely by card</p>
            <p className="mt-1 text-ink-soft">🌶 spicy · 🌱 vegetarian · Prices before tax</p>
          </div>
          <div className="text-right">
            <p className="font-bold">Opening hours</p>
            {RESTAURANT.hours.map(([d, t]) => <p key={d}>{d} · {t}</p>)}
            {RESTAURANT.phone && <p className="mt-1">{RESTAURANT.phone}</p>}
            {RESTAURANT.address && <p>{RESTAURANT.address}</p>}
          </div>
        </footer>
      </article>
    </div>
  );
}
