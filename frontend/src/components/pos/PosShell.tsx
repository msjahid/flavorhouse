"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { money, SITE_NAME } from "@/lib/format";
import { Select } from "@/components/Pickers";
import { getDeviceKey, posApi, setDeviceKey, timeOf, type ClockStatus, type PosUser } from "@/lib/pos";

const NAV = [
  { href: "/pos", label: "Register", icon: "🧾", min: 1 },
  { href: "/pos/kitchen", label: "Kitchen", icon: "👨‍🍳", min: 1 },
  { href: "/pos/orders", label: "Orders", icon: "📋", min: 1 },
  { href: "/pos/reports", label: "Today", icon: "📊", min: 2 },
  { href: "/pos/menus", label: "Screens", icon: "📺", min: 1 },
];

const WEEK_TARGET = 40;

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>;
}

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const hm = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`;

export function Avatar({ user, size = 32 }: { user: Pick<PosUser, "name" | "photo_url">; size?: number }) {
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return user.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.photo_url} alt="" style={{ width: size, height: size }} className="rounded-full object-cover ring-2 ring-cream/30" />
  ) : (
    <span style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-mustard text-xs font-extrabold text-ink">{initials}</span>
  );
}

/** Time clock: live shift timer, today / week hours with a 40 h bar, estimated earnings. */
function TimeClock() {
  const { user, branchId } = usePosAuth();
  const [st, setSt] = useState<ClockStatus | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [tips, setTips] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    posApi.clockStatus().then((s) => { setSt(s); setLoadedAt(Date.now()); }).catch(() => setSt(null));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!user || !st) return null; // owner accounts without a staff profile don't use the clock

  const shiftMs = st.clocked_in && st.since ? now - new Date(st.since).getTime() : 0;
  const extra = st.clocked_in ? (now - loadedAt) / 3_600_000 : 0;
  const today = parseFloat(st.today_hours) + extra;
  const week = parseFloat(st.week_hours ?? "0") + extra;
  const rate = st.hourly_rate ? parseFloat(st.hourly_rate) : null;
  const pctWeek = Math.min(100, (week / WEEK_TARGET) * 100);

  const toggle = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await posApi.clock(st.clocked_in ? tips.trim() || undefined : undefined, branchId);
      setSt(s); setLoadedAt(Date.now()); setTips("");
      if (!s.clocked_in) setOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${st.clocked_in ? "bg-leaf text-white" : "bg-cream/10 text-cream hover:bg-cream/20"}`}>
        {st.clocked_in ? (<><span className="h-2 w-2 animate-pulse rounded-full bg-white" /><span className="tabular-nums">{hms(shiftMs)}</span></>) : "⏱ Clock in"}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-50 rounded-3xl bg-cream p-5 text-ink shadow-2xl ring-1 ring-ink/10 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-80">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">{st.clocked_in ? `On shift · ${st.branch ?? ""}` : "Off the clock"}</p>
          {st.clocked_in ? (
            <>
              <p className="mt-1 font-display text-5xl font-extrabold tabular-nums">{hms(shiftMs)}</p>
              <p className="text-sm text-ink-soft">Started {timeOf(st.since!)}</p>
            </>
          ) : (
            <p className="mt-1 font-display text-2xl font-extrabold">Ready to start?</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-white p-3 ring-1 ring-ink/5">
              <p className="text-[11px] font-bold uppercase text-ink-soft">Today</p>
              <p className="font-display text-xl font-extrabold tabular-nums">{hm(today)}</p>
            </div>
            <div className="rounded-2xl bg-white p-3 ring-1 ring-ink/5">
              <p className="text-[11px] font-bold uppercase text-ink-soft">This week</p>
              <p className="font-display text-xl font-extrabold tabular-nums">{hm(week)}</p>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-[11px] font-semibold text-ink-soft"><span>Week</span><span>{week.toFixed(1)} / {WEEK_TARGET} h{week > WEEK_TARGET && " · overtime"}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10">
              <div className={`h-full rounded-full ${week > WEEK_TARGET ? "bg-flame" : "bg-leaf"}`} style={{ width: `${pctWeek}%` }} />
            </div>
          </div>
          {rate !== null && rate > 0 && (
            <p className="mt-3 text-sm">Est. this week <b>{money(Math.min(week, WEEK_TARGET) * rate + Math.max(0, week - WEEK_TARGET) * rate * 1.5)}</b>
              <span className="text-ink-soft"> before tips · {money(rate)}/h</span></p>
          )}

          {st.clocked_in && (
            <label className="mt-4 block text-sm font-semibold">Cash tips this shift
              <input className="input mt-1 !py-2" inputMode="decimal" placeholder="0.00" value={tips} onChange={(e) => setTips(e.target.value)} />
            </label>
          )}
          {err && <p className="mt-2 rounded-xl bg-flame/10 p-2 text-xs text-flame">{err}</p>}
          <button onClick={toggle} disabled={busy} className={`${st.clocked_in ? "btn-dark" : "btn-primary"} mt-4 w-full`}>
            {busy ? "…" : st.clocked_in ? "Clock out" : "Clock in now"}
          </button>
          <Link href="/me" className="mt-2 block text-center text-xs font-semibold text-flame">My hours & earnings →</Link>
        </div>
      )}
    </div>
  );
}

