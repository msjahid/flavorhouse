"use client";

import { useState } from "react";
import { ChangeCard, RecordHistory } from "@/components/manage/ChangeViews";
import { Badge, Card, dt, Empty, ErrorBox, Field, Modal, PageHeader, useLoad } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { changeMessage, manageApi, type MenuSection, type Screen } from "@/lib/manage";

const bar = (w: string, c = "bg-cream/40") => <span className={`block h-1 rounded ${c}`} style={{ width: w }} />;
const LAYOUTS: { k: Screen["layout"]; label: string; hint: string; preview: React.ReactNode }[] = [
  { k: "list", label: "Price list", hint: "Classic columns of names and prices", preview: (
    <div className="grid h-full grid-cols-3 gap-1">{[0, 1, 2].map((i) => <div key={i} className="space-y-1 rounded bg-cream/10 p-1">{bar("60%", "bg-mustard")}{bar("90%")}{bar("80%")}{bar("85%")}</div>)}</div>) },
  { k: "cards", label: "Photo cards", hint: "Big pictures of each item", preview: (
    <div className="grid h-full grid-cols-4 gap-1">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="rounded bg-flame/70" />)}</div>) },
  { k: "featured", label: "Featured + list", hint: "1–3 hero items, list on the side", preview: (
    <div className="grid h-full grid-cols-[1fr_1.3fr] gap-1"><div className="rounded bg-flame/70" /><div className="space-y-1 rounded bg-cream/10 p-1">{bar("50%", "bg-mustard")}{bar("90%")}{bar("80%")}{bar("85%")}</div></div>) },
];

const THEMES: { k: Screen["theme"]; label: string; swatch: string }[] = [
  { k: "dark", label: "Dark", swatch: "bg-ink" },
  { k: "light", label: "Light", swatch: "bg-cream ring-1 ring-ink/20" },
  { k: "flame", label: "Flame red", swatch: "bg-flame" },
];

