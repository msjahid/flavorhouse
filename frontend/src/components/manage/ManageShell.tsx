"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { manageApi, type Notification } from "@/lib/manage";
import { dt } from "./ui";
import { Avatar } from "@/components/pos/PosShell";

const NAV = [
  { href: "/manage", label: "Overview", icon: "📈", min: 2, group: "" },
  { href: "/manage/approvals", label: "Approvals", icon: "✅", min: 2, group: "" },
  { href: "/messages", label: "Messages", icon: "✉️", min: 2, group: "" },
  { href: "/manage/sales", label: "Sales by employee", icon: "📑", min: 2, group: "Money" },
  { href: "/manage/cash", label: "Cash & deposits", icon: "💵", min: 2, group: "Money" },
  { href: "/manage/purchases", label: "Purchases", icon: "🧾", min: 2, group: "Money" },
  { href: "/manage/vendors", label: "Vendors", icon: "🚚", min: 2, group: "Money" },
  { href: "/manage/bills", label: "Monthly bills", icon: "💡", min: 2, group: "Money" },
  { href: "/manage/pnl", label: "Profit & loss", icon: "💰", min: 4, group: "Money" },
  { href: "/manage/tax", label: "Sales tax", icon: "🏛", min: 4, group: "Money" },
  { href: "/manage/delivery-apps", label: "Delivery apps", icon: "🛵", min: 3, group: "Money" },
  { href: "/manage/owners", label: "Owners & split", icon: "🤝", min: 5, group: "Money" },
  { href: "/manage/customers", label: "Customers", icon: "🧑‍🤝‍🧑", min: 2, group: "People" },
  { href: "/manage/staff", label: "Staff", icon: "👥", min: 2, group: "People" },
  { href: "/manage/payroll", label: "Hours & wages", icon: "⏱", min: 2, group: "People" },
  { href: "/manage/menu", label: "Menu & prices", icon: "🍔", min: 2, group: "Menu" },
  { href: "/manage/offers", label: "Offers", icon: "🏷", min: 2, group: "Menu" },
  { href: "/manage/screens", label: "TV screens", icon: "📺", min: 2, group: "Menu" },
  { href: "/manage/settings", label: "Tips & customer screen", icon: "💛", min: 4, group: "Admin" },
  { href: "/manage/history", label: "History", icon: "🕘", min: 2, group: "Admin" },
  { href: "/manage/branches", label: "Branches", icon: "🏪", min: 5, group: "Admin" },
];

