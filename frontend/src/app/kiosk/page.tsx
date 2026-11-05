"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { quoteCart } from "@/lib/api";
import { money, SITE_NAME } from "@/lib/format";
import { posApi, type PosCategory, type PosItem, type PosOrder } from "@/lib/pos";
import type { Quote } from "@/lib/types";
import OptionsModal, { type ChosenLine } from "@/components/pos/OptionsModal";

type Step = "welcome" | "menu" | "review" | "name" | "done";
type Fulfillment = "dine_in" | "pickup";
interface Line extends ChosenLine { key: string; itemId: number; name: string; emoji: string }

const IDLE_SECONDS = 90;   // back to the start screen after this long with no touches
const DONE_SECONDS = 20;   // how long the "your number is…" screen stays

export default function KioskPage() {
  const { user, checking } = usePosAuth();
  if (checking) return <div className="grid h-screen place-items-center bg-ink text-cream/60">Loading…</div>;
  if (!user) return <KioskSignIn />;
  return <Kiosk />;
}

// ------------------------------------------------------------------ one-time staff sign-in on the device

function KioskSignIn() {
  const { login } = usePosAuth();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid h-screen place-items-center bg-ink p-4">
      <form className="w-full max-w-sm rounded-[2rem] bg-cream p-8"
            onSubmit={async (e) => { e.preventDefault(); try { await login(u.trim(), p); } catch (x) { setErr(x instanceof Error ? x.message : "Login failed"); } }}>
        <p className="text-5xl">🧍</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold">Set up self-order kiosk</h1>
        <p className="mt-1 text-sm text-ink-soft">Staff: sign in once on this device. It stays signed in.</p>
        <input className="input mt-5" placeholder="Staff username" value={u} onChange={(e) => setU(e.target.value)} required />
        <input className="input mt-3" type="password" placeholder="Password" value={p} onChange={(e) => setP(e.target.value)} required />
        {err && <p className="mt-3 text-sm text-flame">{err}</p>}
        <button className="btn-primary mt-5 w-full">Start kiosk</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ the kiosk

function Kiosk() {
  const { branchId, user, setBranchId } = usePosAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("dine_in");
  const [categories, setCategories] = useState<PosCategory[]>([]);
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [optionsFor, setOptionsFor] = useState<PosItem | null>(null);
  const [name, setName] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [placed, setPlaced] = useState<PosOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Menu (refreshed every 2 min so sold-out items disappear)
  const loadMenu = useCallback(() => {
    posApi.menu().then((m) => {
      const cats = m.categories
        .map((c) => ({ ...c, items: c.items.filter((i) => i.is_available) }))
        .filter((c) => c.items.length);
      setCategories(cats);
      setActiveCat((cur) => cur ?? cats[0]?.id ?? null);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    loadMenu();
    const t = setInterval(loadMenu, 120_000);
    return () => clearInterval(t);
  }, [loadMenu]);

  const reset = useCallback(() => {
    setStep("welcome"); setLines([]); setName(""); setPlaced(null); setError(null);
    setOptionsFor(null); setActiveCat(categories[0]?.id ?? null);
  }, [categories]);

  // Idle timeout: back to the welcome screen if nobody touches it
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener("pointerdown", touch);
    const t = setInterval(() => {
      if (step !== "welcome" && step !== "done" && Date.now() - lastTouch.current > IDLE_SECONDS * 1000) reset();
    }, 5000);
    return () => { window.removeEventListener("pointerdown", touch); clearInterval(t); };
  }, [step, reset]);

  // Totals from the server (exact prices + tax)
  useEffect(() => {
    if (!lines.length) return setQuote(null);
    quoteCart(lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })), fulfillment, 0,
      { branch: branchId, channel: "kiosk" })
      .then(setQuote).catch(() => setQuote(null));
  }, [lines, fulfillment, branchId]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const estimate = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const items = categories.find((c) => c.id === activeCat)?.items ?? [];

  const addLine = (item: PosItem, line: ChosenLine) => {
    const key = `${item.id}:${[...line.optionIds].sort((a, b) => a - b).join(",")}`;
    setLines((prev) => prev.some((l) => l.key === key)
      ? prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l))
      : [...prev, { ...line, key, itemId: item.id, name: item.name, emoji: item.emoji }]);
  };
  const tap = (item: PosItem) =>
    item.option_groups.length
      ? setOptionsFor(item)
      : addLine(item, { optionIds: [], optionLabels: [], unitPrice: parseFloat(item.price), quantity: 1 });
  const setQty = (key: string, q: number) =>
    setLines((prev) => (q <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: q } : l))));

  const place = async () => {
    setBusy(true); setError(null);
    try {
      const o = await posApi.kioskOrder({
        items: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, option_ids: l.optionIds })),
        fulfillment, customer_name: name.trim(), branch_id: branchId,
      });
      setPlaced(o); setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please ask a team member.");
    } finally { setBusy(false); }
  };

  // ---------------- screens
  if (!branchId && user) {
    return (
      <div className="grid h-screen place-items-center bg-ink p-8 text-center text-cream">
        <div className="space-y-3">
          <h1 className="font-display text-3xl font-extrabold">Which branch is this kiosk in?</h1>
          {user.branches.map((b) => (
            <button key={b.id} onClick={() => setBranchId(b.id)} className="btn block w-72 bg-cream text-ink">{b.name}</button>
          ))}
        </div>
      </div>
    );
  }
  if (step === "welcome") {
    const start = (f: Fulfillment) => {
      setFulfillment(f); setStep("menu");
      document.documentElement.requestFullscreen?.().catch(() => {});
    };
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-10 bg-ink p-8 text-center text-cream">
        <div>
          <p className="text-8xl">🔥</p>
          <h1 className="mt-4 font-display text-6xl font-extrabold">{SITE_NAME}</h1>
          <p className="mt-3 text-2xl text-cream/70">Order here, pay at the counter</p>
        </div>
        <div className="grid w-full max-w-2xl grid-cols-2 gap-6">
          {([["dine_in", "🍽", "Eat here"], ["pickup", "🥡", "Take away"]] as const).map(([f, icon, label]) => (
            <button key={f} onClick={() => start(f)}
              className="rounded-[2rem] bg-cream p-10 text-ink transition active:scale-95">
              <p className="text-7xl">{icon}</p>
              <p className="mt-4 font-display text-3xl font-extrabold">{label}</p>
            </button>
          ))}
        </div>
        <p className="text-cream/50">Tap to start</p>
      </div>
    );
  }

  if (step === "done" && placed) return <DoneScreen order={placed} onFinish={reset} />;

  return (
    <div className="flex h-screen flex-col bg-cream">
      {/* top bar */}
      <header className="flex items-center gap-4 bg-ink px-6 py-4 text-cream">
        <button onClick={reset} className="rounded-2xl bg-cream/10 px-5 py-3 text-lg font-semibold">✕ Start over</button>
        <p className="font-display text-2xl font-extrabold">🔥 {SITE_NAME}</p>
        <span className="ml-auto rounded-full bg-cream/10 px-4 py-2 text-lg">
          {fulfillment === "dine_in" ? "🍽 Eat here" : "🥡 Take away"}
        </span>
      </header>

      {step === "menu" && (
        <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
          <nav className="flex flex-col gap-2 overflow-y-auto bg-white p-3">
            {categories.map((c) => (
              <button key={c.id} onClick={() => setActiveCat(c.id)}
                className={`w-full flex-1 rounded-2xl p-2 text-center transition max-h-32 ${activeCat === c.id ? "bg-flame text-white" : "bg-cream-dark/60"}`}>
                <span className="block text-4xl">{c.emoji}</span>
                <span className="mt-1 block text-lg font-bold">{c.name}</span>
              </button>
            ))}
          </nav>
          <div className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 overflow-y-auto p-5">
            {items.map((i) => (
              <button key={i.id} onClick={() => tap(i)}
                className="flex flex-col items-center rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-ink/5 transition active:scale-95">
                {i.image
                  ? <img src={i.image} alt="" className="h-32 w-full rounded-2xl object-cover" />
                  : <span className="text-7xl">{i.emoji || "🍽️"}</span>}
                <span className="mt-3 text-xl font-bold leading-tight">{i.name}</span>
                <span className="mt-2 font-display text-2xl font-extrabold text-flame">{money(i.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
          <h2 className="font-display text-4xl font-extrabold">Your order</h2>
          <ul className="mt-5 space-y-3">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-4 rounded-3xl bg-white p-4 ring-1 ring-ink/5">
                <span className="text-5xl">{l.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold">{l.name}</p>
                  {l.optionLabels.length > 0 && <p className="text-ink-soft">{l.optionLabels.join(" · ")}</p>}
                </div>
                <div className="flex items-center rounded-full bg-cream-dark">
                  <button className="h-14 w-14 text-3xl" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Less">−</button>
                  <span className="w-8 text-center text-xl font-bold">{l.quantity}</span>
                  <button className="h-14 w-14 text-3xl" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="More">+</button>
                </div>
                <span className="w-24 text-right text-xl font-bold">{money(l.unitPrice * l.quantity)}</span>
              </li>
            ))}
          </ul>
          {lines.length === 0 && <p className="mt-10 text-center text-xl text-ink-soft">Your order is empty.</p>}
          {quote && (
            <dl className="mt-5 space-y-1 text-lg">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(quote.subtotal)}</dd></div>
              {quote.promo_savings && parseFloat(quote.promo_savings) > 0 && (
                <div className="flex justify-between text-leaf"><dt>🏷 {quote.promotions?.map((p) => p.name).join(", ")}</dt><dd>−{money(quote.promo_savings)}</dd></div>
              )}
              <div className="flex justify-between"><dt>Tax</dt><dd>{money(quote.tax)}</dd></div>
              <div className="flex justify-between font-display text-3xl font-extrabold"><dt>Total</dt><dd>{money(quote.total)}</dd></div>
            </dl>
          )}
        </div>
      )}

      {step === "name" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          <h2 className="font-display text-4xl font-extrabold">What&apos;s your name?</h2>
          <p className="text-xl text-ink-soft">We&apos;ll call it when your order is ready.</p>
          <div className="min-h-20 w-full max-w-xl rounded-3xl bg-white px-6 py-4 text-center font-display text-5xl font-extrabold ring-2 ring-flame">
            {name || <span className="text-ink/20">Name</span>}
          </div>
          <Keyboard value={name} onChange={(v) => setName(v.slice(0, 20))} />
          {error && <p className="rounded-xl bg-flame/10 p-3 text-flame">{error}</p>}
        </div>
      )}

      {/* bottom bar */}
      <footer className="flex items-center gap-4 border-t border-ink/10 bg-white px-6 py-4">
        {step !== "menu" && (
          <button onClick={() => setStep(step === "name" ? "review" : "menu")} className="btn-ghost !px-8 !py-5 text-xl">← Back</button>
        )}
        <div className="ml-auto text-right">
          <p className="text-ink-soft">{count} item{count === 1 ? "" : "s"}</p>
          <p className="font-display text-3xl font-extrabold">{money(quote ? quote.total : estimate)}</p>
        </div>
        {step === "menu" && (
          <button onClick={() => setStep("review")} disabled={!count} className="btn-primary !px-10 !py-5 text-2xl">Review order →</button>
        )}
        {step === "review" && (
          <button onClick={() => setStep("name")} disabled={!count} className="btn-primary !px-10 !py-5 text-2xl">Continue →</button>
        )}
        {step === "name" && (
          <button onClick={place} disabled={busy || name.trim().length < 1 || !count} className="btn-primary !px-10 !py-5 text-2xl">
            {busy ? "Sending…" : "Place order ✓"}
          </button>
        )}
      </footer>

      {optionsFor && (
        <OptionsModal item={optionsFor} onClose={() => setOptionsFor(null)}
          onAdd={(line) => { addLine(optionsFor, line); setOptionsFor(null); }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ on-screen keyboard

function Keyboard({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const press = (k: string) => {
    const v = value.length === 0 || value.endsWith(" ") ? k : k.toLowerCase();
    onChange(value + v);
  };
  return (
    <div className="w-full max-w-4xl space-y-2">
      {rows.map((r) => (
        <div key={r} className="flex justify-center gap-2">
          {r.split("").map((k) => (
            <button key={k} onClick={() => press(k)} className="h-16 flex-1 max-w-20 rounded-2xl bg-white text-2xl font-bold shadow-sm ring-1 ring-ink/10 active:bg-cream-dark">
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="flex justify-center gap-2">
        <button onClick={() => onChange(value + " ")} className="h-16 w-80 rounded-2xl bg-white text-xl font-semibold ring-1 ring-ink/10 active:bg-cream-dark">space</button>
        <button onClick={() => onChange(value.slice(0, -1))} className="h-16 w-32 rounded-2xl bg-white text-2xl ring-1 ring-ink/10 active:bg-cream-dark" aria-label="Delete">⌫</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ confirmation

function DoneScreen({ order, onFinish }: { order: PosOrder; onFinish: () => void }) {
  const [left, setLeft] = useState(DONE_SECONDS);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left <= 0) onFinish(); }, [left, onFinish]);

  const summary = useMemo(() => order.items.map((i) => `${i.quantity}× ${i.name}`).join(" · "), [order]);
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-ink p-8 text-center text-cream">
      <p className="text-3xl font-semibold">Thanks, {order.customer_name}! Your number is</p>
      <p className="font-display text-[12rem] font-extrabold leading-none text-mustard">{order.short_number}</p>
      <div className="rounded-3xl bg-flame px-10 py-6">
        <p className="text-2xl font-semibold">Please pay at the counter</p>
        <p className="font-display text-6xl font-extrabold">{money(order.total)}</p>
      </div>
      <p className="max-w-xl text-lg text-cream/70">{summary}</p>
      <p className="text-cream/60">Watch the screen for your number. 📺</p>
      <button onClick={onFinish} className="btn mt-2 bg-cream px-10 py-4 text-xl text-ink">Done ({left})</button>
    </div>
  );
}
