import type { Area, BranchSummary, ShopDetail } from "./ramen.ts";
import type { Coordinates } from "./recommendation.ts";

export interface ShopRepository {
  listAreas(): Promise<Area[]>;
  listPublicBranches(origin: Coordinates, radiusKm: 3 | 10 | 30): Promise<BranchSummary[]>;
  getPublicShopBySlug(slug: string): Promise<ShopDetail | null>;
}
