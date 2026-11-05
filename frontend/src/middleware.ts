import { NextResponse, type NextRequest } from "next/server";

/**
 * Subdomains (optional, once you have your own domain):
 *   manage.yourrestaurant.com  → back office (/manage)
 *   pos.yourrestaurant.com     → POS (/pos)
 * Point both subdomains at the same frontend service; everything else keeps working at /manage and /pos.
 */
const SUBDOMAINS: Record<string, string> = { manage: "/manage", pos: "/pos" };
const SHARED = ["/pos/login", "/pos", "/manage", "/me", "/messages", "/kiosk", "/customer-screen", "/order-board", "/menu-board", "/menu-card", "/table-cards"];

export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const sub = host.split(".")[0];
  const base = SUBDOMAINS[sub];
  const { pathname } = req.nextUrl;
  if (!base || host.split(".").length < 3) return NextResponse.next();
  if (SHARED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? base : `${base}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
