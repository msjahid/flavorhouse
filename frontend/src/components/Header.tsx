"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { SITE_NAME } from "@/lib/format";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/menu?category=wings", label: "Wings" },
  { href: "/menu?category=milkshakes", label: "Shakes" },
];

export default function Header() {
  const { count, ready } = useCart();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="font-display text-2xl font-extrabold">
          <span className="text-flame">🔥</span> {SITE_NAME}
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-semibold md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`hover:text-flame ${pathname === n.href ? "text-flame" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <Link href="/cart" className="btn-dark !px-4 !py-2 text-sm" aria-label="View cart">
          🛒 Cart
          {ready && count > 0 && (
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-mustard px-1.5 text-xs font-bold text-ink">
              {count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
