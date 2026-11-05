import { apiCall, getToken, type DailyReport, type Role } from "./pos";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

// ---------------------------------------------------------------- types

export interface Branch {
  id: number; name: string; code: string; address: string; phone: string; state: string;
  min_wage: string; tipped_min_wage: string; opening_float: string; is_active: boolean;
}

export interface Staff {
  id: number; employee_id: string; first_name: string; last_name: string; email: string; name: string;
  preferred_name: string; photo_url: string | null; stores: { id: number; name: string }[];
  city: string; state: string; zip_code: string; message?: string;
  role: Role; role_display: string; branch: number | null; branch_name: string | null;
  status: "pending" | "active" | "rejected" | "inactive"; status_display: string;
  phone: string; address: string; date_of_birth: string | null; emergency_contact: string; emergency_phone: string;
  job_title: string; employment_type: "full_time" | "part_time"; hire_date: string; i9_verified: boolean; w4_on_file: boolean;
  pay_type: "hourly" | "tipped" | "salary"; pay_type_display: string; hourly_rate: string; weekly_salary: string;
  pay_method: "cash" | "check" | "direct_deposit"; pay_method_display: string; notes: string;
  created_by_name: string | null; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string;
  created_at: string;
}

export interface PurchaseLine { id?: number; name: string; quantity: string; unit: string; unit_cost: string; line_total?: string }

export interface Purchase {
  id: number; branch: number; branch_name: string; category: string; vendor_ref?: number | null;
  submitted_by: number | null; submitted_by_level: number; category_display: string; vendor: string;
  invoice_number: string; purchase_date: string; paid_with: string; paid_with_display: string; reason: string;
  receipt_url: string | null; subtotal: string; tax: string; total: string; lines: PurchaseLine[];
  status: "pending" | "approved" | "rejected"; status_display: string; submitted_by_name: string | null;
  reviewed_by_name: string | null; reviewed_at: string | null; review_note: string; created_at: string;
  needs_role: string | null;
}

export interface CashDrop {
  id: number; branch: number; branch_name: string; kind: string; kind_display: string; amount: string;
  note: string; witnessed_by: string; made_by_name: string | null; created_at: string;
}

export interface CloseNumbers {
  opening_float: string; cash_sales: string; cash_refunds: string; paid_outs: string; paid_ins: string;
  safe_drops: string; expected_cash: string; card_sales: string; online_sales: string; total_sales: string; app_sales?: string; tips?: string;
  unpaid_kiosk_orders: number;
}

export interface DailyClose extends Omit<CloseNumbers, "unpaid_kiosk_orders"> {
  id: number; branch: number; branch_name: string; date: string; counted_cash: string; over_short: string; closed_by: number | null; closed_by_level: number; edited_by_name: string | null;
  cash_to_deposit: string; denominations: Record<string, number>; notes: string; closed_by_name: string | null;
}

export interface Deposit {
  id: number; branch: number; branch_name: string; date: string; amount: string; bank_name: string;
  account_last4: string; slip_number: string; slip_url: string | null; covers_from: string | null;
  covers_to: string | null; note: string; deposited_by_name: string | null; verified_by_name: string | null;
  verified_at: string | null;
}

export interface Notification { id: number; title: string; body: string; link: string; is_read: boolean; created_at: string }

export interface PayrollRow {
  staff_id: number; employee_id: string; name: string; role: string; branch: string; pay_type: string;
  pay_method: string; rate: string; weekly_salary: string; shifts: number; hours: string; regular_hours: string;
  overtime_hours: string; regular_pay: string; overtime_pay: string; tips: string; gross_pay: string;
}

export interface TimeEntry {
  id: number; staff: number; staff_name: string; employee_id: string; staff_level: number; branch: number; branch_name: string;
  clock_in: string; clock_out: string | null; hours: string; tips: string; note: string; edited_by_name: string | null;
}

export interface Breakdown { key: string; label: string; count: number; total: string }

export interface SalesSummary extends DailyReport {
  from: string; to: string; discounts: string; discounted_orders: number;
  by_day: { date: string; count: number; total: string }[];
}

