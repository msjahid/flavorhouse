"use client";

import { useState } from "react";
import { Badge, Card, dt, Empty, ErrorBox, PageHeader, useLoad } from "@/components/manage/ui";
import { manageApi, type Device } from "@/lib/manage";

export default function DevicesPage() {
  const { data, error, reload } = useLoad(() => manageApi.devices(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = async (x: Device) => {
    if (x.is_active && !confirm(`Block “${x.name}”? Employees signed in on it are signed out and can’t use it until it’s re-enabled.`)) return;
    try { await manageApi.setDevice(x.id, !x.is_active); setMsg(`“${x.name}” ${x.is_active ? "blocked" : "enabled"}.`); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <div>
      <PageHeader title="Store devices" sub="Employees can only sign in on these registers and tablets. Managers and above can sign in anywhere." />
      <ErrorBox error={error} />
      {msg && <p className="mb-4 rounded-xl bg-mustard/30 p-3 text-sm">{msg}</p>}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {[["1️⃣", "Register a device", "A manager signs in on the register / tablet and taps their name → 🖥 This device → Register."],
          ["2️⃣", "Employees sign in there", "Employee sign-ins on phones or home computers are refused, and employee sign-ins end after 14 hours."],
          ["3️⃣", "Lost or stolen?", "Block the device here, or open Staff → a person → “Sign out everywhere”."]].map(([n, t, s]) => (
          <div key={t} className="rounded-3xl bg-white p-4 ring-1 ring-ink/5"><p className="text-2xl">{n}</p><p className="font-bold">{t}</p><p className="text-sm text-ink-soft">{s}</p></div>
        ))}
      </div>
      <Card>
        {data?.length === 0 ? <Empty>No devices registered yet.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b-2 border-ink/10 text-left text-xs uppercase text-ink-soft">
              <th className="px-3 py-2.5">Device</th><th className="px-3">Store</th><th className="px-3">Registered</th><th className="px-3">Last used</th><th className="px-3">Status</th><th className="px-3" /></tr></thead>
            <tbody className="divide-y divide-ink/5">
              {data?.map((x) => (
                <tr key={x.id}>
                  <td className="px-3 py-3 font-semibold">🖥 {x.name}</td>
                  <td className="px-3">{x.branch_name}</td>
                  <td className="px-3">{dt(x.created_at)}<span className="block text-xs text-ink-soft">by {x.registered_by_name ?? "—"}</span></td>
                  <td className="px-3">{x.last_seen ? dt(x.last_seen) : "never"}{x.last_user_name && <span className="block text-xs text-ink-soft">{x.last_user_name}</span>}</td>
                  <td className="px-3"><Badge status={x.is_active ? "active" : "inactive"}>{x.is_active ? "Allowed" : "Blocked"}</Badge></td>
                  <td className="px-3 text-right">
                    <button className={`rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ${x.is_active ? "text-flame ring-flame/30" : "ring-ink/10"}`} onClick={() => toggle(x)}>
                      {x.is_active ? "Block" : "Enable"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
