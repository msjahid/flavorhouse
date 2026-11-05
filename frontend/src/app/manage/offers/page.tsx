"use client";

import { useState } from "react";
import { ChangeCard, RecordHistory } from "@/components/manage/ChangeViews";
import { Badge, Card, d, Empty, ErrorBox, Field, Modal, PageHeader, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { changeMessage, DAY_NAMES, manageApi, type MenuSection, type Offer } from "@/lib/manage";

const CHANNELS: [string, string][] = [["pos", "🧾 Register"], ["kiosk", "📱 Kiosk"], ["online", "🌐 Website"]];

const TEMPLATES: { label: string; hint: string; o: Partial<Offer> }[] = [
  { label: "🍗 Wing Wednesday", hint: "Day deal: 25% off wings every Wednesday", o: { name: "Wing Wednesday", kind: "percent", value: "25", applies_to: "category", days: [2] } },
  { label: "⏰ Happy hour", hint: "2–5 pm weekdays, $1 off everything", o: { name: "Happy hour", kind: "amount", value: "1", applies_to: "all", days: [0, 1, 2, 3, 4], start_time: "14:00", end_time: "17:00" } },
  { label: "🏷 Promo code", hint: "10% off online with a code", o: { name: "Welcome 10", kind: "percent", value: "10", applies_to: "all", channels: ["online"], code: "WELCOME10" } },
  { label: "💲 Special price", hint: "Item for a fixed price on weekends", o: { name: "Weekend burger", kind: "price", value: "9.99", applies_to: "items", days: [5, 6] } },
];

function describeOffer(o: Offer) {
  const what = o.kind === "percent" ? `${parseFloat(o.value)}% off` : o.kind === "amount" ? `${usd(o.value)} off` : `now ${usd(o.value)}`;
  const on = o.applies_to === "all" ? "everything" : o.applies_to === "category" ? o.category_name ?? "a section" : o.item_names.join(", ");
  const days = o.days.length === 0 || o.days.length === 7 ? "every day" : o.days.map((x) => DAY_NAMES[x]).join(", ");
  const hours = o.start_time && o.end_time ? ` · ${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}` : "";
  return `${what} ${on} · ${days}${hours}`;
}

export default function OffersPage() {
  const { user } = usePosAuth();
  const canEdit = (user?.level ?? 0) >= 3;
  const { data, error, reload } = useLoad(() => manageApi.offers(), []);
  const menu = useLoad(() => manageApi.menu(), []);
  const pending = useLoad(() => manageApi.changes({ status: "pending", kind: "promotion" }), []);
  const [edit, setEdit] = useState<Partial<Offer> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Offers & promotions" sub="Day deals, happy hours, promo codes and special prices. The best offer is applied automatically at the register, kiosk and website.">
        {canEdit && <button className="btn-primary" onClick={() => setEdit({})}>+ New offer</button>}
      </PageHeader>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      {canEdit && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button key={t.label} onClick={() => setEdit(t.o)} className="rounded-2xl bg-white p-4 text-left ring-1 ring-ink/5 hover:ring-flame">
              <p className="font-bold">{t.label}</p><p className="text-xs text-ink-soft">{t.hint}</p>
            </button>
          ))}
        </div>
      )}
      {(pending.data?.length ?? 0) > 0 && (
        <Card title={`⏳ Waiting for approval (${pending.data!.length})`} className="mb-4">
          <div className="grid gap-3 lg:grid-cols-2">{pending.data!.map((c) => <ChangeCard key={c.id} c={c} compact onDone={() => { pending.reload(); reload(); }} />)}</div>
        </Card>
      )}
      {data?.length === 0 ? <Card><Empty>No offers yet. Combos live on the Menu page as their own items.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((o) => {
            const expired = !!o.end_date && o.end_date < today;
            return (
              <button key={o.id} onClick={() => setEdit(o)} className="rounded-3xl bg-white p-5 text-left ring-1 ring-ink/5 hover:ring-flame">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-xl font-extrabold">{o.name}</p>
                  <Badge status={o.is_active && !expired ? "active" : "inactive"}>{expired ? "Ended" : o.is_active ? "Live" : "Off"}</Badge>
                </div>
                <p className="mt-1 text-sm font-semibold text-flame">{describeOffer(o)}</p>
                {o.description && <p className="mt-1 text-sm text-ink-soft">{o.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1 text-[11px] font-bold">
                  {(o.channels.length ? o.channels : ["pos", "kiosk", "online"]).map((c) => <span key={c} className="rounded-full bg-cream px-2 py-0.5">{CHANNELS.find(([k]) => k === c)?.[1]}</span>)}
                  {o.code && <span className="rounded-full bg-ink px-2 py-0.5 text-cream">CODE {o.code}</span>}
                  <span className="rounded-full bg-cream px-2 py-0.5">🏪 {o.branch_names.length ? o.branch_names.join(", ") : "All stores"}</span>
                  {(o.start_date || o.end_date) && <span className="rounded-full bg-cream px-2 py-0.5">📅 {o.start_date ? d(o.start_date) : "now"} – {o.end_date ? d(o.end_date) : "open"}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {edit && <OfferForm o={edit} sections={menu.data ?? []} canEdit={canEdit} level={user?.level ?? 0} onClose={() => setEdit(null)}
        onSent={(m) => { setEdit(null); setMsg(m); reload(); pending.reload(); }} />}
    </div>
  );
}

function OfferForm({ o, sections, canEdit, level, onClose, onSent }: {
  o: Partial<Offer>; sections: MenuSection[]; canEdit: boolean; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const { user } = usePosAuth();
  const [f, setF] = useState({
    name: o.name ?? "", description: o.description ?? "", kind: o.kind ?? "percent", value: o.value ?? "", applies_to: o.applies_to ?? "all",
    category: o.category ?? (o.applies_to === "category" ? sections.find((s) => s.slug.includes("wing"))?.id ?? sections[0]?.id ?? null : null),
    items: o.items ?? [], days: o.days ?? [], start_time: o.start_time?.slice(0, 5) ?? "", end_time: o.end_time?.slice(0, 5) ?? "",
    start_date: o.start_date ?? "", end_date: o.end_date ?? "", branches: o.branches ?? [], channels: o.channels ?? [], code: o.code ?? "",
    is_active: o.is_active ?? true,
  });
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"info" | "history">("info");
  const [err, setErr] = useState<string | null>(null);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allItems = sections.flatMap((s) => s.items);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const body: Partial<Offer> & { change_reason?: string } = {
      ...f, kind: f.kind as Offer["kind"], applies_to: f.applies_to as Offer["applies_to"],
      start_time: f.start_time || null, end_time: f.end_time || null, start_date: f.start_date || null, end_date: f.end_date || null,
      category: f.applies_to === "category" ? f.category : null, items: f.applies_to === "items" ? f.items : [],
      ...(o.id ? { id: o.id } : {}), ...(reason ? { change_reason: reason } : {}),
    };
    try { onSent(changeMessage(await manageApi.saveOffer(body))); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };

  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${on ? "bg-ink text-cream ring-ink" : "bg-white ring-ink/10"}`;

  return (
    <Modal title={o.id ? o.name ?? "Offer" : "New offer"} onClose={onClose} wide>
      {o.id && (
        <div className="mb-4 flex gap-2">
          {(["info", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>
              {t === "info" ? "🏷 Offer" : "🕘 History"}</button>
          ))}
        </div>
      )}
      {tab === "history" && o.id ? <RecordHistory model="offer" id={o.id} /> : (
        <form onSubmit={save}>
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="Offer name"><input className="input !py-2" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Type">
                <select className="input !py-2" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Offer["kind"] })}>
                  <option value="percent">% off</option><option value="amount">$ off each</option><option value="price">Special price</option>
                </select>
              </Field>
              <Field label={f.kind === "percent" ? "Percent" : "Amount ($)"}>
                <input className="input !py-2" type="number" step="0.01" min="0.01" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </Field>
            </div>
            <Field label="Description (shown to customers)"><input className="input !py-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
              <p className="mb-2 text-sm font-semibold">Applies to</p>
              <div className="flex flex-wrap gap-2">
                {([["all", "Whole menu"], ["category", "A menu section"], ["items", "Chosen items"]] as const).map(([k, l]) => (
                  <button type="button" key={k} className={chip(f.applies_to === k)} onClick={() => setF({ ...f, applies_to: k })}>{l}</button>
                ))}
              </div>
              {f.applies_to === "category" && (
                <select className="input mt-3 !py-2" value={f.category ?? ""} onChange={(e) => setF({ ...f, category: Number(e.target.value) })}>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                </select>
              )}
              {f.applies_to === "items" && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-cream p-2">
                  {sections.map((s) => (
                    <div key={s.id} className="mb-2">
                      <p className="text-xs font-bold uppercase text-ink-soft">{s.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.items.map((i) => (
                          <button type="button" key={i.id} className={`${chip(f.items.includes(i.id))} !px-2 !py-1 text-xs`} onClick={() => setF({ ...f, items: toggle(f.items, i.id) })}>
                            {i.name} · {usd(i.price)}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {f.applies_to === "items" && f.items.length > 0 && <p className="mt-2 text-xs text-ink-soft">{f.items.length} selected: {allItems.filter((i) => f.items.includes(i.id)).map((i) => i.name).join(", ")}</p>}
            </div>

            <div className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold">Days <span className="font-normal text-ink-soft">(none = every day)</span></p>
                <div className="flex flex-wrap gap-1">
                  {DAY_NAMES.map((n, i) => <button type="button" key={n} className={`${chip(f.days.includes(i))} !px-2.5`} onClick={() => setF({ ...f, days: toggle(f.days, i).sort() })}>{n}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="From time"><input className="input !py-2" type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
                <Field label="To time"><input className="input !py-2" type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
                <Field label="Starts on"><input className="input !py-2" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
                <Field label="Ends on"><input className="input !py-2" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10 md:grid-cols-3">
              <div>
                <p className="mb-2 text-sm font-semibold">Where <span className="font-normal text-ink-soft">(none = all)</span></p>
                <div className="flex flex-wrap gap-1">
                  {CHANNELS.map(([k, l]) => <button type="button" key={k} className={chip(f.channels.includes(k))} onClick={() => setF({ ...f, channels: toggle(f.channels, k) })}>{l}</button>)}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">Stores <span className="font-normal text-ink-soft">(none = all)</span></p>
                <div className="flex flex-wrap gap-1">
                  {user?.branches.map((b) => <button type="button" key={b.id} className={chip(f.branches.includes(b.id))} onClick={() => setF({ ...f, branches: toggle(f.branches, b.id) })}>{b.name}</button>)}
                </div>
              </div>
              <Field label="Promo code" hint="Optional — only applies when the customer enters it">
                <input className="input !py-2 font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Offer is on</label>
              {o.id && <input className="input !w-auto flex-1 !py-2" placeholder="Why the change? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />}
            </div>
          </fieldset>
          <ErrorBox error={err} />
          {canEdit && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">{level >= 5 ? "Saved right away." : `Goes to a ${["", "", "", "super admin", "admin"][level]} for approval.`}</p>
              <button className="btn-primary">{o.id ? "Send change" : "Create offer"}</button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
