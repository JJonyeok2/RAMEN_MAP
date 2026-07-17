import type { D1DatabaseLike } from "../../../db/d1.ts";
import { getD1 } from "../../../db/d1.ts";
import { createD1ShopRepository } from "../../../db/repositories/d1-shop-repository.ts";
import { createShopService } from "../../../features/shops/shop-service.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createCompatibilityShopsHandler(loadDatabase: LoadDatabase = getD1) {
  return async function GET() {
    try {
      const service = createShopService(createD1ShopRepository(await loadDatabase()));
      const areas = await service.listAreas();
      const nearbyGroups = await Promise.all(areas.map((area) => service.listNearby(area, 30)));
      const byId = new Map(nearbyGroups.flat().map((shop) => [shop.id, shop]));
      const shops = [...byId.values()].sort((left, right) => {
        const order = { verified: 0, candidate: 1, stale: 2 } as const;
        return order[left.verificationStatus] - order[right.verificationStatus]
          || left.shopName.localeCompare(right.shopName, "ko");
      });
      return json({ shops });
    } catch (error) {
      console.error("Failed to list compatibility shops", error);
      return json({ error: "매장을 불러오지 못했습니다." }, 503);
    }
  };
}

export const GET = createCompatibilityShopsHandler();
