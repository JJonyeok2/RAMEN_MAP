import type { D1DatabaseLike } from "../d1.ts";
import type { ProductEventInput } from "../../features/analytics/events.ts";

export async function hashSessionId(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function changedRows(result: unknown): number | null {
  if (typeof result !== "object" || result === null || !("meta" in result)) return null;
  const meta = result.meta;
  if (typeof meta !== "object" || meta === null || !("changes" in meta)) return null;
  return typeof meta.changes === "number" && Number.isSafeInteger(meta.changes) && meta.changes >= 0
    ? meta.changes
    : null;
}

export function createD1AnalyticsRepository(db: D1DatabaseLike) {
  return {
    async record(event: ProductEventInput): Promise<boolean> {
      const values = [
        crypto.randomUUID(),
        await hashSessionId(event.sessionId),
        event.eventType,
        event.elapsedMs,
        event.areaId,
        event.radiusKm,
        event.verificationStatus,
      ];

      if (event.areaId === null) {
        await db.prepare(`
          INSERT INTO product_events (
            id, session_hash, event_type, elapsed_ms, area_id, radius_km, verification_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(...values).run();
        return true;
      }

      const result = await db.prepare(`
        WITH event_values (
          id, session_hash, event_type, elapsed_ms, area_id, radius_km, verification_status
        ) AS (VALUES (?, ?, ?, ?, ?, ?, ?))
        INSERT INTO product_events (
          id, session_hash, event_type, elapsed_ms, area_id, radius_km, verification_status
        )
        SELECT
          event_values.id, event_values.session_hash, event_values.event_type,
          event_values.elapsed_ms, event_values.area_id, event_values.radius_km,
          event_values.verification_status
        FROM event_values
        JOIN areas ON event_values.area_id = 'area:' || areas.id
      `).bind(...values).run();
      const changes = changedRows(result);
      if (changes === null) throw new Error("D1 did not report inserted row changes.");
      return changes > 0;
    },
  };
}
