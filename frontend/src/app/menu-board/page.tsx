import type { Metadata } from "next";
import { getFullMenu, getOffersNow, getScreen, type FullCategory, type LiveOffer, type ScreenConfig } from "@/lib/api";
import { money, SITE_NAME } from "@/lib/format";
import { categoryFlavours, isFromPrice } from "@/lib/menuText";
import type { MenuItemDetail } from "@/lib/types";
import AutoRefresh from "@/components/AutoRefresh";
import FitBoard from "@/components/FitBoard";
import SiteQr from "@/components/SiteQr";

export const metadata: Metadata = { title: "Menu board", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * TV menu board. Open full-screen on a TV.
 *   /menu-board                          → all sections, classic price list
 *   /menu-board?categories=wings,burgers → only these sections
 *   /menu-board?layout=cards|featured    → photo cards / featured item + list
 *   /menu-board?portrait=1               → TV turned on its side
 *   /menu-board?screen=3                 → a saved layout (Back office → TV screens)
 */

type Theme = { page: string; card: string; accent: string; muted: string; chip: string; price: string };
const THEME: Record<ScreenConfig["theme"], Theme> = {
  dark: { page: "bg-ink text-cream", card: "bg-cream/[0.06]", accent: "text-mustard", muted: "text-cream/60", chip: "bg-flame text-white", price: "text-cream" },
  light: { page: "bg-cream text-ink", card: "bg-white shadow-sm", accent: "text-flame", muted: "text-ink-soft", chip: "bg-ink text-cream", price: "text-ink" },
  flame: { page: "bg-flame text-white", card: "bg-black/15", accent: "text-mustard", muted: "text-white/70", chip: "bg-ink text-cream", price: "text-white" },
};

const offerText = (o: LiveOffer) =>
  `${o.kind === "percent" ? `${parseFloat(o.value)}% off` : o.kind === "amount" ? `${money(o.value)} off` : `only ${money(o.value)}`} ${
    o.applies_to === "all" ? "everything" : o.applies_to === "category" ? o.category ?? "" : o.items.join(", ")}${o.until ? ` · until ${o.until}` : ""}`;

/** Best live offer price for an item (or null). */
function offerPrice(item: MenuItemDetail, category: string, offers: LiveOffer[]): number | null {
  const base = parseFloat(item.price);
  let best: number | null = null;
  for (const o of offers) {
    const hit = o.applies_to === "all" || (o.applies_to === "category" && o.category === category) || (o.applies_to === "items" && o.items.includes(item.name));
    if (!hit) continue;
    const v = parseFloat(o.value);
    const p = o.kind === "percent" ? base * (1 - v / 100) : o.kind === "amount" ? base - v : Math.min(base, v);
    const r = Math.max(0, Math.round(p * 100) / 100);
    if (r < base && (best === null || r < best)) best = r;
  }
  return best;
}

function Price({ item, cat, offers, t, big }: { item: MenuItemDetail; cat: string; offers: LiveOffer[]; t: Theme; big?: boolean }) {
  const deal = offerPrice(item, cat, offers);
  return (
    <span className={`font-display font-extrabold tabular-nums ${t.price}`}>
      {isFromPrice(item) && <span className={`mr-[0.25em] text-[0.6em] font-semibold ${t.muted}`}>from</span>}
      {deal !== null ? (
        <>
          <span className={`mr-[0.3em] text-[0.7em] line-through opacity-60`}>{money(item.price)}</span>
          <span className={big ? "text-mustard" : t.accent}>{money(deal)}</span>
        </>
      ) : money(item.price)}
    </span>
  );
}

function Pic({ item, className }: { item: MenuItemDetail; className: string }) {
  // The box gets the size; the emoji inside scales from it, so "em" sizes stay correct.
  return (
    <div className={`${className} overflow-hidden bg-black/10`}>
      {item.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={item.image} alt="" className="h-full w-full object-cover" />
        : <span className="grid h-full w-full place-items-center text-[4em] leading-none">{item.emoji || "🍽️"}</span>}
    </div>
  );
}

function Flavours({ flavours, t }: { flavours: string[]; t: Theme }) {
  if (!flavours.length) return null;
  return (
    <div className="pt-[0.9em]">
      <p className={`text-[1em] font-bold uppercase tracking-wider ${t.muted}`}>Flavours</p>
      <div className="mt-[0.4em] flex flex-wrap gap-[0.4em]">
        {flavours.map((f) => <span key={f} className={`rounded-full px-[0.8em] py-[0.25em] text-[1.05em] font-semibold ${t.chip}`}>{f}</span>)}
      </div>
    </div>
  );
}

function Qr({ t }: { t: Theme }) {
  return (
    <div className="flex items-center gap-[1em]">
      <div className="rounded-[0.6em] bg-cream p-[0.4em] text-ink"><SiteQr path="/menu" className="h-[5em] w-[5em]" showUrl={false} /></div>
      <p className={`text-[1.2em] font-semibold leading-snug ${t.price}`}>Scan to order<br />on your phone</p>
    </div>
  );
}

/** Classic: name ……… price */
function ListSection({ c, offers, t, flavours }: { c: FullCategory; offers: LiveOffer[]; t: Theme; flavours: string[] }) {
  return (
    <section className={`mb-[1.2em] break-inside-avoid rounded-[1.4em] p-[1.4em] ${t.card}`}>
      <h2 className={`flex items-center gap-[0.4em] font-display text-[2.3em] font-extrabold leading-none ${t.accent}`}><span>{c.emoji}</span>{c.name}</h2>
      <ul className="mt-[0.9em] space-y-[0.55em]">
        {c.items.map((i) => (
          <li key={i.id} className="flex items-baseline gap-[0.5em] text-[1.45em]">
            <span className="font-semibold">{i.name}</span>
            {i.is_spicy && <span className="text-[0.8em]">🌶</span>}{i.is_vegetarian && <span className="text-[0.8em]">🌱</span>}
            <span className="mb-[0.25em] flex-1 border-b-2 border-dotted border-current opacity-25" />
            <Price item={i} cat={c.name} offers={offers} t={t} />
          </li>
        ))}
      </ul>
      <Flavours flavours={flavours} t={t} />
    </section>
  );
}

/** Photo cards: picture, name, price */
function CardsSection({ c, offers, t, perRow }: { c: FullCategory; offers: LiveOffer[]; t: Theme; perRow: number }) {
  return (
    <section className="mb-[1.4em] break-inside-avoid">
      <h2 className={`mb-[0.5em] flex items-center gap-[0.4em] font-display text-[2.1em] font-extrabold leading-none ${t.accent}`}><span>{c.emoji}</span>{c.name}</h2>
      <div className="grid gap-[0.8em]" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
        {c.items.map((i) => {
          const deal = offerPrice(i, c.name, offers) !== null;
          return (
            <div key={i.id} className={`relative flex flex-col overflow-hidden rounded-[1em] ${t.card}`}>
              <Pic item={i} className="h-[8.5em] w-full" />
              {deal && <span className="absolute left-[0.5em] top-[0.5em] rounded-full bg-mustard px-[0.7em] py-[0.15em] text-[0.95em] font-extrabold text-ink">DEAL</span>}
              <div className="flex items-end justify-between gap-[0.4em] p-[0.7em]">
                <span className="text-[1.25em] font-bold leading-tight">{i.name}</span>
                <span className="shrink-0 text-[1.35em]"><Price item={i} cat={c.name} offers={offers} t={t} /></span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default async function MenuBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ categories?: string; qr?: string; screen?: string; layout?: string; portrait?: string }>;
}) {
  const q = await searchParams;
  const [all, screen] = await Promise.all([
    getFullMenu().catch(() => null),
    q.screen ? getScreen(q.screen).catch(() => null) : Promise.resolve(null),
  ]);
  const offers = !screen || screen.show_offers ? await getOffersNow(screen?.branch ?? null, "pos").catch(() => []) : [];
  const wanted = screen?.categories.length ? screen.categories : q.categories?.split(",").map((s) => s.trim()).filter(Boolean);
  const cats = (all ?? []).filter((c) => c.items.length && (!wanted?.length || wanted.includes(c.slug)))
    .sort((a, b) => (wanted?.length ? wanted.indexOf(a.slug) - wanted.indexOf(b.slug) : 0));
  const layout = (screen?.layout ?? q.layout ?? "list") as ScreenConfig["layout"];
  const portrait = screen ? screen.orientation === "portrait" : q.portrait === "1";
  const t = THEME[screen?.theme ?? "dark"];
  const showQr = screen ? screen.show_qr : q.qr !== "0";
  const showFlavours = screen ? screen.show_flavours : true;
  const auto = portrait ? (cats.length > 4 ? 2 : 1) : cats.length <= 2 ? cats.length || 1 : cats.length === 4 ? 2 : 3;
  const cols = portrait ? auto : screen?.columns ? Math.min(screen.columns, Math.max(cats.length, 1), 4) : auto;
  const allItems = cats.flatMap((c) => c.items.map((i) => ({ i, cat: c.name })));
  // Flavour chips once per distinct list (combos reuse the wing flavours, so they aren't repeated)
  const seenFlavours = new Set<string>();
  const flavoursFor = Object.fromEntries(cats.map((c) => {
    const f = showFlavours ? categoryFlavours(c.items) : [];
    const key = [...f].sort().join("|");
    if (!f.length || seenFlavours.has(key)) return [c.id, [] as string[]];
    seenFlavours.add(key);
    return [c.id, f];
  }));
  const featured = (screen?.featured.length ? screen.featured.map((id) => allItems.find((x) => x.i.id === id)).filter(Boolean) as typeof allItems
    : allItems.filter((x) => x.i.is_featured)).slice(0, portrait ? 2 : 3);

  // Flavour chips: show each set once (e.g. combos repeat the wing flavours).
  const seen = new Set<string>();
  const chips = new Map<number, string[]>();
  for (const c of [...cats].sort((a, b) => Number(/combo/i.test(a.slug)) - Number(/combo/i.test(b.slug)))) {
    const f = showFlavours ? categoryFlavours(c.items) : [];
    const key = [...f].sort().join("|");
    chips.set(c.id, f.length && !seen.has(key) ? f : []);
    if (f.length) seen.add(key);
  }
  const base = portrait ? "min(2.3vw, 1.3vh)" : "min(1.05vw, 1.85vh)";

  return (
    // Text is sized in "em" and FitBoard shrinks it until the whole board fits the TV — nothing overlaps.
    <FitBoard base={base} className={t.page}>
      <AutoRefresh seconds={60} />
      <div className="flex flex-col px-[2.2em] pb-[1.5em] pt-[1.3em]">
        <header className="mb-[1em] flex items-center justify-between gap-[1.5em]">
          <h1 className="whitespace-nowrap font-display text-[3.3em] font-extrabold leading-none">
            <span className={screen?.theme === "flame" ? "" : "text-flame"}>🔥</span> {screen?.title || SITE_NAME}
          </h1>
          <div className="flex items-center gap-[1.5em]">
            {!portrait && (
              <p className={`text-right text-[1.45em] font-semibold ${t.muted}`}>
                {screen?.subtitle || <>Order at the counter <span className={t.accent}>or online</span></>}
              </p>
            )}
            {showQr && <Qr t={t} />}
          </div>
        </header>

        {offers.length > 0 && (
          <div className="mb-[1em] flex flex-wrap gap-[0.6em]">
            {offers.slice(0, 4).map((o) => (
              <span key={o.id} className={`rounded-[0.8em] px-[1em] py-[0.4em] text-[1.35em] font-bold ${t.chip}`}>🏷 {o.name}: {offerText(o)}</span>
            ))}
          </div>
        )}

        {!all ? (
          <p className="m-auto text-[2em] opacity-60">Menu is loading… (can&apos;t reach the menu API)</p>
        ) : layout === "featured" && featured.length ? (
          <main className={`grid gap-[1.4em] ${portrait ? "" : "grid-cols-[1fr_1.3fr] items-start"}`}>
            <div className={`grid gap-[1em] ${portrait ? "grid-cols-2" : ""}`}>
              {featured.map(({ i, cat }) => (
                <div key={i.id} className={`flex overflow-hidden rounded-[1.4em] ${t.card} ${portrait ? "flex-col" : ""}`}>
                  <Pic item={i} className={portrait ? "h-[12em] w-full" : "h-[12em] w-[40%] shrink-0"} />
                  <div className="flex flex-1 flex-col justify-center gap-[0.4em] p-[1.3em]">
                    <span className={`text-[1em] font-bold uppercase tracking-widest ${t.accent}`}>⭐ {cat}</span>
                    <span className="font-display text-[2.4em] font-extrabold leading-none">{i.name}</span>
                    {i.description && <span className={`line-clamp-2 text-[1.2em] ${t.muted}`}>{i.description}</span>}
                    <span className="text-[2.4em]"><Price item={i} cat={cat} offers={offers} t={t} big /></span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ columnCount: portrait ? 1 : Math.min(2, cats.length), columnGap: "1.2em" }}>
              {cats.map((c) => <ListSection key={c.id} c={c} offers={offers} t={t} flavours={[]} />)}
            </div>
          </main>
        ) : layout === "cards" ? (
          <main style={{ columnCount: portrait ? 1 : Math.min(cols, 2), columnGap: "1.6em" }}>
            {cats.map((c) => <CardsSection key={c.id} c={c} offers={offers} t={t} perRow={portrait ? 3 : Math.min(cols, 2) >= 2 ? 4 : 6} />)}
          </main>
        ) : (
          <main style={{ columnCount: cols, columnGap: "1.2em" }}>
            {cats.map((c) => <ListSection key={c.id} c={c} offers={offers} t={t} flavours={chips.get(c.id) ?? []} />)}
          </main>
        )}
      </div>

      {screen?.ticker && (
        <div className={`fixed inset-x-0 bottom-0 overflow-hidden whitespace-nowrap py-[0.5em] text-[1.5em] font-bold ${t.chip}`}>
          <div className="inline-block animate-[ticker_30s_linear_infinite] pl-[100%]">{screen.ticker} &nbsp;•&nbsp; {screen.ticker}</div>
        </div>
      )}
    </FitBoard>
  );
}
