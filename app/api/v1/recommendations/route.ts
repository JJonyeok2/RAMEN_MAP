import type { D1DatabaseLike } from "../../../../db/d1.ts";
import { getD1 } from "../../../../db/d1.ts";
import { createD1ShopRepository } from "../../../../db/repositories/d1-shop-repository.ts";
import { parseRecommendationRequest } from "../../../../features/recommendation/request.ts";
import { recommend } from "../../../../features/recommendation/recommend.ts";
import { createShopService } from "../../../../features/shops/shop-service.ts";
import { JsonBodyError, readBoundedJson } from "../json-body.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;
const bodyLimitBytes = 8_192;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createRecommendationsHandler(loadDatabase: LoadDatabase = getD1) {
  return async function POST(request: Request) {
    let parsed: ReturnType<typeof parseRecommendationRequest>;
    try {
      parsed = parseRecommendationRequest(await readBoundedJson(request, bodyLimitBytes));
    } catch (error) {
      if (error instanceof JsonBodyError) return json({ error: error.message }, error.status);
      return json({ error: "요청 형식을 확인해 주세요." }, 400);
    }

    try {
      const service = createShopService(createD1ShopRepository(await loadDatabase()));
      const branches = await service.listNearby(parsed.origin, 30);
      return json({ result: recommend(branches, parsed) });
    } catch (error) {
      console.error("Failed to create public recommendations", error);
      return json({ error: "추천을 불러오지 못했습니다." }, 503);
    }
  };
}

export const POST = createRecommendationsHandler();
