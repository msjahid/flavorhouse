import type { Metadata } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { SITE_NAME } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — Wings, Burgers & Shakes`, template: `%s · ${SITE_NAME}` },
  description: "Order flavoured wings, smash burgers, milkshakes, drinks and cakes online.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