export interface Summary {
  sales: SalesSummary;
  purchases: { approved_total: string; cogs: string; expenses: string; pending: { count: number; total: string }; by_category: Breakdown[] };
  labor: string;
  cash: { closes: number; over_short: string; to_deposit: string };
  branches?: { id: number; name: string; orders: number; gross: string; net: string; average_order: string; discounts: string }[];
}

export interface PnlBlock {
  name: string; orders: number; gross_sales: string; discounts: string; refunds: string; net_sales: string;
  tax_collected: string; cogs: string; expenses: string; labor: string; gross_profit: string; net_profit: string; app_fees: string; tips: string; bills: string; app_sales: string;
  profit_margin: string; food_cost_pct: string; labor_cost_pct: string; prime_cost_pct: string;
  cash_to_deposit: string; deposited: string; deposits_unverified: number; over_short: string;
  by_category: Breakdown[]; by_day: { date: string; count: number; total: string }[];
}

export interface ChangeRequest {
  id: number; kind: string; label: string; action: string; target_id: number | null; branch: number | null;
  branch_name: string | null; summary: string; payload: Record<string, unknown>; before: Record<string, unknown>;
  file_url: string | null; reason: string; need_level: number; need_role: string; status: "pending" | "approved" | "rejected";
  submitted_by_name: string | null; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string;
  result_id: number | null; created_at: string;
}

export interface Bill {
  id: number; branch: number | null; branch_name: string | null; category: string; category_display: string; provider: string;
  account_number: string; bill_month: string; period_start: string | null; period_end: string | null; due_date: string | null;
  amount: string; tax: string; total: string; usage: string; is_paid: boolean; paid_on: string | null; paid_with: string;
  paid_with_display: string; reference: string; note: string; file_url: string | null; submitted_by_name: string | null; submitted_level: number;
  approved_by_name: string | null; created_at: string; updated_at: string;
}
export interface BillsData {
  year: number; items: Bill[]; waiting: ChangeRequest[]; months: { month: number; total: string; tax: string; count: number }[];
  categories: { key: string; label: string; total: string; tax: string; count: number; by_month: Record<string, string> }[];
  total: string; tax: string; this_month: string; unpaid: { count: number; total: string };
  category_choices: { value: string; label: string }[]; paid_with_choices: { value: string; label: string }[];
  can_edit: boolean; my_level: number;
}
export interface AppDay {
  id: number; partner: number; partner_name: string; color: string; emoji: string; branch: number; branch_name: string; date: string;
  orders: number; sales: string; tax: string; with_tax: string; fees: string; adjustments: string; tax_by_app: boolean; expected: string;
  note: string; submitted_by_name: string | null; approved_by_name: string | null; submitted_level: number;
}
export interface AppPayoutRow {
  id: number; partner: number; partner_name: string; color: string; emoji: string; branch: number; branch_name: string; received_on: string;
  amount: string; covers_from: string | null; covers_to: string | null; reference: string; note: string;
  submitted_by_name: string | null; approved_by_name: string | null; submitted_level: number;
}
export interface LedgerNumbers {
  days: number; orders: number; sales: string; tax: string; with_tax: string; app_tax: string; fees: string; adjustments: string;
  expected: string; received: string; balance: string;
}
export interface AppLedger {
  from: string; to: string; total: LedgerNumbers;
  apps: (LedgerNumbers & { id: number; name: string; emoji: string; color: string; is_active: boolean })[];
  daily: { date: string; sales: string; tax: string; with_tax: string; orders: number; apps: AppDay[] }[];
  payouts: AppPayoutRow[]; waiting: ChangeRequest[]; my_level: number;
}
export interface StaffSalesPerson {
  id: number | "web"; name: string; employee_id: string; role: string; role_display: string; orders: number; sales: string; tax: string;
  average: string; discounts: number; discount_amount: string; offers_amount: string; tips: string; refunds: number; refund_amount: string;
  refunds_approved?: number; refunds_approved_amount?: string; discounts_approved?: number; discounts_approved_amount?: string;
}
export interface StaffSales {
  from: string; to: string;
  total: { orders: number; sales: string; tax: string; discounts: number; discount_amount: string; offers_amount: string; refunds: number; refund_amount: string };
  by_employee: StaffSalesPerson[];
  by_role: { role: string; label: string; people: number; orders: number; sales: string; discounts: number; discount_amount: string;
             refunds: number; refund_amount: string; discount_rate: string }[];
  rows: { id: number; number: string; created_at: string; branch_name: string; seller: string; employee_id: string; role_display: string;
          source: string; source_display: string; payment_display: string; customer: string; subtotal: string; discount_percent: string;
          discount_amount: string; discount_reason: string; discount_approved_by: string | null; offers: string; tax: string; total: string;
          tip: string; status: string; status_display: string; refunded_by: string | null; refund_reason: string }[];
  rows_capped: boolean; sellers: { value: string; label: string }[];
}

