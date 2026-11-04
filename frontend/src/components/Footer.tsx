import Link from "next/link";
import { SITE_NAME } from "@/lib/format";

export default function Footer() {
  return (
    <footer className="mt-24 bg-ink text-cream">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="font-display text-2xl font-extrabold">🔥 {SITE_NAME}</p>
          <p className="mt-2 text-sm text-cream/70">Wings, burgers, shakes &amp; cakes — made fresh, served hot.</p>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Opening hours</p>
          <p className="text-cream/70">Mon – Thu · 11am – 10pm</p>
          <p className="text-cream/70">Fri – Sun · 11am – 12am</p>
        </div>
        <div className="text-sm">
          <p className="mb-2 font-semibold">Order</p>
          <Link href="/menu" className="block text-cream/70 hover:text-mustard">Full menu</Link>
          <Link href="/cart" className="block text-cream/70 hover:text-mustard">Your cart</Link>
        </div>
      </div>
      <p className="border-t border-cream/10 py-4 text-center text-xs text-cream/50">
        © {new Date().getFullYear()} {SITE_NAME}. Payments secured by Stripe.
      </p>
    </footer>
  );
}
