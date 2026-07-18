import type { D1DatabaseLike } from "../../../../db/d1.ts";
import { getD1 } from "../../../../db/d1.ts";
import { createD1ShopRepository } from "../../../../db/repositories/d1-shop-repository.ts";
import { createShopService } from "../../../../features/shops/shop-service.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createAreasHandler(loadDatabase: LoadDatabase = getD1) {
  return async function GET() {
    try {
      const service = createShopService(createD1ShopRepository(await loadDatabase()));
      return json({ areas: await service.listAreas() });
    } catch (error) {
      console.error("Failed to list public areas", error);
      return json({ error: "지역을 불러오지 못했습니다." }, 503);
    }
  };
}

export const GET = createAreasHandler();