export interface HistoryEntry {
  id: number; action: string; model: string; object_id: number | null; branch: number | null; branch_name: string | null;
  summary: string; changes: Record<string, [unknown, unknown]>; actor_name: string | null; approved_by_name: string | null; created_at: string;
}

export interface Vendor {
  id: number; name: string; contact_name: string; phone: string; email: string; website: string; address: string;
  city: string; state: string; zip_code: string; account_number: string; payment_terms: string; payment_terms_display: string;
  w9_on_file: boolean; categories: string; notes: string; is_active: boolean;
  purchases?: number; spent_total?: string; spent_month?: string; spent_year?: string; last_purchase?: string | null;
}

export interface OptionRow { id?: number; name: string; price_delta: string; is_available?: boolean }
export interface OptionGroupRow { id?: number; name: string; required: boolean; min_select: number; max_select: number; options: OptionRow[] }

export interface MenuItemRow {
  option_groups: OptionGroupRow[];
  id: number; name: string; category: number; category_name: string; price: string; description: string; emoji: string;
  image: string | null; is_available: boolean; is_featured: boolean; is_spicy: boolean; is_vegetarian: boolean;
  calories: number | null; sort_order: number;
}
export interface MenuSection { id: number; name: string; slug: string; description: string; emoji: string; sort_order: number; is_active: boolean; items: MenuItemRow[] }

export interface Offer {
  id: number; name: string; description: string; kind: "percent" | "amount" | "price"; kind_display: string; value: string;
  applies_to: "all" | "category" | "items"; category: number | null; category_name: string | null; items: number[]; item_names: string[];
  days: number[]; start_time: string | null; end_time: string | null; start_date: string | null; end_date: string | null;
  branches: number[]; branch_names: string[]; channels: string[]; code: string; is_active: boolean;
}

export interface Screen {
  id: number; name: string; branch: number | null; branch_name: string | null; title: string; subtitle: string;
  theme: "dark" | "light" | "flame"; columns: number; categories: string[]; show_qr: boolean; show_flavours: boolean;
  show_offers: boolean; ticker: string; is_active: boolean; updated_at: string;
  layout: "list" | "cards" | "featured"; orientation: "landscape" | "portrait"; featured: number[];
}

export interface PayStatementRow {
  id: number; staff: number; staff_name: string; employee_id: string; period_start: string; period_end: string;
  regular_hours: string; overtime_hours: string; rate: string; regular_pay: string; overtime_pay: string; tips: string;
  gross_pay: string; paid_on: string | null; pay_method: string; pay_method_display: string; reference: string; note: string;
  status: string; created_by_name: string | null; reviewed_by_name: string | null; reviewed_at: string | null;
}

export interface CustomerRow {
  id: number; name: string; email: string; phone: string; notes: string; orders: number; spent: string;
  first_order: string | null; last_order: string | null; edited_by_name: string | null; updated_at: string;
}
export interface CustomerDetail extends CustomerRow {
  items: { name: string; quantity: number; spent: string; last: string }[];
  order_list: import("./pos").PosOrder[]; can_edit: boolean;
}

