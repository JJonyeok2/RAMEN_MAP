import type { Area, PublicBranchSummary, PublicShopDetail } from "./ramen.ts";
import type { Coordinates } from "./recommendation.ts";

export interface ShopRepository {
  listAreas(): Promise<Area[]>;
  listPublicBranches(origin: Coordinates, radiusKm: 3 | 10 | 30): Promise<PublicBranchSummary[]>;
  getPublicShopBySlug(slug: string): Promise<PublicShopDetail | null>;
}