function Bell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => { manageApi.notifications().then(setData).catch(() => {}); }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => { clearInterval(t); document.removeEventListener("mousedown", close); };
  }, [load]);

  const toggleRead = async (n: Notification) => { await manageApi.markNotification(n.id, !n.is_read); load(); };
  const openOne = async (n: Notification) => {
    if (!n.is_read) await manageApi.markNotification(n.id, true);
    setOpen(false); load();
    if (n.link) router.push(n.link);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative grid h-10 w-10 place-items-center rounded-full bg-white ring-1 ring-ink/10" aria-label="Notifications">
        🔔
        {data.unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-flame px-1 text-[11px] font-bold text-white">{data.unread}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-14 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-ink/10">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
            <p className="font-bold">Notifications</p>
            {data.unread > 0 && <button className="text-xs font-semibold text-flame" onClick={async () => { await manageApi.readAll(); load(); }}>Mark all read</button>}
          </div>
          <ul className="max-h-[60vh] divide-y divide-ink/5 overflow-y-auto">
            {data.items.length === 0 && <li className="p-6 text-center text-sm text-ink-soft">Nothing yet</li>}
            {data.items.map((n) => (
              <li key={n.id} className={`flex gap-2 px-4 py-3 ${n.is_read ? "" : "bg-mustard/10"}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => openOne(n)}>
                  <p className={`text-sm ${n.is_read ? "" : "font-bold"}`}>{n.title}</p>
                  {n.body && <p className="text-xs text-ink-soft">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-ink-soft">{dt(n.created_at)}</p>
                </button>
                <button onClick={() => toggleRead(n)} title={n.is_read ? "Mark unread" : "Mark read"}
                        className="h-6 shrink-0 rounded-full px-2 text-[11px] font-semibold text-ink-soft ring-1 ring-ink/10 hover:ring-ink">
                  {n.is_read ? "Unread" : "Read"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ManageShell({ children }: { children: React.ReactNode }) {
  const { user, checking, logout } = usePosAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!checking && !user) router.replace(`/pos/login?next=${encodeURIComponent(pathname)}`);
  }, [checking, user, router, pathname]);

  useEffect(() => {
    if (!user || user.level < 2) return;
    const load = () => manageApi.approvals().then((a) => setPending(a.count)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [user, pathname]);

  if (checking || !user) return <div className="grid min-h-screen place-items-center bg-ink text-cream/60">Loading…</div>;
  if (user.level < 2) {
    return (
      <div className="grid min-h-screen place-items-center bg-cream p-6 text-center">
        <div>
          <p className="text-5xl">🔒</p>
          <h1 className="mt-2 font-display text-2xl font-extrabold">The back office is for managers and above</h1>
        </div>
      </div>
    );
  }

  const navList = (
    <nav className="no-scrollbar mt-5 flex-1 space-y-0.5 overflow-y-auto">
      {NAV.filter((n) => user.level >= n.min).map((n, i, arr) => {
        const active = n.href === "/manage" ? pathname === "/manage" : pathname.startsWith(n.href);
        const head = n.group && n.group !== arr[i - 1]?.group;
        return (
          <div key={n.href}>
          {head && <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-cream/35">{n.group}</p>}
          <Link href={n.href} onClick={() => setMenu(false)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold md:py-2 ${active ? "bg-cream text-ink" : "text-cream/75 hover:bg-cream/10"}`}>
            <span>{n.icon}</span>{n.label}
            {n.href === "/manage/approvals" && pending > 0 && (
              <span className="ml-auto rounded-full bg-flame px-2 text-xs text-white">{pending}</span>
            )}
          </Link>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-cream-dark/50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink p-4 text-cream md:flex">
        <p className="font-display text-xl font-extrabold">🔥 {SITE_NAME}</p>
        <p className="text-xs text-cream/50">Back office</p>
        {navList}
      </aside>

      {/* Phones & tablets: the same menu slides in from the left */}
      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMenu(false)}>
          <div className="absolute inset-0 bg-ink/50" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-ink p-4 text-cream shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-xl font-extrabold">🔥 {SITE_NAME}</p>
              <button onClick={() => setMenu(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-cream/10" aria-label="Close menu">✕</button>
            </div>
            {navList}
            <Link href="/me" className="rounded-xl px-3 py-2.5 text-sm font-semibold text-cream/75 hover:bg-cream/10">👤 My profile</Link>
            <button onClick={logout} className="rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-flame hover:bg-cream/10">Log out</button>
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink/10 bg-cream/90 px-3 py-2 backdrop-blur sm:gap-3 sm:px-6 sm:py-3">
          <button onClick={() => setMenu(true)} className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-bold text-cream md:hidden" aria-label="Open menu">
            ☰ <span>{NAV.find((n) => (n.href === "/manage" ? pathname === "/manage" : pathname.startsWith(n.href)))?.label ?? "Menu"}</span>
            {pending > 0 && <span className="rounded-full bg-flame px-1.5 text-[11px]">{pending}</span>}
          </button>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Bell />
            <Link href="/me" className="flex items-center gap-2 rounded-2xl px-2 py-1 hover:bg-white" title="My profile & earnings">
              <Avatar user={user} size={36} />
              <span className="hidden text-left text-sm leading-tight sm:block">
                <span className="block font-bold">{user.name}</span>
                <span className="block text-xs text-ink-soft">{user.role_display}{user.branch ? ` · ${user.branch.name}` : user.level >= 5 ? " · all stores" : ` · ${user.branches.length} stores`}</span>
              </span>
            </Link>
            <button onClick={logout} className="btn-ghost hidden !px-3 !py-1.5 text-sm sm:inline-flex">Log out</button>
          </div>
        </header>
        <main className="p-3 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