export interface SalaryWeek {
  from: string; to: string; running: boolean; hours: string; regular_hours: string; overtime_hours: string; tips: string;
  gross_pay: string; status: "running" | "paid" | "partial" | "unpaid"; paid_on: string | null; pay_method: string; reference: string;
  paid_amount: string; balance: string; payments: { method: string; method_display: string; amount: string; reference: string }[];
  statement_id: number | null; pending: { id: number; paid: boolean; need_role: string } | null;
}
export interface PaySettingsRow { frequency: "weekly" | "biweekly"; frequency_display: string; anchor: string; days: number; current: { from: string; to: string } }

export interface SalaryRow {
  staff_id: number; employee_id: string; name: string; role: string; level: number; branch: string; pay_type: string;
  pay_method: string; pay_method_key: string; can_mark: boolean; weeks: SalaryWeek[]; unpaid_count: number; unpaid_total: string;
}

export interface OwnerRow { id: number; name: string; user: number | null; share_percent: string; is_active: boolean; notes: string }
export interface OwnerDrawRow {
  id: number; owner: number; owner_name: string; branch: number | null; branch_name: string | null; date: string; amount: string;
  method: string; method_display: string; reference: string; note: string; created_by_name: string | null; created_at: string;
}
export interface OwnerSplit {
  year: number; owners: OwnerRow[]; share_total: string;
  months: { month: string; running: boolean; net_sales: string; cogs: string; expenses: string; labor: string; net_profit: string;
    taken_total: string; owners: { owner: number; share: string; taken: string; balance: string }[] }[];
  totals: { owner: number; share: string; taken: string; balance: string }[];
}

export interface TaxNumbers {
  orders: number; with_tax: string; tax: string; without_tax: string; fees: string; discounts: string; refunds: number;
  refund_with_tax: string; refund_tax: string; net_without_tax: string; net_tax: string; net_with_tax: string;
  tax_collected: string; app_with_tax: string; app_tax: string;
}
export interface TaxFilingRow {
  id: number; branch: number | null; period_start: string; period_end: string; status: "open" | "filed" | "paid"; status_display: string;
  tax_due: string; amount_paid: string; filed_on: string | null; paid_on: string | null; confirmation: string; note: string;
  updated_by_name: string | null; updated_at: string;
}
export interface TaxRow extends TaxNumbers { from: string; to: string; label: string; filing: TaxFilingRow | null }
export interface TaxPaidRow { name: string; count: number; spent: string; tax: string }
export interface TaxReport {
  channel: string; by_channel: (TaxNumbers & { key: string; label: string })[];
  paid: { vendors: TaxPaidRow[]; utilities: TaxPaidRow[]; vendor_spent: string; vendor_tax: string; utility_spent: string; utility_tax: string; total_tax: string };
  from: string; to: string; group: string; tax_rate: string; rows: TaxRow[]; total: TaxNumbers;
  by_store: (TaxNumbers & { id: number | null; name: string; state: string })[]; can_edit_status: boolean;
}

export interface DeliveryApp {
  id: number; name: string; emoji: string; color: string; commission_percent: string; markup_percent: string; collects_tax: boolean;
  payout_schedule: string; account_id: string; notes: string; is_active: boolean; sort_order: number;
  updated_by_name: string | null; updated_at: string;
}
export interface AppNumbers { orders: number; sales: string; food: string; tax: string; app_tax: string; fees: string; payout: string; average: string }
export interface AppsReport {
  from: string; to: string; total: AppNumbers;
  apps: (AppNumbers & { id: number; name: string; emoji: string; color: string; is_active: boolean; commission_percent: string; refunds: number; refunded: string })[];
  stores: (AppNumbers & { name: string })[];
  by_day: Record<string, Record<string, { total: string; orders: number }>>;
}
export interface TipSettingsData { enabled: boolean; percents: number[]; allow_custom: boolean; can_edit: boolean; updated_by_name: string | null; updated_at: string }

export interface Device {
  id: number; branch: number; branch_name: string; name: string; registered_by_name: string | null; created_at: string;
  last_seen: string | null; last_user_name: string | null; is_active: boolean;
}

export interface Mail {
  id: number; subject: string; body: string; sender_name: string; to: string[];
  attachments: { id: number; name: string; size: number; url: string }[]; read: boolean; reply_to: number | null; created_at: string;
}