export default function ScreensPage() {
  const { user } = usePosAuth();
  const { data, error, reload } = useLoad(() => manageApi.screens(), []);
  const menu = useLoad(() => manageApi.menu(), []);
  const pending = useLoad(() => manageApi.changes({ status: "pending", kind: "board" }), []);
  const [edit, setEdit] = useState<Partial<Screen> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div>
      <PageHeader title="TV screens" sub="Make as many menu-board layouts as you need (one per TV). Managers can set them up; a supervisor verifies before they go live.">
        <button className="btn-primary" onClick={() => setEdit({})}>+ New screen</button>
      </PageHeader>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      {(pending.data?.length ?? 0) > 0 && (
        <Card title={`⏳ Waiting for approval (${pending.data!.length})`} className="mb-4">
          <div className="grid gap-3 lg:grid-cols-2">{pending.data!.map((c) => <ChangeCard key={c.id} c={c} compact onDone={() => { pending.reload(); reload(); }} />)}</div>
        </Card>
      )}
      {data?.length === 0 ? <Card><Empty>No saved screens yet. The default board at /menu-board still works.</Empty></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((x) => {
            const url = `${origin}/menu-board?screen=${x.id}`;
            return (
              <div key={x.id} className="overflow-hidden rounded-3xl bg-white ring-1 ring-ink/5">
                <div className={`aspect-video ${x.theme === "light" ? "bg-cream text-ink" : x.theme === "flame" ? "bg-flame text-white" : "bg-ink text-cream"} relative overflow-hidden`}>
                  <iframe src={`/menu-board?screen=${x.id}`} title={x.name} className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-25 border-0" loading="lazy" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-lg font-extrabold">{x.name}</p>
                    <Badge status={x.is_active ? "active" : "inactive"}>{x.is_active ? "On" : "Off"}</Badge>
                  </div>
                  <p className="text-xs text-ink-soft">🏪 {x.branch_name ?? "All stores"} · {({ list: "Price list", cards: "Photo cards", featured: "Featured" } as const)[x.layout]} · {x.orientation} · {x.columns} columns · {x.categories.length ? `${x.categories.length} sections` : "all sections"} · updated {dt(x.updated_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={`/menu-board?screen=${x.id}`} target="_blank" rel="noreferrer" className="btn-dark !px-4 !py-1.5 text-sm">📺 Open full screen</a>
                    <button className="btn-ghost !px-4 !py-1.5 text-sm" onClick={() => { navigator.clipboard?.writeText(url); setMsg(`Link copied: ${url}`); }}>🔗 Copy link</button>
                    <button className="btn-ghost !px-4 !py-1.5 text-sm" onClick={() => setEdit(x)}>✏️ Edit</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-soft">On the TV, open the screen link in a browser and press F11 (or use kiosk mode). It refreshes every minute, so price and offer changes appear on their own.</p>
      {edit && <ScreenForm x={edit} sections={menu.data ?? []} level={user?.level ?? 0} onClose={() => setEdit(null)}
        onSent={(m) => { setEdit(null); setMsg(m); reload(); pending.reload(); }} />}
    </div>
  );
}

function ScreenForm({ x, sections, level, onClose, onSent }: {
  x: Partial<Screen>; sections: MenuSection[]; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const { user } = usePosAuth();
  const [f, setF] = useState({
    name: x.name ?? "", branch: x.branch ?? (level === 2 ? user?.branch?.id ?? null : null), title: x.title ?? "", subtitle: x.subtitle ?? "",
    theme: x.theme ?? "dark", columns: x.columns ?? 3, categories: x.categories ?? [], show_qr: x.show_qr ?? true,
    show_flavours: x.show_flavours ?? true, show_offers: x.show_offers ?? true, ticker: x.ticker ?? "", is_active: x.is_active ?? true,
    layout: x.layout ?? "list", orientation: x.orientation ?? "landscape", featured: x.featured ?? [],
  });
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"info" | "history">("info");
  const [err, setErr] = useState<string | null>(null);
  const move = (slug: string, dir: number) => {
    const i = f.categories.indexOf(slug);
    const next = [...f.categories];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setF({ ...f, categories: next });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { onSent(changeMessage(await manageApi.saveScreen({ ...f, ...(x.id ? { id: x.id } : {}), ...(reason ? { change_reason: reason } : {}) } as Partial<Screen>))); }
    catch (z) { setErr(z instanceof Error ? z.message : "Failed"); }
  };
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${on ? "bg-ink text-cream ring-ink" : "bg-white ring-ink/10"}`;

  return (
    <Modal title={x.id ? `Screen · ${x.name}` : "New TV screen"} onClose={onClose} wide>
      {x.id && (
        <div className="mb-4 flex gap-2">
          {(["info", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
              {t === "info" ? "📺 Layout" : "🕘 History"}</button>
          ))}
        </div>
      )}
      {tab === "history" && x.id ? <RecordHistory model="TV screen" id={x.id} /> : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Screen name"><input className="input !py-2" required placeholder="Left TV – Wings" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Store">
              {level === 2 ? <div className="input !py-2 bg-cream font-semibold">🏪 {user?.branch?.name}</div> : (
                <select className="input !py-2" value={f.branch ?? ""} onChange={(e) => setF({ ...f, branch: e.target.value ? Number(e.target.value) : null })}>
                  {level >= 5 && <option value="">All stores</option>}
                  {user?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>)}
            </Field>
            <Field label="Columns">
              <select className="input !py-2" value={f.columns} onChange={(e) => setF({ ...f, columns: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Headline (optional)"><input className="input !py-2" placeholder="Uses the restaurant name" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Sub line (optional)"><input className="input !py-2" placeholder="Order at the counter or online" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></Field>
            <Field label="Theme">
              <div className="flex gap-2">
                {THEMES.map((t) => (
                  <button type="button" key={t.k} onClick={() => setF({ ...f, theme: t.k })}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold ring-2 ${f.theme === t.k ? "ring-flame" : "ring-transparent"} bg-white`}>
                    <span className={`h-4 w-4 rounded-full ${t.swatch}`} />{t.label}</button>
                ))}
              </div>
            </Field>
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
            <p className="mb-2 text-sm font-semibold">Format</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {LAYOUTS.map((l) => (
                <button type="button" key={l.k} onClick={() => setF({ ...f, layout: l.k })}
                  className={`rounded-2xl p-3 text-left ring-2 ${f.layout === l.k ? "bg-cream ring-flame" : "bg-white ring-ink/10"}`}>
                  <div className="mb-2 h-16 rounded-lg bg-ink p-1.5">{l.preview}</div>
                  <p className="text-sm font-bold">{l.label}</p><p className="text-xs text-ink-soft">{l.hint}</p>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {([["landscape", "▭ Landscape (wide TV)"], ["portrait", "▯ Portrait (TV on its side)"]] as const).map(([k, l]) => (
                <button type="button" key={k} className={chip(f.orientation === k)} onClick={() => setF({ ...f, orientation: k })}>{l}</button>
              ))}
            </div>
            {f.layout === "featured" && (
              <div className="mt-3">
                <p className="mb-1 text-sm font-semibold">Featured items <span className="font-normal text-ink-soft">(up to 3 — none = items marked ★ Featured)</span></p>
                <div className="flex max-h-36 flex-wrap gap-1 overflow-y-auto">
                  {sections.flatMap((sec) => sec.items).map((it) => {
                    const on = f.featured.includes(it.id);
                    return <button type="button" key={it.id} className={`${chip(on)} !px-2 !py-1 text-xs`}
                      onClick={() => setF({ ...f, featured: on ? f.featured.filter((z) => z !== it.id) : [...f.featured, it.id].slice(-3) })}>{it.emoji} {it.name}</button>;
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
            <p className="mb-2 text-sm font-semibold">Menu sections on this TV <span className="font-normal text-ink-soft">(none = all, in this order)</span></p>
            <div className="flex flex-wrap gap-1">
              {sections.map((s) => (
                <button type="button" key={s.slug} className={chip(f.categories.includes(s.slug))}
                  onClick={() => setF({ ...f, categories: f.categories.includes(s.slug) ? f.categories.filter((c) => c !== s.slug) : [...f.categories, s.slug] })}>
                  {s.emoji} {s.name}</button>
              ))}
            </div>
            {f.categories.length > 1 && (
              <ol className="mt-3 space-y-1 text-sm">
                {f.categories.map((slug, i) => (
                  <li key={slug} className="flex items-center gap-2 rounded-lg bg-cream px-3 py-1.5">
                    <span className="w-5 font-bold">{i + 1}.</span><span className="flex-1">{sections.find((s) => s.slug === slug)?.name ?? slug}</span>
                    <button type="button" className="px-1" onClick={() => move(slug, -1)}>↑</button><button type="button" className="px-1" onClick={() => move(slug, 1)}>↓</button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.show_offers} onChange={(e) => setF({ ...f, show_offers: e.target.checked })} /> 🏷 Show live offers</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.show_flavours} onChange={(e) => setF({ ...f, show_flavours: e.target.checked })} /> Flavour chips</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.show_qr} onChange={(e) => setF({ ...f, show_qr: e.target.checked })} /> Order-online QR</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Screen on</label>
          </div>
          <Field label="Scrolling message (optional)"><input className="input !py-2" placeholder="Wing Wednesday — 25% off all wings!" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} /></Field>
          {x.id && <Field label="Why the change? (optional)"><input className="input !py-2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          <ErrorBox error={err} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">{level >= 5 ? "Saved right away." : `Goes to a ${["", "", "supervisor", "super admin", "admin"][level]} for approval.`}</p>
            <button className="btn-primary">{x.id ? "Send change" : "Create screen"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
