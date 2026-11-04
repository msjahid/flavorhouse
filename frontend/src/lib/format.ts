const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const money = (v: number | string) => fmt.format(typeof v === "string" ? parseFloat(v) : v);

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Flavor House";
