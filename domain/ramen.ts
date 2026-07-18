export const ramenTypes = ["shoyu", "shio", "miso", "tonkotsu", "tsukemen", "mazesoba"] as const;
export const brothStyles = ["chintan", "paitan", "dry", "dipping"] as const;
export const brothBases = ["닭", "돼지", "소", "해산물", "채소"] as const;
export const verificationStatuses = ["verified", "candidate", "stale", "rejected"] as const;
export const publicStatuses = ["active", "hidden", "closed", "moved"] as const;
export const recommendationModes = ["taste", "balanced", "distance"] as const;
export const searchRadiiKm = [3, 10, 30] as const;
export const maxPublicMenusPerBranch = 50;
export const maxPublicAreas = 200;

export type RamenType = (typeof ramenTypes)[number];
export type BrothStyle = (typeof brothStyles)[number];
export type BrothBase = (typeof brothBases)[number];
export type VerificationStatus = (typeof verificationStatuses)[number];
export type PublicStatus = (typeof publicStatuses)[number];
export type RecommendationMode = (typeof recommendationModes)[number];

export interface MenuItem {
  id: string;
  name: string;
  price: number | null;
  ramenTypes: RamenType[];
  brothStyle: BrothStyle | null;
  bodyLevel: 1 | 2 | 3 | 4 | 5 | null;
  spicinessLevel: 0 | 1 | 2 | 3 | 4 | 5 | null;
  brothBases: BrothBase[];
  tags: string[];
  availabilityStatus: "available" | "seasonal" | "sold_out" | "unknown";
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
}

export interface BranchSummary {
  id: string;
  slug: string;
  shopName: string;
  branchName: string | null;
  region: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  publicStatus: PublicStatus;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
  openingStatus: "open" | "closed" | "unknown";
  menus: MenuItem[];
}

export interface PublicEvidence {
  id: string;
  sourceName: string;
  sourceUrl: string;
  checkedAt: string;
  note: string;
}

export interface ShopDetail extends BranchSummary {
  evidence: PublicEvidence[];
  hoursText: string | null;
}

export interface Area {
  id: string;
  name: string;
  kind: "district" | "neighborhood" | "station";
  lat: number;
  lng: number;
}

export type PublicVerificationStatus = Exclude<VerificationStatus, "rejected">;
export type PublicMenuItem = Omit<MenuItem, "verificationStatus"> & {
  verificationStatus: PublicVerificationStatus;
};
export type PublicShopMenuItem = PublicMenuItem & { evidence: PublicEvidence[] };
export type PublicBranchSummary = Omit<BranchSummary, "publicStatus" | "verificationStatus" | "menus"> & {
  publicStatus: "active";
  verificationStatus: PublicVerificationStatus;
  menus: PublicMenuItem[];
};
export type PublicShopDetail = Omit<ShopDetail, "publicStatus" | "verificationStatus" | "menus"> & {
  publicStatus: "active";
  verificationStatus: PublicVerificationStatus;
  menus: PublicShopMenuItem[];
};

type PublicBranchCheck = {
  publicStatus: PublicStatus;
  verificationStatus: VerificationStatus;
  lat: number | null;
  lng: number | null;
};

export function isPublicBranch(value: BranchSummary): value is PublicBranchSummary;
export function isPublicBranch(value: PublicBranchCheck): boolean;
export function isPublicBranch(value: PublicBranchCheck): boolean {
  if (value.publicStatus !== "active" || value.verificationStatus === "rejected" || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) {
    return false;
  }
  if (!("menus" in value)) return true;
  return Array.isArray(value.menus) && value.menus.every(
    (menu) => typeof menu === "object" && menu !== null && "verificationStatus" in menu && menu.verificationStatus !== "rejected",
  );
}

export function effectiveVerificationStatus(status: VerificationStatus, checkedAt: string | null, entity: "branch" | "menu", now = new Date()): VerificationStatus {
  if (status !== "verified" || !checkedAt) return status;
  const ageDays = (now.getTime() - new Date(checkedAt).getTime()) / 86_400_000;
  return ageDays > (entity === "branch" ? 90 : 180) ? "stale" : "verified";
}
