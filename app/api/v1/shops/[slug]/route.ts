import type { D1DatabaseLike } from "../../../../../db/d1.ts";
import { getD1 } from "../../../../../db/d1.ts";
import { createD1ShopRepository } from "../../../../../db/repositories/d1-shop-repository.ts";
import { createShopService } from "../../../../../features/shops/shop-service.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;
type RouteContext = { params: Promise<{ slug: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createShopDetailHandler(loadDatabase: LoadDatabase = getD1) {
  return async function GET(_request: Request, context: RouteContext) {
    let slug: string;
    try {
      ({ slug } = await context.params);
    } catch {
      return json({ error: "매장 주소를 확인해 주세요." }, 400);
    }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200 || slug.trim() !== slug) {
      return json({ error: "매장 주소를 확인해 주세요." }, 400);
    }
    try {
      const service = createShopService(createD1ShopRepository(await loadDatabase()));
      const shop = await service.getDetail(slug);
      return shop ? json({ shop }) : json({ error: "매장을 찾지 못했습니다." }, 404);
    } catch (error) {
      console.error("Failed to load public shop detail", error);
      return json({ error: "매장을 불러오지 못했습니다." }, 503);
    }
  };
}

export const GET = createShopDetailHandler();
