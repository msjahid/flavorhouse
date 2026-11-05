"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { Avatar } from "@/components/pos/PosShell";

/** Simple frame for pages every staff member uses: My profile, Messages. */
export default function StaffShell({ children }: { children: React.ReactNode }) {
  const { user, checking, logout } = usePosAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!checking && !user) router.replace(`/pos/login?next=${encodeURIComponent(pathname)}`);
  }, [checking, user, router, pathname]);
  if (checking || !user) return <div className="grid min-h-screen place-items-center bg-ink text-cream/60">Loading…</div>;
  const tab = (href: string, label: string) => (
    <Link href={href} className={`rounded-xl px-3 py-2 text-sm font-semibold ${pathname.startsWith(href) ? "bg-cream text-ink" : "text-cream/75 hover:bg-cream/10"}`}>{label}</Link>
  );
  return (
    <div className="min-h-screen bg-cream-dark/50">
      <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-2 bg-ink px-2 py-1.5 text-cream sm:px-4">
        <span className="mr-1 font-display text-lg font-extrabold">🔥<span className="hidden sm:inline"> {SITE_NAME}</span></span>
        {tab("/me", "👤 My profile")}
        {tab("/messages", "✉️ Messages")}
        <div className="ml-auto flex items-center gap-2">
          {user.level >= 2 && <Link href="/manage" className="rounded-xl px-2 py-2 text-sm font-semibold text-mustard hover:bg-cream/10 sm:px-3">🏢<span className="hidden sm:inline"> Back office</span></Link>}
          <span className="hidden sm:inline"><Avatar user={user} /></span>
          <button onClick={logout} className="rounded-xl px-2 py-2 text-sm font-semibold hover:bg-cream/10 sm:px-3">Log out</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-6">{children}</main>
    </div>
  );
}
