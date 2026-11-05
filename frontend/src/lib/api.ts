import type { Category, MenuItem, MenuItemDetail, Order, Quote } from "./types";

const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

/** On the server we may use an internal URL (e.g. Docker service name). */
function baseUrl() {
  if (typeof window === "undefined") return process.env.INTERNAL_API_URL ?? PUBLIC_API;
  return PUBLIC_API;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
  }
}

function errorMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Something went wrong.";
  const d = data as Record<string, unknown>;
  if (typeof d.detail === "string") return d.detail;
  const first = Object.values(d)[0];
  if (Array.isArray(first)) return String(first[0]);
  if (typeof first === "string") return first;
  return "Something went wrong.";
}

async function request<T>(path: string, init?: RequestInit & { revalidate?: number }): Promise<T> {
  const { revalidate, ...rest } = init ?? {};
  const res = await fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    next: revalidate !== undefined ? { revalidate } : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(errorMessage(data), res.status, data);
  return data as T;
}

// Menu (cached for 60s on the server; admin changes show within a minute)
export const getCategories = () => request<Category[]>("/categories/", { revalidate: 60 });
export const getItems = (params: { category?: string; featured?: boolean; search?: string } = {}) => {
  const q = new URLSearchParams();
  if (params.category) q.set("category", params.category);
  if (params.featured) q.set("featured", "true");
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return request<MenuItem[]>(`/items/${qs ? `?${qs}` : ""}`, { revalidate: 60 });
};
export const getItem = (slug: string) => request<MenuItemDetail>(`/items/${slug}/`, { revalidate: 60 });

// Cart & checkout
type CartPayload = { item_id: number; quantity: number; option_ids: number[] }[];

export const quoteCart = (
  items: CartPayload,
  fulfillment: "pickup" | "delivery" | "dine_in",
  discount_percent = 0,
  extra: { branch?: number | null; channel?: "online" | "pos" | "kiosk"; code?: string; partner?: number } = {},
) =>
  request<Quote>("/cart/quote/", {
    method: "POST",
    body: JSON.stringify({ items, fulfillment, discount_percent, ...extra }),
    cache: "no-store",
  });

export const getBranches = () =>
  request<{ id: number; name: string; address: string }[]>("/branches/", { revalidate: 300 });

export interface CheckoutInput {
  branch?: number | null;
  code?: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  fulfillment: "pickup" | "delivery";
  delivery_address: string;
  notes: string;
  items: CartPayload;
  tip?: string;
}

export const createCheckout = (input: CheckoutInput) =>
  request<{ checkout_url: string; order_id: string }>("/checkout/", {
    method: "POST",
    body: JSON.stringify(input),
    cache: "no-store",
  });

export const getOrderBySession = (sessionId: string) =>
  request<Order>(`/orders/session/${encodeURIComponent(sessionId)}/`, { cache: "no-store" });

// Whole menu with option groups (TV menu board + printable menu card)
export type FullCategory = Category & { items: MenuItemDetail[] };
export const getFullMenu = () => request<FullCategory[]>("/menu/full/", { revalidate: 60 });

// TV screens & live offers (public)
export interface ScreenConfig {
  id: number; name: string; branch: number | null; title: string; subtitle: string; theme: "dark" | "light" | "flame";
  columns: number; categories: string[]; show_qr: boolean; show_flavours: boolean; show_offers: boolean; ticker: string; updated_at: string;
  layout: "list" | "cards" | "featured"; orientation: "landscape" | "portrait"; featured: number[];
}
export interface LiveOffer {
  id: number; name: string; description: string; kind: "percent" | "amount" | "price"; value: string;
  applies_to: string; category: string | null; items: string[]; until: string | null;
}
export const getScreen = (id: string) => request<ScreenConfig>(`/screens/${encodeURIComponent(id)}/`, { cache: "no-store" });
export const getOffersNow = (branch?: number | null, channel = "pos") =>
  request<LiveOffer[]>(`/offers/?channel=${channel}${branch ? `&branch=${branch}` : ""}`, { cache: "no-store" });
