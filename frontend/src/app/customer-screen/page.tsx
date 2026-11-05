"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { money, SITE_NAME } from "@/lib/format";
import { PosError, type TipConfig } from "@/lib/pos";
import { answerTip, loadScreen, onScreenMessage, setScreenId, type ScreenLine, type ScreenState } from "@/lib/display";

/**
 * Customer-facing screen beside the register (second monitor or a tablet).
 * Shows the order as it's rung up, asks "Would you like to add a tip?", and says thank you.
 */
export default function CustomerScreen() {
  const [state, setState] = useState<ScreenState>({ mode: "idle" });
  const [tips, setTips] = useState<TipConfig>({ enabled: true, percents: [2, 5, 10, 20], allow_custom: true });
  const [problem, setProblem] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const stamp = useRef("");

  // Opened from the register (or a tablet with the copied link): ?screen=<id> pairs it
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("screen");
    if (id) setScreenId(id);
    setReady(true);
  }, []);

  const poll = useCallback(async () => {
    try {
      const d = await loadScreen();
      setProblem(null);
      setTips(d.tips);
      // Only take the server's copy when it changed (the same-computer channel is usually faster)
      if (d.updated_at !== stamp.current) {
        stamp.current = d.updated_at;
        if (d.state && "mode" in d.state) setState(d.state as ScreenState);
      }
    } catch (e) {
      setProblem(e instanceof PosError && e.status === 400
        ? "Open this screen from the register: 📺 Customer screen (or use the link it copies for a tablet)."
        : "Can't reach the register right now — retrying…");
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    poll();
    const t = setInterval(poll, 1000);
    const off = onScreenMessage(setState);
    return () => { clearInterval(t); off(); };
  }, [poll, ready]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-ink text-cream" onDoubleClick={fullscreen}>
      <header className="flex items-center justify-between px-6 py-4 sm:px-10">
        <p className="font-display text-2xl font-extrabold sm:text-3xl">🔥 {SITE_NAME}</p>
        <p className="text-lg font-semibold text-cream/60 tabular-nums">{clock}</p>
      </header>
      <section className="min-h-0 flex-1 px-4 pb-6 sm:px-10 sm:pb-10">
        {problem && state.mode === "idle" ? (
          <Centered><p className="text-5xl">📺</p><p className="mt-4 max-w-xl text-xl text-cream/80">{problem}</p></Centered>
        ) : state.mode === "cart" ? (
          <Cart s={state} />
        ) : state.mode === "tip" ? (
          <TipQuestion key={state.request_id} s={state} tips={tips} />
        ) : state.mode === "tip_done" ? (
          <Centered>
            <p className="text-7xl">🙏</p>
            <p className="mt-4 font-display text-5xl font-extrabold">{parseFloat(state.tip) > 0 ? "Thank you for the tip!" : "No problem!"}</p>
            {parseFloat(state.tip) > 0 && <p className="mt-3 text-2xl text-cream/70">Tip {money(state.tip)}</p>}
            <p className="mt-8 text-xl text-cream/60">Total to pay</p>
            <p className="font-display text-7xl font-extrabold text-mustard tabular-nums">{money(parseFloat(state.total) + parseFloat(state.tip))}</p>
          </Centered>
        ) : state.mode === "thanks" ? (
          <Centered>
            <p className="text-7xl">✅</p>
            <p className="mt-4 font-display text-5xl font-extrabold">Thank you!</p>
            <p className="mt-3 text-2xl text-cream/70">Your order number is</p>
            <p className="font-display text-9xl font-extrabold text-mustard">#{state.number}</p>
            {parseFloat(state.change) > 0 && <p className="mt-6 text-3xl">Your change: <b className="text-mustard">{money(state.change)}</b></p>}
          </Centered>
        ) : (
          <Centered>
            <p className="text-8xl">🍗🍔🥤</p>
            <p className="mt-6 font-display text-5xl font-extrabold sm:text-6xl">Welcome!</p>
            <p className="mt-3 text-xl text-cream/60">Your order will show here as we ring it up.</p>
          </Centered>
        )}
      </section>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center text-center" style={{ animation: "popin .3s ease-out" }}>{children}</div>;
}

function Cart({ s }: { s: Extract<ScreenState, { mode: "cart" }> }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [s.lines.length]);
  return (
    <div className="grid h-full gap-6 lg:grid-cols-[1fr_420px]">
      <ul className="min-h-0 space-y-2 overflow-y-auto rounded-3xl bg-cream/5 p-4 sm:p-6">
        {s.lines.map((l, i) => <LineRow key={i} l={l} />)}
        <li ref={end} />
      </ul>
      <div className="flex flex-col rounded-3xl bg-cream p-6 text-ink sm:p-8">
        <p className="text-sm font-bold uppercase tracking-widest text-ink-soft">Your order</p>
        <p className="mt-1 font-display text-3xl font-extrabold">{s.lines.reduce((n, l) => n + l.qty, 0)} item{s.lines.reduce((n, l) => n + l.qty, 0) === 1 ? "" : "s"}</p>
        <p className="mt-6 text-6xl">🔥</p>
        <p className="mt-2 text-lg text-ink-soft">Made fresh, served hot. Please check your order — let us know if anything&apos;s not right.</p>
        <div className="flex-1" />
        <dl className="space-y-2 text-xl">
          <Row k="Subtotal" v={money(s.subtotal + s.savings)} />
          {s.savings > 0 && <Row k="Offers" v={`−${money(s.savings)}`} cls="text-leaf" />}
          {s.discount > 0 && <Row k="Discount" v={`−${money(s.discount)}`} cls="text-leaf" />}
          <Row k="Tax" v={money(s.tax)} />
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-ink/15 pt-4">
          <span className="text-2xl font-bold">Total</span>
          <span className="font-display text-6xl font-extrabold tabular-nums">{money(s.total)}</span>
        </div>
      </div>
    </div>
  );
}

