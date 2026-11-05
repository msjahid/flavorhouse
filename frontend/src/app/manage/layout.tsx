import type { Metadata } from "next";
import { PosAuthProvider } from "@/context/PosAuth";
import ManageShell from "@/components/manage/ManageShell";

export const metadata: Metadata = { title: "Back office", robots: { index: false, follow: false } };

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return (
    <PosAuthProvider>
      <ManageShell>{children}</ManageShell>
    </PosAuthProvider>
  );
}
