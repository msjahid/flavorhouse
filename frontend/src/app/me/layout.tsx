import type { Metadata } from "next";
import { PosAuthProvider } from "@/context/PosAuth";
import StaffShell from "@/components/StaffShell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <PosAuthProvider>
      <StaffShell>{children}</StaffShell>
    </PosAuthProvider>
  );
}
