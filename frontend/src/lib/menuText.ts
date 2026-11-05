import { money } from "./format";
import type { MenuItemDetail, OptionGroup } from "./types";

/** "Size: 6 pieces · 12 pieces +$7.00 · 24 pieces +$18.00" */
export function describeGroup(g: OptionGroup) {
  const opts = g.options
    .map((o) => (parseFloat(o.price_delta) > 0 ? `${o.name} +${money(o.price_delta)}` : o.name))
    .join(" · ");
  const pick = g.max_select > 1 ? ` (choose up to ${g.max_select})` : "";
  return `${g.name}${pick}: ${opts}`;
}

/** True when a required choice adds to the price, so the base price is a "from" price. */
export function isFromPrice(item: MenuItemDetail) {
  return item.option_groups.some((g) => g.required && g.options.some((o) => parseFloat(o.price_delta) > 0));
}

/** Flavour names shared by a category's items (e.g. all wing flavours), for chips. */
export function categoryFlavours(items: MenuItemDetail[]) {
  const names = new Set<string>();
  for (const i of items)
    for (const g of i.option_groups)
      if (/flavou?r/i.test(g.name)) g.options.forEach((o) => names.add(o.name));
  return [...names];
}

/** Choices that every item in a category shares (e.g. burger Extras, shake Toppings) —
 *  shown once under the category heading instead of under every item. */
export function sharedGroups(items: MenuItemDetail[]) {
  const sig = (g: OptionGroup) => `${g.name}|${describeGroup(g)}`;
  if (items.length < 2) return { shared: [] as OptionGroup[], isShared: (_g: OptionGroup) => false };
  const counts = new Map<string, number>();
  items.forEach((i) => new Set(i.option_groups.map(sig)).forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
  const sharedKeys = new Set([...counts].filter(([, n]) => n === items.length).map(([k]) => k));
  const shared = items[0].option_groups.filter((g) => sharedKeys.has(sig(g)));
  return { shared, isShared: (g: OptionGroup) => sharedKeys.has(sig(g)) };
}
