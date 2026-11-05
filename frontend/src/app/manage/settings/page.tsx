"use client";

import { useState } from "react";
import { Card, dt, Empty, ErrorBox, PageHeader, useLoad } from "@/components/manage/ui";
import { usePosAuth } from "@/context/PosAuth";
import { manageApi, type TipSettingsData } from "@/lib/manage";

/** POS settings: the tip question on the customer screen. Super admins view, the admin changes. */
export default function SettingsPage() {
  const { user } = usePosAuth();
  const tips = useLoad(() => manageApi.tipSettings(), []);
  if ((user?.level ?? 0) < 4) return <Card><Empty>🔒 For super admins and the admin.</Empty></Card>;
  return (
    <div>
      <PageHeader title="Tips & customer screen" sub="What the customer screen asks at the register. Open it from the register with 📺 Customer screen (managers and above)." />
      <ErrorBox error={tips.error} />
      {tips.data && <TipCard t={tips.data} onSaved={tips.reload} />}
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-ink/10">
      <span className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${on ? "bg-leaf" : "bg-ink/20"}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-5" : ""}`} />
      </span>
      <span><span className="block text-sm font-semibold">{label}</span>{hint && <span className="block text-xs text-ink-soft">{hint}</span>}</span>
    </button>
  );
}

function TipCard({ t, onSaved }: { t: TipSettingsData; onSaved: () => void }) {
  const [f, setF] = useState({ enabled: t.enabled, allow_custom: t.allow_custom, percents: t.percents.map(String) });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const save = async () => {
    setErr(null); setOk(false);
    try {
      await manageApi.saveTipSettings({ enabled: f.enabled, allow_custom: f.allow_custom, percents: f.percents.filter((p) => p.trim()).map(Number) });
      setOk(true); onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <Card title="💛 Tip question on the customer screen">
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <p className="text-sm text-ink-soft">
            When the cashier presses <b>Charge</b>, the customer screen flashes <b>“Would you like to add a tip?” Yes / No</b>.
            Yes shows the options below (and <b>Custom</b>). The tip is added on top of the total — it isn&apos;t a sale and isn&apos;t taxed.
            Open the screen from the register (📺 Customer screen) on the second monitor or a tablet set up with the same device key.
          </p>
          <fieldset disabled={!t.can_edit} className="mt-4 space-y-3">
            <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Ask customers for a tip" />
            <div>
              <p className="mb-1 text-sm font-semibold">Tip options (%)</p>
              <div className="flex flex-wrap items-center gap-2">
                {f.percents.map((p, i) => (
                  <span key={i} className="flex items-center rounded-xl bg-white ring-1 ring-ink/10">
                    <input className="w-16 rounded-xl bg-transparent px-3 py-2 text-center font-bold outline-none" inputMode="decimal" value={p}
                           onChange={(e) => setF({ ...f, percents: f.percents.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)) })} />
                    <span className="pr-1 text-ink-soft">%</span>
                    {f.percents.length > 1 && <button type="button" className="px-2 text-ink-soft hover:text-flame" onClick={() => setF({ ...f, percents: f.percents.filter((_, j) => j !== i) })}>✕</button>}
                  </span>
                ))}
                {f.percents.length < 4 && <button type="button" className="rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-dashed ring-ink/20" onClick={() => setF({ ...f, percents: [...f.percents, ""] })}>+ Add</button>}
              </div>
            </div>
            <Toggle on={f.allow_custom} onChange={(v) => setF({ ...f, allow_custom: v })} label="Let customers type a custom amount" />
          </fieldset>
          <ErrorBox error={err} />
          {ok && <p className="mt-2 text-sm font-semibold text-leaf">Saved — registers pick it up on the next order.</p>}
          {t.can_edit ? <button className="btn-primary mt-4" onClick={save}>Save tip options</button>
            : <p className="mt-3 text-xs text-ink-soft">Only the admin changes the tip options.</p>}
          {t.updated_by_name && <p className="mt-2 text-xs text-ink-soft">Last changed by {t.updated_by_name} · {dt(t.updated_at)}</p>}
        </div>
        {/* Preview */}
        <div className="rounded-3xl bg-ink p-5 text-center text-cream">
          <p className="text-xs uppercase tracking-wide text-cream/50">Customer screen preview</p>
          <div className="tip-flash mx-auto mt-4 rounded-3xl bg-cream p-5 text-ink">
            <p className="font-display text-xl font-extrabold">Would you like to add a tip?</p>
            <div className="mt-3 grid grid-cols-2 gap-2"><span className="tip-glow rounded-xl py-2 font-bold text-white">Yes</span><span className="rounded-xl bg-ink/10 py-2 font-bold">No</span></div>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {f.percents.filter((p) => p).map((p, i) => <span key={i} className="rounded-xl bg-cream px-3 py-2 font-bold text-ink">{p}%</span>)}
            {f.allow_custom && <span className="rounded-xl bg-mustard px-3 py-2 font-bold text-ink">Custom</span>}
          </div>
        </div>
      </div>
    </Card>
  );
}

