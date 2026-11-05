import type { Metadata, Viewport } from "next";
import { PosAuthProvider } from "@/context/PosAuth";

export const metadata: Metadata = { title: "Order here", robots: { index: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <PosAuthProvider>{children}</PosAuthProvider>;
}
