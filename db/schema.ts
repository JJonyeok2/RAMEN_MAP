export const candidateStatuses = ["pending", "verified", "hold", "rejected"] as const;

export type CandidateStatus = (typeof candidateStatuses)[number];

export const shopsTable = "shops";
export const branchesTable = "branches";
export const menuItemsTable = "menu_items";
export const menuProfilesTable = "menu_profiles";
export const openingHoursTable = "opening_hours";
export const openingExceptionsTable = "opening_exceptions";
export const sourceEvidenceTable = "source_evidence";
export const verificationEventsTable = "verification_events";
export const areasTable = "areas";
export const productEventsTable = "product_events";

export interface ShopRow {
  id: string;
  name: string;
  normalized_name: string;
  created_at: string;
  updated_at: string;
}

export interface BranchRow {
  id: string;
  shop_id: string;
  slug: string;
  branch_name: string | null;
  region: string;
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  public_status: "active" | "hidden" | "closed" | "moved";
  verification_status: "verified" | "candidate" | "stale" | "rejected";
  hours_text: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MenuItemRow {
  id: string;
  branch_id: string;
  name: string;
  price: number | null;
  availability_status: "available" | "seasonal" | "sold_out" | "unknown";
  verification_status: "verified" | "candidate" | "stale" | "rejected";
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MenuProfileRow {
  menu_item_id: string;
  ramen_types: string;
  broth_style: string | null;
  body_level: number | null;
  spiciness_level: number | null;
  broth_bases: string;
  tags: string;
}

export interface OpeningHoursRow {
  id: string;
  branch_id: string;
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
  last_order_at: string | null;
  is_closed: 0 | 1;
}

export interface OpeningExceptionRow {
  id: string;
  branch_id: string;
  service_date: string;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: 0 | 1;
  note: string;
}

export interface SourceEvidenceRow {
  id: string;
  entity_type: "branch" | "menu";
  entity_id: string;
  field_name: string;
  source_name: string;
  source_url: string;
  checked_at: string;
  note: string;
  collected_by: string;
}

export interface VerificationEventRow {
  id: string;
  entity_type: "branch" | "menu";
  entity_id: string;
  action: string;
  previous_value: string | null;
  next_value: string | null;
  note: string;
  actor: string;
  created_at: string;
}

export interface AreaRow {
  id: string;
  name: string;
  kind: "district" | "neighborhood" | "station";
  lat: number;
  lng: number;
}

export interface ProductEventRow {
  id: string;
  session_hash: string;
  event_type: "quick_started" | "recommendation_shown" | "shop_selected" | "directions_clicked";
  elapsed_ms: number | null;
  area_id: string | null;
  radius_km: 3 | 10 | 30 | null;
  verification_status: "verified" | "candidate" | "stale" | null;
  created_at: string;
}
