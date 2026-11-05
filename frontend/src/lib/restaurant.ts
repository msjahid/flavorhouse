/** Restaurant details shown on the website footer, printed menu and table cards. Edit freely. */
export const RESTAURANT = {
  tagline: "Wings, burgers, shakes & cakes — made fresh, served hot.",
  hours: [
    ["Mon – Thu", "11am – 10pm"],
    ["Fri – Sun", "11am – 12am"],
  ] as [string, string][],
  phone: "",      // e.g. "(555) 123-4567"
  address: "",    // e.g. "123 Main St, Springfield"
};

/** Public website address for QR codes. Set NEXT_PUBLIC_SITE_URL in production. */
export function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}
