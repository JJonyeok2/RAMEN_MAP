import assert from "node:assert/strict";
import test from "node:test";
import { hashSessionId, parseProductEvent } from "../features/analytics/events.ts";

const validEvent = {
  sessionId: "b8a3f064-9462-4a3b-a7f4-c5f9e0e00a11",
  eventType: "directions_clicked",
  elapsedMs: 42_000,
  areaId: "anyang",
  radiusKm: 3,
  verificationStatus: "verified",
};

test("accepts decision timing without accepting coordinates or free text", () => {
  const event = parseProductEvent(validEvent);
  assert.equal(event.elapsedMs, 42_000);
  assert.equal("lat" in event, false);
  assert.throws(() => parseProductEvent({ ...validEvent, eventType: "custom", lat: 37.3 }), /이벤트/);
  assert.throws(() => parseProductEvent({ ...validEvent, text: "청탕" }), /이벤트/);
});

test("accepts only the approved coarse optional dimensions", () => {
  const event = parseProductEvent({
    sessionId: validEvent.sessionId,
    eventType: "quick_started",
  });
  assert.deepEqual(event, {
    sessionId: validEvent.sessionId,
    eventType: "quick_started",
    elapsedMs: null,
    areaId: null,
    radiusKm: null,
    verificationStatus: null,
  });
  assert.throws(() => parseProductEvent({ ...validEvent, elapsedMs: -1 }), /시간/);
  assert.throws(() => parseProductEvent({ ...validEvent, elapsedMs: 1.5 }), /시간/);
  assert.throws(() => parseProductEvent({ ...validEvent, radiusKm: 5 }), /반경/);
  assert.throws(() => parseProductEvent({ ...validEvent, verificationStatus: "rejected" }), /검증/);
});

test("requires a UUID session and hashes it deterministically with SHA-256", async () => {
  assert.throws(() => parseProductEvent({ ...validEvent, sessionId: "session-1" }), /세션/);
  const hash = await hashSessionId(validEvent.sessionId);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, await hashSessionId(validEvent.sessionId));
  assert.notEqual(hash, validEvent.sessionId);
});
