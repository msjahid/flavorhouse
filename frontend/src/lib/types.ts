export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  emoji: string;
  item_count: number;
}

export interface Option {
  id: number;
  name: string;
  price_delta: string;
}

export interface OptionGroup {
  id: number;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  options: Option[];
}

export interface MenuItem {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: string;
  image: string | null;
  emoji: string;
  category: string;
  is_featured: boolean;
  is_spicy: boolean;
  is_vegetarian: boolean;
  calories: number | null;
  has_options: boolean;
}

export interface MenuItemDetail extends MenuItem {
  option_groups: OptionGroup[];
}

export interface CartLine {
  key: string;
  itemId: number;
  slug: string;
  name: string;
  image: string | null;
  emoji: string;
  unitPrice: number; // display estimate; server recalculates on checkout
  quantity: number;
  optionIds: number[];
  optionLabels: string[];
}

export interface Quote {
  subtotal: string;
  discount_amount?: string;
  promo_savings?: string;
  promotions?: { name: string; amount: string }[];
  lines?: { unit_price: string; regular_price: string | null; promotion: string | null; line_total: string }[];
  delivery_fee: string;
  tax: string;
  total: string;
}

export interface OrderItem {
  name: string;
  options: { group: string; name: string; price_delta: string }[];
  unit_price: string;
  quantity: number;
  line_total: string;
}

export interface Order {
  public_id: string;
  number: string;
  status: string;
  status_display: string;
  fulfillment: "pickup" | "delivery";
  customer_name: string;
  customer_email: string;
  delivery_address: string;
  subtotal: string;
  delivery_fee: string;
  tax: string;
  total: string;
  items: OrderItem[];
  created_at: string;
  paid_at: string | null;
}