/** Manager+: register this register/tablet for a store so employees can sign in on it. */
function DevicePanel({ onClose }: { onClose: () => void }) {
  const { user, branchId } = usePosAuth();
  const [st, setSt] = useState<Awaited<ReturnType<typeof posApi.device>> | null>(null);
  const [name, setName] = useState("Front register");
  const [branch, setBranch] = useState<number | null>(branchId ?? user?.branch?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { posApi.device().then(setSt).catch(() => setSt({ registered: false, id: null, name: null, branch: null, branch_name: null })); }, []);

  const register = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await posApi.registerDevice(name, branch);
      setDeviceKey(r.key);
      setSt({ registered: true, id: r.id, name: r.name, branch: r.branch, branch_name: r.branch_name });
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-cream p-6 text-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-extrabold">🖥 This device</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/10">✕</button>
        </div>
        {!st ? <p className="mt-4 text-sm">Checking…</p> : st.registered ? (
          <div className="mt-4 rounded-2xl bg-leaf/10 p-4 text-sm">
            <p className="font-bold text-leaf">✓ Registered store device</p>
            <p className="mt-1">“{st.name}” · {st.branch_name}</p>
            <p className="mt-2 text-xs text-ink-soft">Employees of {st.branch_name} can sign in here. To remove it, go to Back office → Devices.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink-soft">Employees can only sign in on registered store devices, so a phone or home computer can’t be used to clock in or ring up sales.</p>
            <label className="block text-sm font-semibold">Device name
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front register, Drive-thru tablet…" />
            </label>
            {user && user.branches.length > 1 && (
              <label className="block text-sm font-semibold">Store
                <select className="input mt-1" value={branch ?? ""} onChange={(e) => setBranch(Number(e.target.value))}>
                  {user.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {err && <p className="rounded-xl bg-flame/10 p-2 text-sm text-flame">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || !name.trim()} onClick={register}>Register this device</button>
          </div>
        )}
        {getDeviceKey() && st && !st.registered && (
          <p className="mt-3 text-xs text-flame">This device had a key that is no longer active (it was removed). Register it again if it should be used.</p>
        )}
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = usePosAuth();
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!user) return null;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-cream/10" title={user.employee_id}>
        <Avatar user={user} />
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-semibold text-cream">{user.name}</span>
          <span className="block text-[11px] text-cream/50">{user.role_display}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl bg-cream text-sm text-ink shadow-2xl ring-1 ring-ink/10">
          <Link href="/me" className="block px-4 py-3 font-semibold hover:bg-ink/5">👤 My profile & earnings</Link>
          <Link href="/messages" className="block px-4 py-3 font-semibold hover:bg-ink/5">✉️ Messages</Link>

          <button onClick={logout} className="block w-full border-t border-ink/10 px-4 py-3 text-left font-semibold text-flame hover:bg-ink/5">Log out</button>
        </div>
      )}
      {device && <DevicePanel onClose={() => setDevice(false)} />}
    </div>
  );
}

function BranchPicker() {
  const { user, setBranchId } = usePosAuth();
  return (
    <div className="grid h-full place-items-center bg-cream-dark/60 p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow">
        <p className="text-5xl">🏪</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold">Which branch is this register in?</h1>
        <p className="mt-1 text-sm text-ink-soft">This device will remember it.</p>
        <div className="mt-5 grid gap-2">
          {user?.branches.map((b) => (
            <button key={b.id} onClick={() => setBranchId(b.id)} className="btn-dark w-full">{b.name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PosShell({ children }: { children: React.ReactNode }) {
  const { user, checking, branchId, branchName, setBranchId } = usePosAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/pos/login";

  useEffect(() => {
    if (checking) return;
    if (!user && !onLogin) router.replace(`/pos/login?next=${encodeURIComponent(pathname)}`);
  }, [user, checking, onLogin, router, pathname]);

  if (onLogin) return <div className="min-h-screen bg-ink">{children}</div>;
  if (checking || !user) {
    return <div className="grid min-h-screen place-items-center bg-ink text-cream/60">Loading…</div>;
  }

  const multi = user.branches.length > 1 && user.level >= 3;

  return (
    <div className="flex h-screen flex-col bg-cream-dark/60 print:h-auto print:bg-white">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-ink px-2 py-1.5 text-cream sm:px-3 print:hidden">
        <span className="mr-1 whitespace-nowrap font-display text-lg font-extrabold">🔥 <span className="hidden sm:inline">{SITE_NAME} </span><span className="text-mustard">POS</span></span>
        {/* On phones the menu drops to its own row and scrolls sideways — every option stays available */}
        <nav className="no-scrollbar order-last -mx-2 flex w-[calc(100%+1rem)] gap-1 overflow-x-auto px-2 pb-1 lg:order-none lg:mx-0 lg:w-auto lg:px-0 lg:pb-0">
          {NAV.filter((n) => user.level >= n.min).map((n) => {
            const active = n.href === "/pos" ? pathname === "/pos" : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-cream text-ink" : "text-cream/75 hover:bg-cream/10 hover:text-cream"}`}>
                <span className="mr-1">{n.icon}</span>{n.label}
              </Link>
            );
          })}
          {user.level >= 2 && (
            <Link href="/manage" className="shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold text-mustard hover:bg-cream/10">
              🏢 Back office
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 text-sm text-cream/75 sm:gap-2">
          {multi ? (
            <Select dark size="sm" value={String(branchId ?? "")} onChange={(v) => setBranchId(Number(v))} placeholder="Choose store" ariaLabel="Store"
              options={user.branches.map((b) => ({ value: String(b.id), label: b.name, icon: "🏪" }))} />
          ) : (
            branchName && <span className="hidden rounded-xl bg-cream/10 px-3 py-2 font-semibold text-cream sm:inline">🏪 {branchName}</span>
          )}
          <TimeClock />
          <span className="hidden px-1 sm:inline"><Clock /></span>
          <UserMenu />
        </div>
      </header>
      <div className="min-h-0 flex-1 print:overflow-visible">{branchId ? children : <BranchPicker />}</div>
    </div>
  );
}
