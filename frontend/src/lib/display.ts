/**
 * Customer-facing screen next to the register.
 *
 * The register sends what the screen should show (the order, the tip question, "thank you").
 * Two paths, so it works both on a second monitor of the same computer and on a separate tablet:
 *  - BroadcastChannel: instant between windows of the same browser;
 *  - the server (/api/pos/display/): the screen polls it; it pairs by device key (or same sign-in).
 */
import { PosError, type TipConfig } from "./pos";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
const SCREEN_KEY = "flavorhouse-screen-id";

/** Private ID that pairs this register's browser with its customer screen. Kept across staff log-outs. */
export function getScreenId(): string {
  try {
    let id = localStorage.getItem(SCREEN_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(SCREEN_KEY, id);
    }
    return id;
  } catch {
    return "no-storage-screen";
  }
}
export function setScreenId(id: string) {
  try { localStorage.setItem(SCREEN_KEY, id); } catch { /* ignore */ }
}
export const screenUrl = () =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/customer-screen?screen=${getScreenId()}`;

/** No sign-in on purpose: the screen keeps working when staff log out / in. */
async function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init, cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Screen-Id": getScreenId(), ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    const first = d.detail ?? Object.values(d)[0];
    throw new PosError(Array.isArray(first) ? String(first[0]) : String(first ?? "Something went wrong."), res.status);
  }
  return data as T;
}

export interface ScreenLine { name: string; qty: number; options: string; total: number; promo?: string | null }

export type ScreenState =
  | { mode: "idle" }
  | { mode: "cart"; lines: ScreenLine[]; subtotal: number; savings: number; discount: number; tax: number; total: number }
  | { mode: "tip"; request_id: string; base: string; total: string; lines?: ScreenLine[] }
  | { mode: "tip_done"; request_id: string; base: string; total: string; tip: string }
  | { mode: "thanks"; number: string; total: string; tip: string; change: string };

export interface TipAnswer { request_id?: string; tip?: string; percent?: string | null; choice?: string }
export interface ScreenData { state: ScreenState | Record<string, never>; tip_answer: TipAnswer; tips: TipConfig; updated_at: string }

const CHANNEL = "flavorhouse-customer-screen";
let bc: BroadcastChannel | null = null;
const channel = () => {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  bc ??= new BroadcastChannel(CHANNEL);
  return bc;
};

let pending: ReturnType<typeof setTimeout> | null = null;
let last = "";

/** Register → screen. Cart updates are debounced; other states go out right away. */
export function sendScreen(state: ScreenState, debounce = false) {
  const json = JSON.stringify(state);
  if (json === last) return;
  last = json;
  channel()?.postMessage({ type: "state", state });
  const push = () => apiCall("/pos/display/", { method: "POST", body: JSON.stringify({ state }) }).catch(() => {});
  if (pending) clearTimeout(pending);
  pending = debounce ? setTimeout(push, 400) : null;
  if (!debounce) push();
}

export const newRequestId = () => Math.random().toString(36).slice(2, 10);

/** Register: wait for the customer's tip answer. Returns a stop function. */
export function watchTip(requestId: string, onAnswer: (tip: number, a: TipAnswer) => void) {
  let stopped = false;
  const done = (a: TipAnswer) => {
    if (stopped || a.request_id !== requestId || a.tip === undefined) return;
    stopped = true;
    onAnswer(parseFloat(a.tip), a);
  };
  const ch = channel();
  const onMsg = (e: MessageEvent) => e.data?.type === "tip" && done(e.data.answer);
  ch?.addEventListener("message", onMsg);
  const timer = setInterval(() => {
    apiCall<ScreenData>("/pos/display/").then((d) => done(d.tip_answer)).catch(() => {});
  }, 1500);
  return () => {
    stopped = true;
    clearInterval(timer);
    ch?.removeEventListener("message", onMsg);
  };
}

// ------------------------------------------------------------------ screen side

export const loadScreen = () => apiCall<ScreenData>("/pos/display/");

export async function answerTip(body: { request_id: string; choice: "none" | "percent" | "custom"; percent?: number; amount?: string }) {
  const d = await apiCall<ScreenData>("/pos/display/tip/", { method: "POST", body: JSON.stringify(body) });
  channel()?.postMessage({ type: "tip", answer: d.tip_answer });
  channel()?.postMessage({ type: "state", state: d.state });
  return d;
}

export function onScreenMessage(cb: (state: ScreenState) => void) {
  const ch = channel();
  const h = (e: MessageEvent) => e.data?.type === "state" && cb(e.data.state);
  ch?.addEventListener("message", h);
  return () => ch?.removeEventListener("message", h);
}
