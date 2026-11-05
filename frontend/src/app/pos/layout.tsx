import type { Metadata } from "next";
import { PosAuthProvider } from "@/context/PosAuth";
import PosShell from "@/components/pos/PosShell";

export const metadata: Metadata = { title: "POS", robots: { index: false, follow: false } };

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <PosAuthProvider>
      <PosShell>{children}</PosShell>
    </PosAuthProvider>
  );
}