function LineRow({ l }: { l: ScreenLine }) {
  return (
    <li className="flex items-start justify-between gap-4 rounded-2xl bg-cream/5 px-5 py-4 text-xl">
      <div className="min-w-0">
        <p className="font-semibold"><span className="mr-2 text-mustard">{l.qty}×</span>{l.name}</p>
        {l.options && <p className="text-base text-cream/60">{l.options}</p>}
        {l.promo && <p className="mt-1 inline-block rounded-md bg-leaf/30 px-2 text-sm font-bold">🏷 {l.promo}</p>}
      </div>
      <p className="font-bold tabular-nums">{money(l.total)}</p>
    </li>
  );
}

function Row({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return <div className={`flex justify-between ${cls}`}><dt>{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}

function TipQuestion({ s, tips }: { s: Extract<ScreenState, { mode: "tip" }>; tips: TipConfig }) {
  const [step, setStep] = useState<"ask" | "pick" | "custom">("ask");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = parseFloat(s.base);

  const send = async (body: { choice: "none" | "percent" | "custom"; percent?: number; amount?: string }) => {
    setBusy(true); setErr(null);
    try { await answerTip({ request_id: s.request_id, ...body }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Please try again."); }
    setBusy(false);
  };
  const key = (k: string) => setAmount((c) => {
    if (k === "⌫") return c.slice(0, -1);
    if (k === "." && c.includes(".")) return c;
    if (c.includes(".") && c.split(".")[1].length >= 2) return c;
    return (c === "0" && k !== "." ? "" : c) + k;
  });

  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-xl text-cream/60">Order total <b className="text-cream">{money(s.total)}</b></p>
      {step === "ask" && (
        <div className="tip-flash mt-6 w-full max-w-3xl rounded-[2.5rem] bg-cream p-8 text-ink sm:p-12">
          <p className="text-6xl">💛</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold sm:text-6xl">Would you like to add a tip?</h1>
          <p className="mt-2 text-lg text-ink-soft">Tips go to the team that made your food.</p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <button disabled={busy} onClick={() => setStep("pick")}
              className="tip-glow rounded-3xl py-7 font-display text-4xl font-extrabold text-white">Yes</button>
            <button disabled={busy} onClick={() => send({ choice: "none" })}
              className="rounded-3xl bg-ink/10 py-7 font-display text-4xl font-extrabold">No</button>
          </div>
        </div>
      )}
      {step === "pick" && (
        <div className="mt-6 w-full max-w-6xl" style={{ animation: "popin .25s ease-out" }}>
          <h1 className="font-display text-4xl font-extrabold sm:text-5xl">Choose your tip</h1>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]"
               style={{ ["--n" as string]: String(tips.percents.length + (tips.allow_custom ? 1 : 0)) }}>
            {tips.percents.map((p) => (
              <button key={p} disabled={busy} onClick={() => send({ choice: "percent", percent: p })}
                className="rounded-3xl bg-cream py-8 text-ink transition active:scale-95 hover:ring-8 hover:ring-mustard">
                <span className="block font-display text-5xl font-extrabold sm:text-6xl">{p}%</span>
                <span className="mt-1 block text-2xl font-semibold text-ink-soft">{money(Math.round(base * p) / 100)}</span>
              </button>
            ))}
            {tips.allow_custom && (
              <button disabled={busy} onClick={() => setStep("custom")}
                className="rounded-3xl bg-mustard py-8 text-ink transition active:scale-95">
                <span className="block font-display text-4xl font-extrabold sm:text-5xl">Custom</span>
                <span className="mt-1 block text-xl font-semibold">Enter an amount</span>
              </button>
            )}
          </div>
          <div className="mt-6 flex justify-center gap-3">
            <button className="rounded-2xl px-6 py-3 text-lg text-cream/70 ring-1 ring-cream/20" onClick={() => setStep("ask")}>← Back</button>
            <button disabled={busy} className="rounded-2xl px-6 py-3 text-lg text-cream/70 ring-1 ring-cream/20" onClick={() => send({ choice: "none" })}>No tip</button>
          </div>
        </div>
      )}
      {step === "custom" && (
        <div className="mt-6 w-full max-w-md rounded-[2rem] bg-cream p-6 text-ink" style={{ animation: "popin .25s ease-out" }}>
          <p className="text-lg font-semibold text-ink-soft">Tip amount</p>
          <p className="font-display text-6xl font-extrabold tabular-nums">${amount || "0"}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
              <button key={k} onClick={() => key(k)} className="h-16 rounded-2xl bg-white text-3xl font-bold ring-1 ring-ink/10 active:bg-cream-dark">{k}</button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-3">
            <button className="btn-ghost" onClick={() => setStep("pick")}>Back</button>
            <button className="btn-primary !py-4 text-xl" disabled={busy || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > base}
              onClick={() => send({ choice: "custom", amount: parseFloat(amount).toFixed(2) })}>
              Add {amount ? money(parseFloat(amount)) : "tip"}
            </button>
          </div>
          {parseFloat(amount) > base && <p className="mt-2 text-sm text-flame">That's more than the order total.</p>}
        </div>
      )}
      {err && <p className="mt-4 rounded-xl bg-flame px-4 py-2 font-semibold">{err}</p>}
    </div>
  );
}
