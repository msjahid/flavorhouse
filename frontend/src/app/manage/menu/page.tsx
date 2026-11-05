"use client";

import { useState } from "react";
import { ChangeCard, RecordHistory } from "@/components/manage/ChangeViews";
import { Card, ErrorBox, Field, Modal, PageHeader, useLoad, usd } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { posApi } from "@/lib/pos";
import { changeMessage, manageApi, type MenuItemRow, type MenuSection, type OptionGroupRow } from "@/lib/manage";

const PRESETS: { label: string; g: OptionGroupRow }[] = [
  { label: "Size", g: { name: "Size", required: true, min_select: 1, max_select: 1, options: [
    { name: "Regular", price_delta: "0" }, { name: "Large", price_delta: "2.00" }] } },
  { label: "Flavour", g: { name: "Flavour", required: true, min_select: 1, max_select: 2, options: [
    { name: "Classic Buffalo", price_delta: "0" }, { name: "Honey BBQ", price_delta: "0" }, { name: "Lemon Pepper", price_delta: "0" }] } },
  { label: "Dips", g: { name: "Dips", required: false, min_select: 0, max_select: 4, options: [
    { name: "Ranch", price_delta: "0.75" }, { name: "Blue Cheese", price_delta: "0.75" }] } },
  { label: "Side", g: { name: "Side", required: true, min_select: 1, max_select: 1, options: [
    { name: "Fries", price_delta: "0" }, { name: "Onion Rings", price_delta: "1.00" }] } },
  { label: "Drink", g: { name: "Drink", required: true, min_select: 1, max_select: 1, options: [
    { name: "Soft drink", price_delta: "0" }, { name: "Lemonade", price_delta: "0.50" }] } },
  { label: "Add-ons", g: { name: "Add-ons", required: false, min_select: 0, max_select: 5, options: [
    { name: "Extra cheese", price_delta: "1.00" }, { name: "Bacon", price_delta: "1.50" }] } },
];

