import type { OptionGroup } from "./types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
const TOKEN_KEY = "flavorhouse-pos-token";
const DEVICE_KEY = "flavorhouse-device-key";

// ---------------------------------------------------------------- types

export type Role = "employee" | "manager" | "supervisor" | "superadmin" | "admin";

export interface BranchRef {
  id: number;
  name: string;
}

export interface PosUser {
  id: number;
  username: string;
  employee_id: string;
  name: string;
  role: Role;
  role_display: string;
  level: number; // 1 employee … 5 admin
  discount_limit: number;
  can_refund: boolean;
  branch: BranchRef | null;
  branches: BranchRef[];
  is_superuser: boolean;
  photo_url?: string | null;
  job_title?: string;
}

export interface PosItem {
  id: number;
  name: string;
  slug: string;
  price: string;
  image: string | null;
  emoji: string;
  is_available: boolean;
  option_groups: OptionGroup[];
}

export interface PosCategory {
  id: number;
  name: string;
  slug: string;
  emoji: string;
  items: PosItem[];
}

export type OrderStatus =
  | "pending" | "unpaid" | "paid" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled" | "refunded";

export interface PosOrder {
  id: number;
  public_id: string;
  number: string;
  short_number: string;
  status: OrderStatus;
  status_display: string;
  source: "online" | "pos" | "kiosk" | "partner";
  fulfillment: "pickup" | "delivery" | "dine_in";
  fulfillment_display: string;
  payment_method: "stripe" | "cash" | "card" | "split" | "partner" | "";
  tip: string;
  partner: { id: number; name: string; emoji: string; color: string } | null;
  partner_ref: string;
  partner_commission: string;
  partner_collects_tax: boolean;
  partner_payout: string;
  payment_method_display: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  notes: string;
  subtotal: string;
  delivery_fee: string;
  tax: string;
  total: string;
  cash_received: string | null;
  change_given: string | null;
  promo_discount: string;
  promotions: { name: string; amount: string }[];
  payments: OrderPaymentRow[];
  items: {
    id: number;
    name: string;
    options: { group: string; name: string; price_delta: string }[];
    unit_price: string;
    regular_price: string | null;
    promotion: string;
    quantity: number;
    line_total: string;
  }[];
  created_by_name: string | null;
  branch: number | null;
  branch_name: string | null;
  discount_percent: string;
  discount_amount: string;
  discount_reason: string;
  discount_approved_by_name: string | null;
  refunded_by_name: string | null;
  refund_reason: string;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  ready_at: string | null;
}

export interface PaymentPart { method: "cash" | "card"; amount: string; tendered?: string; card_last4?: string }
export interface PayInput { payment_method?: "cash" | "card"; cash_received?: string; payments?: PaymentPart[]; tip?: string }
export interface Partner { id: number; name: string; emoji: string; color: string; markup_percent: string; commission_percent: string }
export interface TipConfig { enabled: boolean; percents: number[]; allow_custom: boolean }
export interface OrderPaymentRow { id: number; method: "cash" | "card"; method_display: string; amount: string; tendered: string | null; change: string; card_last4: string }
export interface OrdersSummary {
  orders: number; sales: string; tax: string; discounts: string; refunds: { count: number; total: string }; net: string; tips: string;
  by_app: { name: string; orders: number; sales: string }[];
  by_method: { key: string; label: string; taken: string; refunded: string; net: string }[]; unpaid: number; cancelled: number; split_orders: number;
}

export interface DayStatus {
  branch: number;
  date: string;
  started: boolean;
  opening_float: string | null;
  opened_by: string | null;
  opened_at: string | null;
  suggested_float: string;
  denominations: string[];
}

export interface ClockStatus {
  clocked_in: boolean;
  since: string | null;
  branch: string | null;
  today_hours: string;
  week_hours?: string;
  hourly_rate?: string | null;
  pay_type?: string;
}

export interface BoardEntry {
  id: number;
  number: string;
  name: string;
}

export interface Breakdown {
  key: string;
  label: string;
  count: number;
  total: string;
}

export interface DailyReport {
  date: string;
  orders: number;
  gross: string;
  net: string;
  tax: string;
  delivery_fees: string;
  average_order: string;
  refunds: { count: number; total: string };
  by_payment: Breakdown[];
  by_source: Breakdown[];
  by_fulfillment: Breakdown[];
  top_items: { name: string; qty: number; total: string }[];
  by_hour: { hour: number; count: number; total: string }[];
}

// ---------------------------------------------------------------- token

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

/** Secret key of this registered store device (employees can only use registered devices). */
export const getDeviceKey = () => {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};
export const setDeviceKey = (k: string | null) => {
  try {
    if (k) localStorage.setItem(DEVICE_KEY, k);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage unavailable */
  }
};

export class PosError extends Error {
  constructor(message: string, public status: number, public code?: string, public data?: unknown) {
    super(message);
  }
}

export async function apiCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...(getDeviceKey() ? { "X-Device-Key": getDeviceKey()! } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) {
    // Sign-in expired, was signed out remotely, or this device was removed.
    setToken(null);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pos-signed-out", { detail: data }));
  }
  if (!res.ok) {
    let msg = "Something went wrong.";
    let code: string | undefined;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      code = typeof d.code === "string" ? d.code : undefined;
      const key = d.detail !== undefined ? "detail" : Object.keys(d)[0];
      const first = d[key];
      const text = Array.isArray(first) ? String(first[0]) : String(first ?? msg);
      msg = key && key !== "detail" && key !== "non_field_errors" ? `${key.replace(/_/g, " ")}: ${text}` : text;
    }
    throw new PosError(msg, res.status, code, data);
  }
  return data as T;
}

