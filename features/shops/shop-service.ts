import type { Coordinates } from "../../domain/recommendation.ts";
import type { ShopRepository } from "../../domain/shop-repository.ts";

export function createShopService(repository: ShopRepository) {
  return {
    listAreas: () => repository.listAreas(),
    listNearby: (origin: Coordinates, radiusKm: 3 | 10 | 30) => repository.listPublicBranches(origin, radiusKm),
    getDetail: (slug: string) => repository.getPublicShopBySlug(slug),
  };
}