/** Sizes, flavours, dips, sides… with an extra price for each choice. */
function OptionsEditor({ value, onChange, disabled }: { value: OptionGroupRow[]; onChange: (v: OptionGroupRow[]) => void; disabled?: boolean }) {
  const setG = (i: number, g: Partial<OptionGroupRow>) => onChange(value.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const setO = (i: number, k: number, o: Partial<OptionGroupRow["options"][number]>) =>
    setG(i, { options: value[i].options.map((x, j) => (j === k ? { ...x, ...o } : x)) });
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const n = [...value]; [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  return (
    <div className="space-y-3">
      {value.map((g, i) => (
        <div key={i} className="rounded-2xl bg-white p-3 ring-1 ring-ink/10">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
            <Field label="Group name"><input className="input !py-1.5" value={g.name} onChange={(e) => setG(i, { name: e.target.value })} placeholder="Size, Flavour, Dips…" /></Field>
            <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold"><input type="checkbox" checked={g.required}
              onChange={(e) => setG(i, { required: e.target.checked, min_select: e.target.checked ? Math.max(1, g.min_select) : 0 })} /> Required</label>
            <Field label="Pick up to"><input className="input !w-20 !py-1.5" type="number" min={1} max={20} value={g.max_select}
              onChange={(e) => setG(i, { max_select: Math.max(1, Number(e.target.value) || 1) })} /></Field>
            <div className="flex gap-1 pb-1">
              <button type="button" className="rounded-lg px-2 py-1 ring-1 ring-ink/10" onClick={() => move(i, -1)} title="Move up">↑</button>
              <button type="button" className="rounded-lg px-2 py-1 ring-1 ring-ink/10" onClick={() => move(i, 1)} title="Move down">↓</button>
              <button type="button" className="rounded-lg px-2 py-1 text-flame ring-1 ring-flame/30" onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remove group">✕</button>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            <div className="grid grid-cols-[1fr_110px_80px_32px] gap-2 px-1 text-[11px] font-bold uppercase text-ink-soft"><span>Choice</span><span>Extra price</span><span>In stock</span><span /></div>
            {g.options.map((o, k) => (
              <div key={k} className="grid grid-cols-[1fr_110px_80px_32px] items-center gap-2">
                <input className="input !py-1.5" value={o.name} placeholder="e.g. 12 pieces" onChange={(e) => setO(i, k, { name: e.target.value })} />
                <div className="relative"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink-soft">+$</span>
                  <input className="input !py-1.5 !pl-7" type="number" step="0.01" min="0" value={o.price_delta} onChange={(e) => setO(i, k, { price_delta: e.target.value })} /></div>
                <label className="flex justify-center"><input type="checkbox" checked={o.is_available !== false} onChange={(e) => setO(i, k, { is_available: e.target.checked })} /></label>
                <button type="button" className="text-ink-soft hover:text-flame" onClick={() => setG(i, { options: g.options.filter((_, j) => j !== k) })}>✕</button>
              </div>
            ))}
            <button type="button" className="text-sm font-semibold text-flame" onClick={() => setG(i, { options: [...g.options, { name: "", price_delta: "0" }] })}>+ Add choice</button>
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Add a group:</span>
          {PRESETS.map((p) => (
            <button type="button" key={p.label} className="rounded-full bg-white px-3 py-1 text-sm font-semibold ring-1 ring-ink/10 hover:ring-flame"
              onClick={() => onChange([...value, JSON.parse(JSON.stringify(p.g))])}>+ {p.label}</button>
          ))}
          <button type="button" className="rounded-full bg-ink px-3 py-1 text-sm font-semibold text-cream"
            onClick={() => onChange([...value, { name: "", required: false, min_select: 0, max_select: 1, options: [{ name: "", price_delta: "0" }] }])}>+ Blank group</button>
        </div>
      )}
    </div>
  );
}

export default function MenuManagePage() {
  const { user } = usePosAuth();
  const canEdit = (user?.level ?? 0) >= 3;
  const { data, error, reload, setData } = useLoad(() => manageApi.menu(), []);
  const pending = useLoad(() => Promise.all([manageApi.changes({ status: "pending", kind: "menu_item" }), manageApi.changes({ status: "pending", kind: "category" })]).then(([a, b]) => [...a, ...b]), []);
  const [item, setItem] = useState<{ row: MenuItemRow | null; section: number } | null>(null);
  const [section, setSection] = useState<MenuSection | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const toggle = async (it: MenuItemRow) => {
    try {
      const r = await posApi.setAvailability(it.id, !it.is_available);
      setData((d) => d?.map((c) => ({ ...c, items: c.items.map((x) => (x.id === r.id ? { ...x, is_available: r.is_available } : x)) })) ?? d);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  const done = (m: string) => { setItem(null); setSection(null); setMsg(m); reload(); pending.reload(); };

  return (
    <div>
      <PageHeader title="Menu" sub={canEdit ? "Add items, combos and change prices. Changes are approved role-wise before customers see them." : "View the menu and mark items sold out. Supervisors and above change items and prices."}>
        <input className="input !w-56 !py-2" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        {canEdit && <button className="btn-ghost !py-2" onClick={() => setSection("new")}>+ Section</button>}
        {canEdit && data?.[0] && <button className="btn-primary" onClick={() => setItem({ row: null, section: data[0].id })}>+ Menu item</button>}
      </PageHeader>
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      {(pending.data?.length ?? 0) > 0 && (
        <Card title={`⏳ Menu changes waiting (${pending.data!.length})`} className="mb-4">
          <div className="grid gap-3 lg:grid-cols-2">{pending.data!.map((c) => <ChangeCard key={c.id} c={c} compact onDone={() => { pending.reload(); reload(); }} />)}</div>
        </Card>
      )}
      <div className="space-y-4">
        {data?.map((c) => {
          const items = c.items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
          if (q && !items.length) return null;
          return (
            <Card key={c.id} title={`${c.emoji} ${c.name}${c.is_active ? "" : " (hidden)"}`}
              action={canEdit && <div className="flex gap-2">
                <button className="rounded-lg px-3 py-1 text-xs font-bold ring-1 ring-ink/10 hover:ring-flame" onClick={() => setSection(c)}>Edit section</button>
                <button className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-cream" onClick={() => setItem({ row: null, section: c.id })}>+ Item</button></div>}>
              {c.slug === "combos" && <p className="mb-2 text-xs text-ink-soft">Combos are regular items with options (side, drink). Set the combo price lower than the items bought separately.</p>}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((i) => (
                  <div key={i.id} className={`flex items-center gap-3 rounded-2xl bg-cream/60 p-3 ring-1 ring-ink/5 ${i.is_available ? "" : "opacity-60"}`}>
                    {i.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={i.image} alt="" className="h-14 w-14 rounded-xl object-cover" />
                      : <span className="grid h-14 w-14 place-items-center rounded-xl bg-white text-3xl">{i.emoji || "🍽️"}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{i.name}</p>
                      <p className="text-sm font-bold">{usd(i.price)}
                        {i.is_featured && <span className="ml-2 text-xs font-semibold text-mustard">★</span>}
                        {i.is_spicy && <span className="ml-1 text-xs">🌶</span>}{i.is_vegetarian && <span className="ml-1 text-xs">🌱</span>}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button onClick={() => toggle(i)} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${i.is_available ? "bg-leaf/15 text-leaf" : "bg-ink text-cream"}`}>
                        {i.is_available ? "In stock" : "Sold out"}</button>
                      <button className="text-xs font-semibold text-ink-soft hover:text-flame" onClick={() => setItem({ row: i, section: c.id })}>{canEdit ? "Edit" : "View"}</button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {item && <ItemForm row={item.row} section={item.section} sections={data ?? []} canEdit={canEdit} level={user?.level ?? 0} onClose={() => setItem(null)} onSent={done} />}
      {section && <SectionForm s={section === "new" ? null : section} level={user?.level ?? 0} onClose={() => setSection(null)} onSent={done} />}
    </div>
  );
}

function ItemForm({ row, section, sections, canEdit, level, onClose, onSent }: {
  row: MenuItemRow | null; section: number; sections: MenuSection[]; canEdit: boolean; level: number; onClose: () => void; onSent: (m: string) => void;
}) {
  const [f, setF] = useState({
    name: row?.name ?? "", category: String(row?.category ?? section), price: row?.price ?? "", description: row?.description ?? "",
    emoji: row?.emoji ?? "", calories: row?.calories != null ? String(row.calories) : "", sort_order: String(row?.sort_order ?? 0),
    is_featured: row?.is_featured ?? false, is_spicy: row?.is_spicy ?? false, is_vegetarian: row?.is_vegetarian ?? false, is_available: row?.is_available ?? true,
  });
  const [image, setImage] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<"info" | "options" | "history">("info");
  const original = JSON.stringify(row?.option_groups ?? []);
  const [groups, setGroups] = useState<OptionGroupRow[]>(JSON.parse(original));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const priceChange = row && f.price && parseFloat(f.price) !== parseFloat(row.price);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => { if (k === "calories" && v === "") return; fd.append(k, String(v)); });
    if (image) fd.append("image", image);
    if (reason) fd.append("change_reason", reason);
    if (JSON.stringify(groups) !== original) {
      const bad = groups.find((g) => !g.name.trim() || !g.options.some((o) => o.name.trim()));
      if (bad) { setErr("Each option group needs a name and at least one choice."); setBusy(false); setTab("options"); return; }
      fd.append("option_groups", JSON.stringify(groups.map((g) => ({ ...g, options: g.options.filter((o) => o.name.trim()) }))));
    }
    try { onSent(changeMessage(await manageApi.saveItem(row?.id ?? null, fd))); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); setBusy(false); }
  };

  return (
    <Modal title={row ? row.name : "New menu item"} onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {([["info", "🍔 Item"], ["options", `⚙️ Options (sizes, flavours, add-ons)${groups.length ? ` · ${groups.length}` : ""}`], ...(row ? [["history", "🕘 Price & change history"]] : [])] as [typeof tab, string][]).map(([t, l]) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold ${tab === t ? "bg-ink text-cream" : "bg-white ring-1 ring-ink/10"}`}>{l}</button>
        ))}
      </div>
      {tab === "history" && row ? <RecordHistory model="menu item" id={row.id} /> : (
        <form onSubmit={save}>
          <fieldset disabled={!canEdit} className={tab === "options" ? "space-y-4" : "hidden"}>
            <p className="text-sm text-ink-soft">Customers pick these at the register, kiosk and website. The extra price is added to the item price ({usd(f.price || 0)}).</p>
            <OptionsEditor value={groups} onChange={setGroups} disabled={!canEdit} />
          </fieldset>
          <fieldset disabled={!canEdit} className={tab === "info" ? "space-y-4" : "hidden"}>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_80px]">
              <Field label="Name"><input className="input !py-2" required value={f.name} onChange={set("name")} /></Field>
              <Field label="Section">
                <select className="input !py-2" value={f.category} onChange={set("category")}>{sections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </Field>
              <Field label="Price ($)" hint={priceChange ? `Was ${usd(row!.price)}` : undefined}>
                <input className="input !py-2" type="number" step="0.01" min="0" required value={f.price} onChange={set("price")} />
              </Field>
              <Field label="Emoji"><input className="input !py-2 text-center" maxLength={4} value={f.emoji} onChange={set("emoji")} /></Field>
            </div>
            <Field label="Description"><textarea className="input !py-2" rows={2} value={f.description} onChange={set("description")} /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Photo" hint={row?.image ? "Leave empty to keep the current photo." : undefined}>
                <input type="file" accept="image/*" className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:font-semibold file:text-cream"
                       onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Calories"><input className="input !py-2" type="number" min="0" value={f.calories} onChange={set("calories")} /></Field>
              <Field label="Sort order" hint="Lower shows first"><input className="input !py-2" type="number" value={f.sort_order} onChange={set("sort_order")} /></Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm font-semibold">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_featured} onChange={set("is_featured")} /> ★ Featured</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_spicy} onChange={set("is_spicy")} /> 🌶 Spicy</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_vegetarian} onChange={set("is_vegetarian")} /> 🌱 Vegetarian</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_available} onChange={set("is_available")} /> In stock</label>
            </div>
            {row && <Field label="Why the change?"><input className="input !py-2" placeholder={priceChange ? "Supplier price went up" : "Optional"} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          </fieldset>
          <ErrorBox error={err} />
          {canEdit && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">{level >= 5 ? "Saved right away." : `Goes to a ${["", "", "", "super admin", "admin"][level]} for approval before it’s live.`}</p>
              <button className="btn-primary" disabled={busy}>{row ? "Send change" : "Add item"}</button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}

function SectionForm({ s, level, onClose, onSent }: { s: MenuSection | null; level: number; onClose: () => void; onSent: (m: string) => void }) {
  const [f, setF] = useState({ name: s?.name ?? "", emoji: s?.emoji ?? "", description: s?.description ?? "", sort_order: s?.sort_order ?? 0, is_active: s?.is_active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onSent(changeMessage(await manageApi.saveSection({ ...f, ...(s ? { id: s.id } : {}) }))); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Modal title={s ? `Section · ${s.name}` : "New menu section"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-[1fr_80px] gap-3">
          <Field label="Name"><input className="input !py-2" required placeholder="Combos" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Emoji"><input className="input !py-2 text-center" value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} /></Field>
        </div>
        <Field label="Description"><input className="input !py-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sort order"><input className="input !py-2" type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Show on menu</label>
        </div>
        <ErrorBox error={err} />
        <p className="text-sm text-ink-soft">{level >= 5 ? "Saved right away." : "Goes for approval role-wise."}</p>
        <button className="btn-primary w-full">{s ? "Send change" : "Add section"}</button>
      </form>
    </Modal>
  );
}
