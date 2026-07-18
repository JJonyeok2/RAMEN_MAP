import type { D1DatabaseLike } from "../../../../db/d1.ts";
import { getD1 } from "../../../../db/d1.ts";
import { createD1AnalyticsRepository } from "../../../../db/repositories/d1-analytics-repository.ts";
import { parseProductEvent } from "../../../../features/analytics/events.ts";
import { JsonBodyError, readBoundedJson } from "../json-body.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;
const bodyLimitBytes = 2_048;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createEventsHandler(loadDatabase: LoadDatabase = getD1) {
  return async function POST(request: Request) {
    let event: ReturnType<typeof parseProductEvent>;
    try {
      event = parseProductEvent(await readBoundedJson(request, bodyLimitBytes));
    } catch (error) {
      if (error instanceof JsonBodyError) return json({ error: error.message }, error.status);
      return json({ error: "이벤트 요청 형식을 확인해 주세요." }, 400);
    }

    try {
      const repository = createD1AnalyticsRepository(await loadDatabase());
      if (!await repository.record(event)) {
        return json({ error: "이벤트 지역을 확인해 주세요." }, 400);
      }
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Failed to record product event", error);
      return json({ error: "이벤트를 기록하지 못했습니다." }, 503);
    }
  };
}

export const POST = createEventsHandler();
