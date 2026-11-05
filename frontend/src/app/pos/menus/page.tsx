const ITEMS = [
  {
    href: "/kiosk",
    icon: "🧍",
    title: "Self-order kiosk",
    text: "Customers order on a touchscreen and pay at the counter. Their orders appear on Register → Kiosk orders.",
    tips: ["Sign in once on the kiosk device with a staff account", "Goes back to the start screen after 90 s without a touch"],
  },
  {
    href: "/order-board",
    icon: "✅",
    title: "Order status board",
    text: "TV for waiting customers showing Preparing and Ready order numbers, with a chime when an order is ready.",
    tips: ["Updates every 4 seconds from the kitchen", "Delivery orders aren't shown"],
  },
  {
    href: "/menu-board",
    icon: "📺",
    title: "TV menu board",
    text: "Full-screen menu for a TV above the counter. Updates prices and hides sold-out items automatically every minute.",
    tips: ["Press F11 (or use a kiosk device) for full screen", "Several TVs? Use /menu-board?categories=wings,burgers on one and ?categories=milkshakes,cakes on the other"],
  },
  {
    href: "/menu-card",
    icon: "🧾",
    title: "Printed menu card",
    text: "A designed take-away / table menu with every item, flavour and price. Print it or save as PDF for a print shop.",
    tips: ["US Letter by default; A4 at /menu-card?size=a4", "Re-print after changing prices"],
  },
  {
    href: "/table-cards",
    icon: "📱",
    title: "QR table cards",
    text: "Cards with a QR code that opens your online menu on customers' phones — 4 per page, numbered by table.",
    tips: ["Choose your table numbers, then print", "Scan one with your phone before printing them all"],
  },
];

export default function PosMenusPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="font-display text-3xl font-extrabold">Menus &amp; screens</h1>
        <p className="mt-1 text-ink-soft">Everything uses your live menu — change prices in admin and these update.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {ITEMS.map((i) => (
            <a key={i.href} href={i.href} target="_blank" rel="noreferrer"
               className="group flex flex-col rounded-3xl bg-white p-6 ring-1 ring-ink/5 transition hover:-translate-y-1 hover:shadow-lg">
              <span className="text-5xl">{i.icon}</span>
              <h2 className="mt-3 font-display text-xl font-bold group-hover:text-flame">{i.title}</h2>
              <p className="mt-1 text-sm text-ink-soft">{i.text}</p>
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-ink-soft">
                {i.tips.map((t) => <li key={t}>{t}</li>)}
              </ul>
              <span className="mt-auto pt-4 text-sm font-bold text-flame">Open {i.href} ↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
