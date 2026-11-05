"use client";

import { useState } from "react";
import { Card, ErrorBox, Field, Modal, PageHeader, useLoad, usd } from "@/components/manage/ui";
import { manageApi, type Branch } from "@/lib/manage";

export default function BranchesPage() {
  const { data, error, reload } = useLoad(() => manageApi.branches(), []);
  const [edit, setEdit] = useState<Partial<Branch> | null>(null);
  return (
    <div>
      <PageHeader title="Branches" sub="Locations, minimum wages and drawer float">
        <button className="btn-primary" onClick={() => setEdit({ is_active: true, min_wage: "7.25", tipped_min_wage: "2.13", opening_float: "200.00" })}>+ Add branch</button>
      </PageHeader>
      <ErrorBox error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((b) => (
          <Card key={b.id} title={`🏪 ${b.name}`} action={<button className="text-sm font-semibold text-flame" onClick={() => setEdit(b)}>Edit</button>}>
            <p className="text-sm text-ink-soft">{b.address || "No address"} {b.phone && `· ${b.phone}`}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-cream p-2">Min wage<br /><b>{usd(b.min_wage)}/hr</b></div>
              <div className="rounded-xl bg-cream p-2">Tipped min<br /><b>{usd(b.tipped_min_wage)}/hr</b></div>
              <div className="rounded-xl bg-cream p-2">Drawer float<br /><b>{usd(b.opening_float)}</b></div>
            </div>
            {!b.is_active && <p className="mt-2 text-sm font-semibold text-flame">Inactive</p>}
          </Card>
        ))}
      </div>
      {edit && <BranchForm b={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function BranchForm({ b, onClose, onSaved }: { b: Partial<Branch>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(b);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Branch) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await manageApi.saveBranch(f); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : "Failed"); }
  };
  return (
    <Modal title={b.id ? `Edit ${b.name}` : "New branch"} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className="input !py-2" required value={f.name ?? ""} onChange={set("name")} /></Field>
        <Field label="Short code" hint="letters/numbers, e.g. uptown"><input className="input !py-2" required pattern="[a-z0-9-]+" value={f.code ?? ""} onChange={set("code")} /></Field>
        <div className="col-span-2"><Field label="Address"><input className="input !py-2" value={f.address ?? ""} onChange={set("address")} /></Field></div>
        <Field label="Phone"><input className="input !py-2" value={f.phone ?? ""} onChange={set("phone")} /></Field>
        <Field label="State" hint="2 letters, e.g. NY"><input className="input !py-2" maxLength={2} value={f.state ?? ""} onChange={set("state")} /></Field>
        <Field label="Minimum wage ($/hr)" hint="Check your state & city rate"><input className="input !py-2" type="number" step="0.01" value={f.min_wage ?? ""} onChange={set("min_wage")} /></Field>
        <Field label="Tipped minimum ($/hr)"><input className="input !py-2" type="number" step="0.01" value={f.tipped_min_wage ?? ""} onChange={set("tipped_min_wage")} /></Field>
        <Field label="Drawer float ($)" hint="Cash left in the drawer each morning"><input className="input !py-2" type="number" step="0.01" value={f.opening_float ?? ""} onChange={set("opening_float")} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm font-semibold"><input type="checkbox" checked={!!f.is_active} onChange={set("is_active")} /> Active</label>
        <div className="col-span-2"><ErrorBox error={err} /></div>
        <button className="btn-primary col-span-2">Save branch</button>
      </form>
    </Modal>
  );
}
