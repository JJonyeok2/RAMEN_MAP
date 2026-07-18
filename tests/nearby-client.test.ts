import assert from "node:assert/strict";
import test from "node:test";

import { createProductEventEmitter } from "../features/analytics/client-events.ts";
import {
  locationFallbackMessage,
  requestRadiusSearchOrigin,
} from "../features/location/radius-search.ts";
import { RequestCoordinator } from "../features/location/request-coordinator.ts";
import {
  parseAreasResponse,
  parsePublicError,
  parseRecommendationResponse,
} from "../features/recommendation/client-response.ts";
import { LocationRequestError, type GeolocationLike } from "../app/geolocation.ts";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

function validMenu(overrides: Record<string, unknown> = {}) {
  return {
    id: "menu:one:signature",
    name: "시오 청탕",
    price: 11_000,
    ramenTypes: ["shio"],
    brothStyle: "chintan",
    bodyLevel: 2,
    spicinessLevel: 0,
    brothBases: ["닭"],
    tags: ["깔끔한"],
    availabilityStatus: "available",
    verificationStatus: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function validItem(
  verificationStatus: "verified" | "candidate" | "stale" = "verified",
  overrides: Record<string, unknown> = {},
) {
  const menuStatus = verificationStatus === "verified" ? "verified" : verificationStatus;
  return {
    branch: {
      id: `branch:${verificationStatus}`,
      slug: `${verificationStatus}-shop`,
      shopName: `${verificationStatus} 라멘`,
      branchName: null,
      region: "경기",
      district: "안양",
      address: "경기 안양시 테스트로 1",
      lat: 37.39,
      lng: 126.96,
      phone: null,
      publicStatus: "active",
      verificationStatus,
      lastVerifiedAt: "2026-07-01T00:00:00.000Z",
      openingStatus: "open",
      menus: [validMenu({ id: `menu:${verificationStatus}:signature`, verificationStatus: menuStatus })],
    },
    menuId: `menu:${verificationStatus}:signature`,
    score: 86,
    distanceKm: 1.2,
    reasons: ["취향과 맞아요", "1.2km 거리 · 현재 영업 중"],
    ...overrides,
  };
}

function validRecommendationPayload() {
  return {
    result: {
      radiusKm: 3,
      verified: [validItem("verified")],
      candidates: [validItem("candidate"), validItem("stale")],
      expanded: false,
    },
  };
}

test("new request tokens abort and invalidate every earlier request", () => {
  const coordinator = new RequestCoordinator();
  const first = coordinator.begin();
  const second = coordinator.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.isCurrent(first.token), false);
  assert.equal(coordinator.isCurrent(second.token), true);

  coordinator.dispose();
  assert.equal(second.signal.aborted, true);
  assert.equal(coordinator.isCurrent(second.token), false);
});

test("parses bounded public areas and rejects unsafe or invalid coordinates", () => {
  assert.deepEqual(parseAreasResponse({
    areas: [{ id: "anyang", name: "안양", kind: "district", lat: 37.39, lng: 126.96 }],
  }), [{ id: "anyang", name: "안양", kind: "district", lat: 37.39, lng: 126.96 }]);

  for (const area of [
    { id: "area:private", name: "안양", kind: "district", lat: 37.39, lng: 126.96 },
    { id: "anyang", name: "안양", kind: "city", lat: 37.39, lng: 126.96 },
    { id: "anyang", name: "안양", kind: "district", lat: 100, lng: 126.96 },
  ]) {
    assert.throws(() => parseAreasResponse({ areas: [area] }), /지역 응답/);
  }
});

test("preserves verified and candidate/stale groups in parsed recommendations", () => {
  const result = parseRecommendationResponse(validRecommendationPayload());
  assert.deepEqual(result.verified.map((item) => item.branch.verificationStatus), ["verified"]);
  assert.deepEqual(result.candidates.map((item) => item.branch.verificationStatus), ["candidate", "stale"]);
  assert.equal(result.verified[0]?.branch.menus[0]?.name, "시오 청탕");
});

test("rejects recommendation payloads whose candidates exceed remaining capacity", () => {
  assert.throws(() => parseRecommendationResponse({
    result: {
      radiusKm: 3,
      verified: [validItem("verified"), validItem("verified", {
        branch: { ...validItem("verified").branch, id: "branch:verified-two", slug: "verified-two" },
      })],
      candidates: [validItem("candidate"), validItem("stale")],
      expanded: false,
    },
  }), /추천 응답/);
});

test("accepts a valid empty result and rejects malformed recommendation fields", () => {
  assert.deepEqual(parseRecommendationResponse({
    result: { radiusKm: 30, verified: [], candidates: [], expanded: true },
  }), { radiusKm: 30, verified: [], candidates: [], expanded: true });

  const invalidPayloads = [
    { result: { ...validRecommendationPayload().result, radiusKm: 5 } },
    { result: { ...validRecommendationPayload().result, expanded: true } },
    { result: { ...validRecommendationPayload().result, verified: [validItem("candidate")] } },
    { result: { ...validRecommendationPayload().result, candidates: [validItem("verified")] } },
    { result: { ...validRecommendationPayload().result, verified: [validItem("verified", { score: 101 })] } },
    { result: { ...validRecommendationPayload().result, verified: [validItem("verified", { distanceKm: -1 })] } },
    { result: { ...validRecommendationPayload().result, verified: [validItem("verified", { menuId: "missing" })] } },
    {
      result: {
        ...validRecommendationPayload().result,
        verified: [validItem("verified", {
          branch: { ...validItem("verified").branch, openingStatus: "maybe" },
        })],
      },
    },
    {
      result: {
        ...validRecommendationPayload().result,
        verified: [validItem("verified", {
          branch: { ...validItem("verified").branch, lastVerifiedAt: "not-a-date" },
        })],
      },
    },
    {
      result: {
        ...validRecommendationPayload().result,
        verified: [validItem("verified", {
          branch: { ...validItem("verified").branch, lastVerifiedAt: "2026-02-30T00:00:00.000Z" },
        })],
      },
    },
  ];
  for (const payload of invalidPayloads) {
    assert.throws(() => parseRecommendationResponse(payload), /추천 응답/);
  }
});

test("uses only a bounded public API error message and otherwise keeps the fallback", () => {
  assert.equal(parsePublicError({ error: "잠시 뒤 다시 시도해 주세요." }, "fallback"), "잠시 뒤 다시 시도해 주세요.");
  assert.equal(parsePublicError({ error: "x".repeat(301) }, "fallback"), "fallback");
  assert.equal(parsePublicError({ error: 42 }, "fallback"), "fallback");
});

test("replaces an invalid stored analytics UUID and emits only approved fields", () => {
  const values = new Map([["ramen-map-session-id", "not-a-uuid"]]);
  const bodies: Array<Record<string, unknown>> = [];
  const emit = createProductEventEmitter({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    },
    crypto: { randomUUID: () => sessionId },
    fetch: (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });

  emit("recommendation_shown", {
    elapsedMs: 123,
    areaId: "anyang",
    radiusKm: 3,
    verificationStatus: "verified",
    lat: 37.39,
    lng: 126.96,
    text: "raw preference",
  } as never);

  assert.equal(values.get("ramen-map-session-id"), sessionId);
  assert.deepEqual(bodies[0], {
    sessionId,
    eventType: "recommendation_shown",
    elapsedMs: 123,
    areaId: "anyang",
    radiusKm: 3,
    verificationStatus: "verified",
  });
});

test("analytics storage, crypto, and fetch failures never throw or continue", async () => {
  let fetchCalls = 0;
  const throwingStorage = createProductEventEmitter({
    storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => {} },
    crypto: { randomUUID: () => sessionId },
    fetch: () => { fetchCalls += 1; return Promise.resolve(new Response()); },
  });
  assert.doesNotThrow(() => throwingStorage("quick_started"));

  const throwingCrypto = createProductEventEmitter({
    storage: { getItem: () => null, setItem: () => {} },
    crypto: { randomUUID: () => { throw new Error("blocked"); } },
    fetch: () => { fetchCalls += 1; return Promise.resolve(new Response()); },
  });
  assert.doesNotThrow(() => throwingCrypto("quick_started"));

  const throwingFetch = createProductEventEmitter({
    storage: { getItem: () => sessionId, setItem: () => {} },
    crypto: { randomUUID: () => sessionId },
    fetch: () => { throw new Error("offline"); },
  });
  assert.doesNotThrow(() => throwingFetch("quick_started"));

  const rejectingFetch = createProductEventEmitter({
    storage: { getItem: () => sessionId, setItem: () => {} },
    crypto: { randomUUID: () => sessionId },
    fetch: () => Promise.reject(new Error("offline")),
  });
  assert.doesNotThrow(() => rejectingFetch("quick_started"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls, 0);
});

test("nearby geolocation keeps privacy-conscious request options and maps fallback copy", async () => {
  let options: PositionOptions | undefined;
  const geolocation: GeolocationLike = {
    getCurrentPosition(success, _error, received) {
      options = received;
      success({ coords: { latitude: 37.39, longitude: 126.96 } });
    },
  };
  assert.deepEqual(await requestRadiusSearchOrigin(geolocation), { lat: 37.39, lng: 126.96 });
  assert.deepEqual(options, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  assert.match(locationFallbackMessage(new LocationRequestError("permission-denied")), /위치 권한/);
  assert.match(locationFallbackMessage(new LocationRequestError("timeout")), /시간이 초과/);
});
