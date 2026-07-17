import type { ProductEventInput } from "./events.ts";

type EventType = ProductEventInput["eventType"];
type VerificationStatus = NonNullable<ProductEventInput["verificationStatus"]>;

export interface ProductEventDetails {
  elapsedMs?: number;
  areaId?: string;
  radiusKm?: 3 | 10 | 30;
  verificationStatus?: VerificationStatus;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CryptoLike {
  randomUUID(): string;
}

interface ProductEventDependencies {
  storage: StorageLike | undefined;
  crypto: CryptoLike | undefined;
  fetch: (url: string, init: RequestInit) => Promise<unknown>;
}

const sessionKey = "ramen-map-session-id";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createProductEventEmitter(dependencies: ProductEventDependencies) {
  return (eventType: EventType, details: ProductEventDetails = {}): void => {
    try {
      if (!dependencies.storage || !dependencies.crypto) return;
      let sessionId = dependencies.storage.getItem(sessionKey);
      if (!sessionId || !uuidPattern.test(sessionId)) {
        sessionId = dependencies.crypto.randomUUID();
        if (!uuidPattern.test(sessionId)) return;
        dependencies.storage.setItem(sessionKey, sessionId);
      }

      const payload = {
        sessionId,
        eventType,
        ...(details.elapsedMs !== undefined ? { elapsedMs: details.elapsedMs } : {}),
        ...(details.areaId !== undefined ? { areaId: details.areaId } : {}),
        ...(details.radiusKm !== undefined ? { radiusKm: details.radiusKm } : {}),
        ...(details.verificationStatus !== undefined
          ? { verificationStatus: details.verificationStatus }
          : {}),
      };
      void dependencies.fetch("/api/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Analytics must never interrupt a consumer action.
    }
  };
}