export interface MyProfile {
  employee_id: string; first_name: string; last_name: string; preferred_name: string; email: string; phone: string;
  address: string; city: string; state: string; zip_code: string; date_of_birth: string | null; emergency_contact: string;
  emergency_phone: string; photo_url: string | null; role_display: string; branch_name: string | null; job_title: string;
  hire_date: string; pay_type: string; hourly_rate: string; weekly_salary: string; pay_method_display: string;
}

// ---------------------------------------------------------------- api

const m = <T,>(path: string, init: RequestInit = {}) => apiCall<T>(`/manage${path}`, init);
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
const qs = (p: Record<string, string | number | null | undefined>) => {
  const u = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") u.set(k, String(v)); });
  const s = u.toString();
  return s ? `?${s}` : "";
};

export type Period = { period?: string; from?: string; to?: string };

export const manageApi = {
  branches: () => m<Branch[]>("/branches/"),
  saveBranch: (b: Partial<Branch>) => (b.id ? m<Branch>(`/branches/${b.id}/`, json("PATCH", b)) : m<Branch>("/branches/", json("POST", b))),

  staff: (p: { branch?: number | null; status?: string } = {}) => m<Staff[]>(`/staff/${qs(p)}`),
  createStaff: (s: Record<string, unknown>) => m<Staff>("/staff/", json("POST", s)),
  updateStaff: (id: number, s: Record<string, unknown>) => m<Staff>(`/staff/${id}/`, json("PATCH", s)),
  signOutStaff: (id: number) => m<{ ok: boolean }>(`/staff/${id}/signout/`, json("POST")),
  jobTitles: () => m<{ id: number; name: string }[]>("/job-titles/"),
  addJobTitle: (name: string) => m<{ id: number; name: string }>("/job-titles/", json("POST", { name })),
  reviewStaff: (id: number, decision: "approve" | "reject", note = "") => m<Staff>(`/staff/${id}/${decision}/`, json("POST", { note })),
  setStaffActive: (id: number, active: boolean) => m<Staff>(`/staff/${id}/active/`, json("POST", { active })),

  time: (p: Period & { branch?: number | null; staff?: number }) => m<TimeEntry[]>(`/time/${qs(p)}`),
  addTime: (t: Record<string, unknown>) => m<ChangeRequest>("/time/", json("POST", t)),
  updateTime: (id: number, t: Record<string, unknown>) => m<ChangeRequest>(`/time/${id}/`, json("PATCH", t)),
  deleteTime: (id: number, reason: string) => m<ChangeRequest>(`/time/${id}/`, json("DELETE", { reason })),
  payroll: (p: { from: string; to: string; branch?: number | null }) =>
    m<{ from: string; to: string; rows: PayrollRow[]; total_gross: string; total_hours: string }>(`/payroll/${qs(p)}`),
  payrollCsvUrl: (p: { from: string; to: string; branch?: number | null }) => `${API}/manage/payroll/${qs({ ...p, export: "csv" })}`,

  purchases: (p: Period & { branch?: number | null; status?: string; category?: string; vendor?: string }) => m<Purchase[]>(`/purchases/${qs(p)}`),
  createPurchase: (form: FormData) => m<Purchase>("/purchases/", { method: "POST", body: form }),
  editPurchase: (id: number, form: FormData) => m<ChangeRequest>(`/purchases/${id}/`, { method: "PATCH", body: form }),
  reviewPurchase: (id: number, decision: "approve" | "reject", note = "") => m<Purchase>(`/purchases/${id}/${decision}/`, json("POST", { note })),

  approvals: () => m<{ purchases: Purchase[]; staff: Staff[]; changes: ChangeRequest[]; count: number }>("/approvals/"),
  changes: (p: { status?: string; mine?: string; kind?: string } = {}) => m<ChangeRequest[]>(`/changes/${qs(p)}`),
  reviewChange: (id: number, decision: "approve" | "reject", note = "") => m<ChangeRequest>(`/changes/${id}/${decision}/`, json("POST", { note })),
  history: (p: Period & { model?: string; object_id?: number; branch?: number | null; q?: string } = {}) => m<HistoryEntry[]>(`/history/${qs(p)}`),
  vendors: (all = false) => m<Vendor[]>(`/vendors/${all ? "?all=1" : ""}`),
  saveVendor: (v: Partial<Vendor>) => (v.id ? m<ChangeRequest>(`/vendors/${v.id}/`, json("PATCH", v)) : m<ChangeRequest>("/vendors/", json("POST", v))),
  menu: () => m<MenuSection[]>("/menu/"),
  saveItem: (id: number | null, form: FormData) => m<ChangeRequest>(id ? `/menu/items/${id}/` : "/menu/items/", { method: id ? "PATCH" : "POST", body: form }),
  saveSection: (s: Partial<MenuSection>) => (s.id ? m<ChangeRequest>(`/menu/categories/${s.id}/`, json("PATCH", s)) : m<ChangeRequest>("/menu/categories/", json("POST", s))),
  offers: () => m<Offer[]>("/offers/"),
  saveOffer: (o: Partial<Offer>) => (o.id ? m<ChangeRequest>(`/offers/${o.id}/`, json("PATCH", o)) : m<ChangeRequest>("/offers/", json("POST", o))),
  screens: () => m<Screen[]>("/screens/"),
  saveScreen: (x: Partial<Screen>) => (x.id ? m<ChangeRequest>(`/screens/${x.id}/`, json("PATCH", x)) : m<ChangeRequest>("/screens/", json("POST", x))),
  payStatements: (p: { staff?: number; status?: string } = {}) => m<PayStatementRow[]>(`/pay/${qs(p)}`),
  recordPay: (b: { from: string; to: string; paid_on?: string }) => m<PayStatementRow[]>("/pay/", json("POST", b)),
  reviewPay: (id: number, decision: "approve" | "reject") => m<PayStatementRow>(`/pay/${id}/${decision}/`, json("POST")),
  editPay: (id: number, b: Record<string, unknown>) => m<ChangeRequest>(`/pay/${id}/`, json("PATCH", b)),
  devices: () => m<Device[]>("/devices/"),
  setDevice: (id: number, is_active: boolean) => m<Device>(`/devices/${id}/`, json("PATCH", { is_active })),
  me: () => m<MyProfile>("/me/"),
  saveMe: (form: FormData) => m<MyProfile>("/me/", { method: "PATCH", body: form }),
  changePassword: (old_password: string, new_password: string) => m<{ ok: boolean }>("/me/password/", json("POST", { old_password, new_password })),
  myEarnings: () => m<{ this_week: PayrollRow & { from: string; to: string }; weeks: SalaryWeek[]; statements: PayStatementRow[]; shifts: TimeEntry[] }>("/me/earnings/"),
  customers: (p: { q?: string; letter?: string; sort?: string; branch?: number | null } = {}) =>
    m<{ count: number; can_edit: boolean; items: CustomerRow[] }>(`/customers/${qs(p)}`),
  customersCsvUrl: (p: { q?: string; letter?: string; sort?: string; branch?: number | null } = {}) => `${API}/manage/customers/${qs({ ...p, export: "csv" })}`,
  customer: (id: number, branch?: number | null) => m<CustomerDetail>(`/customers/${id}/${qs({ branch })}`),
  saveCustomer: (id: number, b: Partial<CustomerRow>) => m<CustomerDetail>(`/customers/${id}/`, json("PATCH", b)),
  salary: (p: { weeks?: number; branch?: number | null; staff?: number } = {}) =>
    m<{ weeks: number; frequency: string; frequency_display: string; rows: SalaryRow[]; unpaid_total: string }>(`/salary/${qs(p)}`),
  paySettings: () => m<PaySettingsRow>("/salary/settings/"),
  savePaySettings: (b: { frequency: string; anchor?: string }) => m<PaySettingsRow>("/salary/settings/", json("POST", b)),
  markSalary: (b: { staff: number; from: string; paid: boolean; paid_on?: string; pay_method?: string; reference?: string; change_reason?: string;
    payments?: { method: string; amount: string; reference?: string }[] }) =>
    m<ChangeRequest>("/salary/mark/", json("POST", b)),
  tax: (p: { from: string; to: string; group: string; branch?: number | null; channel?: string }) => m<TaxReport>(`/reports/tax/${qs(p)}`),
  saveTaxFiling: (b: Record<string, unknown>) => m<TaxFilingRow>("/tax/filings/", json("POST", b)),
  deliveryApps: () => m<{ apps: DeliveryApp[]; can_edit: boolean }>("/delivery-apps/"),
  addDeliveryApp: (b: Partial<DeliveryApp>) => m<DeliveryApp>("/delivery-apps/", json("POST", b)),
  editDeliveryApp: (id: number, b: Partial<DeliveryApp>) => m<DeliveryApp>(`/delivery-apps/${id}/`, json("PATCH", b)),
  deleteDeliveryApp: (id: number) => m<void>(`/delivery-apps/${id}/`, json("DELETE")),
  appsReport: (p: Record<string, string | number | null | undefined>) => m<AppsReport>(`/reports/delivery-apps/${qs(p)}`),
  bills: (p: Record<string, string | number | null | undefined>) => m<BillsData>(`/bills/${qs(p)}`),
  addBill: (form: FormData) => m<ChangeRequest>("/bills/", { method: "POST", body: form }),
  editBill: (id: number, form: FormData) => m<ChangeRequest>(`/bills/${id}/`, { method: "PATCH", body: form }),
  appLedger: (p: Record<string, string | number | null | undefined>) => m<AppLedger>(`/delivery-apps/ledger/${qs(p)}`),
  addAppDay: (b: Record<string, unknown>) => m<ChangeRequest>("/delivery-apps/days/", json("POST", b)),
  editAppDay: (id: number, b: Record<string, unknown>) => m<ChangeRequest>(`/delivery-apps/days/${id}/`, json("PATCH", b)),
  addAppPayout: (b: Record<string, unknown>) => m<ChangeRequest>("/delivery-apps/payouts/", json("POST", b)),
  editAppPayout: (id: number, b: Record<string, unknown>) => m<ChangeRequest>(`/delivery-apps/payouts/${id}/`, json("PATCH", b)),
  staffSales: (p: Record<string, string | number | null | undefined>) => m<StaffSales>(`/reports/staff-sales/${qs(p)}`),
  tipSettings: () => m<TipSettingsData>("/tips/"),
  saveTipSettings: (b: { enabled?: boolean; percents?: number[]; allow_custom?: boolean }) => m<TipSettingsData>("/tips/", json("PUT", b)),
  owners: () => m<OwnerRow[]>("/owners/"),
  saveOwner: (o: Partial<OwnerRow>) => m<OwnerRow[]>("/owners/", json("POST", o)),
  ownerDraws: (p: { from?: string; to?: string; owner?: number } = {}) => m<OwnerDrawRow[]>(`/owners/draws/${qs(p)}`),
  addOwnerDraw: (b: Record<string, unknown>) => m<OwnerDrawRow>("/owners/draws/", json("POST", b)),
  deleteOwnerDraw: (id: number) => m<void>(`/owners/draws/${id}/`, json("DELETE")),
  ownerSplit: (year: number) => m<OwnerSplit>(`/owners/split/?year=${year}`),
  mail: (box: "inbox" | "sent" | "archived" | "team") => m<{ unread: number; items: Mail[] }>(`/messages/?box=${box}`),
  mailContacts: () => m<{ people: { id: number; name: string; role: string; branch: string }[]; groups: { id: string; name: string }[]; can_view_team: boolean }>("/messages/contacts/"),
  openMail: (id: number) => m<Mail>(`/messages/${id}/`),
  markMail: (id: number, b: { archived?: boolean; unread?: boolean }) => m<Mail>(`/messages/${id}/`, json("POST", b)),
  sendMail: (form: FormData) => m<Mail>("/messages/", { method: "POST", body: form }),

  drops: (p: Period & { branch?: number | null }) => m<CashDrop[]>(`/cash/drops/${qs(p)}`),
  addDrop: (d: Record<string, unknown>) => m<CashDrop>("/cash/drops/", json("POST", d)),
  closePreview: (branch: number, date: string) =>
    m<{ numbers: CloseNumbers; saved: DailyClose | null; denominations: string[]; next_float: string }>(`/cash/close/${qs({ branch, date })}`),
  saveClose: (b: { branch: number; date: string; denominations: Record<string, number>; notes: string }) => m<DailyClose>("/cash/close/", json("POST", b)),
  editClose: (id: number, b: { denominations?: Record<string, number>; notes?: string; reason: string }) => m<ChangeRequest>(`/cash/closes/${id}/`, json("PATCH", b)),
  editDeposit: (id: number, b: Record<string, unknown>) => m<ChangeRequest>(`/cash/deposits/${id}/`, json("PATCH", b)),
  closes: (p: Period & { branch?: number | null }) => m<DailyClose[]>(`/cash/closes/${qs(p)}`),
  deposits: (p: Period & { branch?: number | null }) => m<Deposit[]>(`/cash/deposits/${qs(p)}`),
  safeCash: (branch: number) => m<{ items: Deposit[]; in_safe: string | null }>(`/cash/deposits/${qs({ period: "today", branch, with_safe: 1 })}`),
  addDeposit: (form: FormData) => m<Deposit>("/cash/deposits/", { method: "POST", body: form }),
  verifyDeposit: (id: number) => m<Deposit>(`/cash/deposits/${id}/verify/`, json("POST")),

  notifications: () => m<{ unread: number; items: Notification[] }>("/notifications/"),
  markNotification: (id: number, read: boolean) => m<Notification>(`/notifications/${id}/`, json("POST", { read })),
  readAll: () => m<{ ok: boolean }>("/notifications/read-all/", json("POST")),

  summary: (p: Period & { branch?: number | null }) => m<Summary>(`/reports/summary/${qs(p)}`),
  pnl: (p: Period) => m<{ from: string; to: string; total: PnlBlock; branches: PnlBlock[] }>(`/reports/pnl/${qs(p)}`),
};

