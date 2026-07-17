import type { D1DatabaseLike } from "../../../../db/d1.ts";
import { getD1 } from "../../../../db/d1.ts";
import { hashSessionId, parseProductEvent } from "../../../../features/analytics/events.ts";

export const dynamic = "force-dynamic";

type LoadDatabase = () => Promise<D1DatabaseLike>;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createEventsHandler(loadDatabase: LoadDatabase = getD1) {
  return async function POST(request: Request) {
    let event: ReturnType<typeof parseProductEvent>;
    try {
      event = parseProductEvent(await request.json());
    } catch {
      return json({ error: "이벤트 요청 형식을 확인해 주세요." }, 400);
    }

    try {
      const db = await loadDatabase();
      await db.prepare(`
        INSERT INTO product_events (
          id, session_hash, event_type, elapsed_ms, area_id, radius_km, verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        await hashSessionId(event.sessionId),
        event.eventType,
        event.elapsedMs,
        event.areaId,
        event.radiusKm,
        event.verificationStatus,
      ).run();
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Failed to record product event", error);
      return json({ error: "이벤트를 기록하지 못했습니다." }, 503);
    }
  };
}

export const POST = createEventsHandler();
