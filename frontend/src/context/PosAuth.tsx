"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getToken, posApi, setToken, type PosUser } from "@/lib/pos";

const BRANCH_KEY = "flavorhouse-terminal-branch";

interface PosAuthValue {
  user: PosUser | null;
  checking: boolean;
  /** Branch this device works for. Staff tied to a branch always get theirs; supervisors+ pick one. */
  branchId: number | null;
  branchName: string | null;
  setBranchId: (id: number) => void;
  login: (employeeId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<PosAuthValue | null>(null);

function savedBranch(): number | null {
  try {
    const v = localStorage.getItem(BRANCH_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function PosAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PosUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [chosen, setChosen] = useState<number | null>(null);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener("pos-signed-out", out);
    return () => window.removeEventListener("pos-signed-out", out);
  }, []);

  useEffect(() => {
    setChosen(savedBranch());
    if (!getToken()) {
      setChecking(false);
      return;
    }
    posApi
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const login = useCallback(async (employeeId: string, password: string) => {
    const { token, user } = await posApi.login(employeeId, password);
    setToken(token);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await posApi.logout();
    } catch {
      /* token may already be invalid */
    }
    setToken(null);
    setUser(null);
  }, []);

  const setBranchId = useCallback((id: number) => {
    setChosen(id);
    try {
      localStorage.setItem(BRANCH_KEY, String(id));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Fixed branch for employees/managers; otherwise the device's chosen branch (if the person can access it).
  let branchId: number | null = null;
  if (user?.branch && user.level < 3) branchId = user.branch.id;
  else if (user && chosen && user.branches.some((b) => b.id === chosen)) branchId = chosen;
  else if (user?.branches.length === 1) branchId = user.branches[0].id;
  const branchName = user?.branches.find((b) => b.id === branchId)?.name ?? null;

  return (
    <Ctx.Provider value={{ user, checking, branchId, branchName, setBranchId, login, logout }}>{children}</Ctx.Provider>
  );
}

export function usePosAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePosAuth must be used inside <PosAuthProvider>");
  return v;
}
