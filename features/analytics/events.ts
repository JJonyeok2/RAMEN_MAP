import type { ProductEventRow } from "../../db/schema.ts";

const eventTypes = ["quick_started", "recommendation_shown", "shop_selected", "directions_clicked"] as const;
const radii = [3, 10, 30] as const;
const verificationStatuses = ["verified", "candidate", "stale"] as const;
const canonicalAreaId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProductEventInput {
  sessionId: string;
  eventType: ProductEventRow["event_type"];
  elapsedMs: number | null;
  areaId: string | null;
  radiusKm: ProductEventRow["radius_km"];
  verificationStatus: ProductEventRow["verification_status"];
}

function optional<T>(value: unknown, validate: (candidate: unknown) => candidate is T, message: string): T | null {
  if (value === undefined || value === null) return null;
  if (!validate(value)) throw new Error(message);
  return value;
}

export function parseProductEvent(value: unknown): ProductEventInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("이벤트 요청을 확인해 주세요.");
  const input = value as Record<string, unknown>;
  const allowed = ["sessionId", "eventType", "elapsedMs", "areaId", "radiusKm", "verificationStatus"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("이벤트 항목을 확인해 주세요.");
  if (typeof input.sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.sessionId)) {
    throw new Error("이벤트 세션을 확인해 주세요.");
  }
  if (typeof input.eventType !== "string" || !eventTypes.includes(input.eventType as ProductEventInput["eventType"])) {
    throw new Error("이벤트 종류를 확인해 주세요.");
  }

  return {
    sessionId: input.sessionId,
    eventType: input.eventType as ProductEventInput["eventType"],
    elapsedMs: optional(input.elapsedMs, (candidate): candidate is number => Number.isSafeInteger(candidate) && (candidate as number) >= 0, "이벤트 시간을 확인해 주세요."),
    areaId: optional(input.areaId, (candidate): candidate is string => (
      typeof candidate === "string" && candidate.length <= 64 && canonicalAreaId.test(candidate)
    ), "이벤트 지역을 확인해 주세요."),
    radiusKm: optional(input.radiusKm, (candidate): candidate is 3 | 10 | 30 => typeof candidate === "number" && radii.includes(candidate as 3 | 10 | 30), "이벤트 반경을 확인해 주세요."),
    verificationStatus: optional(input.verificationStatus, (candidate): candidate is "verified" | "candidate" | "stale" => typeof candidate === "string" && verificationStatuses.includes(candidate as "verified" | "candidate" | "stale"), "이벤트 검증 상태를 확인해 주세요."),
  };
}