/** Download a file that needs the sign-in token (e.g. payroll CSV). */
export async function downloadWithToken(url: string, filename: string) {
  const res = await fetch(url, { headers: { Authorization: `Token ${getToken()}` } });
  if (!res.ok) throw new Error("Download failed.");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const ROLE_LEVEL: Record<Role, number> = { employee: 1, manager: 2, supervisor: 3, superadmin: 4, admin: 5 };
export const ROLE_LABEL: Record<Role, string> = {
  employee: "Employee", manager: "Manager", supervisor: "Supervisor", superadmin: "Super admin", admin: "Admin",
};

/** Mirrors the server rule: which roles this person may add. */
export function creatableRoles(level: number): Role[] {
  const all: Role[] = ["employee", "manager", "supervisor", "superadmin", "admin"];
  if (level >= 5) return all;
  if (level === 2) return ["employee"];
  return all.filter((r) => ROLE_LEVEL[r] < level);
}

export const PURCHASE_CATEGORIES: [string, string][] = [
  ["meat", "Meat & poultry"], ["produce", "Produce"], ["dairy", "Dairy & eggs"], ["bakery", "Bakery & dry goods"],
  ["beverages", "Beverages"], ["sauces", "Sauces & spices"], ["frozen", "Frozen"], ["packaging", "Packaging & disposables"],
  ["cleaning", "Cleaning supplies"], ["equipment", "Equipment & smallwares"], ["repairs", "Repairs & maintenance"],
  ["utilities", "Utilities"], ["rent", "Rent"], ["marketing", "Marketing"], ["other", "Other"],
];

export const PAID_WITH: [string, string][] = [
  ["company_card", "Company card"], ["register_cash", "Cash from register"], ["check", "Check"],
  ["bank_transfer", "Bank transfer / ACH"], ["on_account", "On account (pay later)"], ["personal", "Personal money (reimburse)"],
];

/** Can this person edit an entry made by someone of `ownerLevel`? (Never your own; only a higher role; admin anything.) */
export const canEditEntry = (myLevel: number, ownerLevel: number, isMine: boolean) => myLevel >= 5 || (!isMine && myLevel > ownerLevel);

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const changeMessage = (c: ChangeRequest) =>
  c.status === "approved" ? "Saved ✓" : `Sent for ${c.need_role} approval — it changes once approved.`;
