"use client";

import { useEffect, useRef, useState } from "react";
import { SITE_NAME } from "@/lib/format";
import { posApi, type BoardEntry } from "@/lib/pos";

/** Customer-facing "Preparing / Ready" TV. Public, read-only, shows number + first name only. */
export default function OrderBoardPage() {
  const [preparing, setPreparing] = useState<BoardEntry[]>([]);
  const [ready, setReady] = useState<BoardEntry[]>([]);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [offline, setOffline] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const known = useRef<Set<number> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  const chime = () => {
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      if (ctx.state === "suspended") { setSoundBlocked(true); return; }
      [659, 880, 1047].forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = f; o.type = "sine";
        const t = ctx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.5);
      });
    } catch { /* no audio */ }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const b = await posApi.board(new URLSearchParams(window.location.search).get("branch"));
        const ids = b.ready.map((r) => r.id);
        if (known.current) {
          const newOnes = ids.filter((id) => !known.current!.has(id));
          if (newOnes.length) {
            chime();
            setFresh(new Set(newOnes));
            setTimeout(() => setFresh(new Set()), 12_000);
          }
        }
        known.current = new Set(ids);
        setPreparing(b.preparing); setReady(b.ready); setOffline(false);
      } catch { setOffline(true); }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink text-cream" style={{ fontSize: "min(0.95vw, 1.7vh)" }}
         onClick={() => { audio.current?.resume(); setSoundBlocked(false); }}>
      <header className="flex items-center justify-between px-[2.5em] pb-[1em] pt-[1.5em]">
        <h1 className="font-display text-[3em] font-extrabold"><span className="text-flame">🔥</span> {SITE_NAME}</h1>
        <p className="text-[1.6em] text-cream/70">Watch for your order number</p>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[2fr_3fr] gap-[1.5em] px-[2.5em] pb-[2em]">
        <section className="flex min-h-0 flex-col rounded-[1.5em] bg-cream/[0.06] p-[1.8em]">
          <h2 className="font-display text-[3em] font-extrabold text-mustard">⏳ Preparing</h2>
          <div className="mt-[0.8em] grid grid-cols-3 content-start gap-[0.8em] overflow-hidden">
            {preparing.map((o) => (
              <div key={o.id} className="rounded-[0.8em] bg-cream/10 py-[0.5em] text-center">
                <p className="font-display text-[3.4em] font-extrabold leading-none">{o.number}</p>
                {o.name && <p className="text-[1.2em] text-cream/60">{o.name}</p>}
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-0 flex-col rounded-[1.5em] bg-leaf p-[1.8em]">
          <h2 className="font-display text-[3em] font-extrabold">✅ Ready — please collect</h2>
          <div className="mt-[0.8em] grid grid-cols-3 content-start gap-[1em] overflow-hidden">
            {ready.map((o) => (
              <div key={o.id}
                   className={`rounded-[0.8em] py-[0.6em] text-center transition ${fresh.has(o.id) ? "animate-pulse bg-mustard text-ink" : "bg-ink/25"}`}>
                <p className="font-display text-[5.5em] font-extrabold leading-none">{o.number}</p>
                {o.name && <p className="text-[1.6em] font-semibold">{o.name}</p>}
              </div>
            ))}
          </div>
          {ready.length === 0 && <p className="m-auto text-[1.8em] text-cream/70">Ready orders will appear here</p>}
        </section>
      </main>

      {(offline || soundBlocked) && (
        <p className="absolute bottom-[1em] left-1/2 -translate-x-1/2 rounded-full bg-cream/15 px-[1.2em] py-[0.4em] text-[1.1em]">
          {offline ? "Reconnecting…" : "🔇 Click the screen once to turn on the ready chime"}
        </p>
      )}
    </div>
  );
}