const call = <T,>(path: string, init: RequestInit = {}) => apiCall<T>(`/pos${path}`, init);
const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// ---------------------------------------------------------------- endpoints

export const posApi = {
  login: (employee_id: string, password: string) =>
    post<{ token: string; user: PosUser }>("/login/", { employee_id, password, device_key: getDeviceKey() }),
  day: (branch?: number | null) => call<DayStatus>(`/day/${branch ? `?branch=${branch}` : ""}`),
  startDay: (branch_id: number | null, denominations: Record<string, number>, note = "") =>
    post<DayStatus>("/day/", { branch_id, denominations, note }),
  device: () => call<{ registered: boolean; id: number | null; name: string | null; branch: number | null; branch_name: string | null }>("/device/"),
  registerDevice: (name: string, branch_id: number | null) =>
    post<{ key: string; id: number; name: string; branch: number; branch_name: string }>("/device/", { name, branch_id }),
  authorize: (body: { action: "discount" | "refund"; percent?: number; employee_id: string; password: string; branch_id?: number | null }) =>
    post<{ approval: string; approver: string; limit: number }>("/authorize/", body),
  clock: (tips?: string, branch_id?: number | null) =>
    post<ClockStatus>("/clock/", { ...(tips ? { tips } : {}), ...(branch_id ? { branch_id } : {}) }),
  clockStatus: () => call<ClockStatus>("/clock/"),
  logout: () => post<void>("/logout/"),
  me: () => call<PosUser>("/me/"),
  menu: () => call<{ categories: PosCategory[]; tax_rate: string; partners: Partner[]; tips: TipConfig }>("/menu/"),
  setAvailability: (itemId: number, is_available: boolean) =>
    post<{ id: number; is_available: boolean }>(`/items/${itemId}/availability/`, { is_available }),
  orders: (params: Record<string, string> = {}) =>
    call<PosOrder[]>(`/orders/?${new URLSearchParams(params).toString()}`),
  createOrder: (body: {
    items: { item_id: number; quantity: number; option_ids: number[] }[];
    fulfillment: "dine_in" | "pickup" | "delivery";
    customer_name: string;
    customer_phone: string;
    customer_email?: string;
    notes: string;
    partner?: number;
    partner_ref?: string;
    tip?: string;
    payment_method?: "cash" | "card";
    cash_received?: string;
    payments?: PaymentPart[];
    branch_id?: number | null;
    discount_percent?: number;
    discount_reason?: string;
    approval?: string;
  }) => post<PosOrder>("/orders/", body),
  setStatus: (id: number, status: string) => post<PosOrder>(`/orders/${id}/status/`, { status }),
  refund: (id: number, reason: string, approval?: string) =>
    post<{ order: PosOrder; message: string }>(`/orders/${id}/refund/`, { reason, ...(approval ? { approval } : {}) }),
  pay: (id: number, p: PayInput) => post<PosOrder>(`/orders/${id}/pay/`, p),
  ordersSummary: (params: Record<string, string>) => call<OrdersSummary>(`/orders/summary/?${new URLSearchParams(params).toString()}`),
  kioskOrder: (body: {
    items: { item_id: number; quantity: number; option_ids: number[] }[];
    fulfillment: "dine_in" | "pickup";
    customer_name: string;
    branch_id?: number | null;
  }) => post<PosOrder>("/kiosk/orders/", body),
  board: (branch?: string | null) => call<{ preparing: BoardEntry[]; ready: BoardEntry[] }>(`/board/${branch ? `?branch=${branch}` : ""}`),
  dailyReport: (date?: string, branch?: number | null) =>
    call<DailyReport>(`/reports/daily/?${new URLSearchParams({ ...(date ? { date } : {}), ...(branch ? { branch: String(branch) } : {}) })}`),
};

// ---------------------------------------------------------------- helpers

export const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "bg-ink/10 text-ink-soft",
  unpaid: "bg-sky-100 text-sky-800",
  paid: "bg-mustard/40 text-ink",
  preparing: "bg-flame/15 text-flame-dark",
  ready: "bg-leaf/15 text-leaf",
  out_for_delivery: "bg-sky-100 text-sky-800",
  completed: "bg-ink/10 text-ink",
  cancelled: "bg-ink/10 text-ink-soft line-through",
  refunded: "bg-purple-100 text-purple-800",
};

export function minutesAgo(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function localDateISO(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export const SOURCE_LABEL: Record<PosOrder["source"], string> = {
  online: "🌐 Website",
  pos: "🧾 Counter",
  kiosk: "🧍 Kiosk",
  partner: "🛵 Delivery app",
};

/** "🟢 Uber Eats #A1B2" for app orders, otherwise the channel label. */
export const sourceLabel = (o: Pick<PosOrder, "source" | "partner" | "partner_ref">) =>
  o.partner ? `${o.partner.emoji} ${o.partner.name}${o.partner_ref ? ` #${o.partner_ref}` : ""}` : SOURCE_LABEL[o.source];
