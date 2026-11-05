"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePosAuth } from "@/context/PosAuth";
import { SITE_NAME } from "@/lib/format";
import { getDeviceKey, PosError } from "@/lib/pos";

function LoginForm() {
  const { login, user } = usePosAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noDevice, setNoDevice] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => setHasKey(!!getDeviceKey()), []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
    router.replace(safe ?? "/pos");
  }, [user, next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(employeeId.trim(), password);
    } catch (err) {
      setNoDevice(err instanceof PosError && err.code === "device_not_registered");
      setError(err instanceof Error ? err.message : "Login failed.");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-[2rem] bg-cream p-8 shadow-2xl">
        <p className="text-5xl">🔥</p>
        <h1 className="mt-3 font-display text-3xl font-extrabold">{SITE_NAME}</h1>
        <p className="mt-1 text-sm text-ink-soft">Staff sign in · POS &amp; back office</p>
        <div className="mt-6 space-y-3">
          <input className="input" placeholder="Employee ID (e.g. E1001)" autoComplete="username" autoFocus required
                 autoCapitalize="characters" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          <input className="input" type="password" placeholder="Password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="mt-4 rounded-xl bg-flame/10 p-3 text-sm text-flame">{error}</p>}
        {noDevice && (
          <div className="mt-3 rounded-xl bg-mustard/30 p-3 text-xs leading-relaxed">
            <b>Employees can only sign in on store devices.</b> Ask your manager to sign in on this register or tablet
            and choose <b>🖥 This device → Register</b>. After that, everyone at your store can use it.
          </div>
        )}
        <button className="btn-primary mt-6 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="mt-4 text-xs text-ink-soft">
          New staff can sign in once a supervisor has verified their account. Forgot your password? Ask your manager.
        </p>
      </form>
    </div>
  );
}

export default function PosLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
