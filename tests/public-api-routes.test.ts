import assert from "node:assert/strict";
import test from "node:test";
import type { D1DatabaseLike, D1Statement } from "../db/d1.ts";
import { createAreasHandler } from "../app/api/v1/areas/route.ts";
import { createEventsHandler } from "../app/api/v1/events/route.ts";
import { createRecommendationsHandler } from "../app/api/v1/recommendations/route.ts";
import { createShopDetailHandler } from "../app/api/v1/shops/[slug]/route.ts";
import { createCompatibilityShopsHandler } from "../app/api/shops/route.ts";

function database(onPrepare: (sql: string) => D1Statement): D1DatabaseLike {
  return { prepare: onPrepare };
}

function assertJson(response: Response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
}

test("recommendations rejects malformed JSON without touching D1", async () => {
  let databaseReads = 0;
  const handler = createRecommendationsHandler(async () => {
    databaseReads += 1;
    throw new Error("must not load DB");
  });
  const response = await handler(new Request("http://local/api/v1/recommendations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  }));
  assert.equal(response.status, 400);
  assert.equal(databaseReads, 0);
  assertJson(response);
  assert.deepEqual(await response.json(), { error: "요청 형식을 확인해 주세요." });
});

test("POST routes require JSON media types and reject oversized bodies before D1", async () => {
  let databaseReads = 0;
  const loadDatabase = async () => {
    databaseReads += 1;
    throw new Error("must not load DB");
  };
  const unsupported = await createEventsHandler(loadDatabase)(new Request("http://local/api/v1/events", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }));
  assert.equal(unsupported.status, 415);
  assertJson(unsupported);
  assert.deepEqual(await unsupported.json(), { error: "JSON 요청만 지원합니다." });

  const oversized = await createRecommendationsHandler(loadDatabase)(new Request("http://local/api/v1/recommendations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(20_000) }),
  }));
  assert.equal(oversized.status, 413);
  assertJson(oversized);
  assert.deepEqual(await oversized.json(), { error: "요청 본문이 너무 큽니다." });
  assert.equal(databaseReads, 0);
});

test("recommendations keeps verified and candidate result groups separate", async () => {
  const rows = [
    { branch_id: "verified", slug: "one", shop_name: "하나", branch_name: null, region: "경기", district: "안양", address: "주소1", lat: 37.39, lng: 126.96, phone: null, public_status: "active", verification_status: "verified", hours_text: null, last_verified_at: null, opening_hours_json: "[]", menu_id: "m1", menu_name: "시오", price: 10000, availability_status: "available", menu_verification_status: "verified", menu_last_verified_at: null, ramen_types: '["shio"]', broth_style: "chintan", body_level: 2, spiciness_level: 0, broth_bases: '["닭"]', tags: "[]" },
    { branch_id: "candidate", slug: "two", shop_name: "둘", branch_name: null, region: "경기", district: "안양", address: "주소2", lat: 37.391, lng: 126.961, phone: null, public_status: "active", verification_status: "candidate", hours_text: null, last_verified_at: null, opening_hours_json: "[]", menu_id: "m2", menu_name: "쇼유", price: 10000, availability_status: "available", menu_verification_status: "candidate", menu_last_verified_at: null, ramen_types: '["shoyu"]', broth_style: "chintan", body_level: 2, spiciness_level: 0, broth_bases: '["닭"]', tags: "[]" },
  ];
  const db = database(() => ({
    bind() { return this; },
    async all<T>() { return { results: rows as T[] }; },
    async first<T>() { return null as T | null; },
    async run() {},
  }));
  const handler = createRecommendationsHandler(async () => db);
  const response = await handler(new Request("http://local/api/v1/recommendations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: { lat: 37.39, lng: 126.96 }, mode: "balanced", quick: true, selections: {}, text: "" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assertJson(response);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.result.verified.map((item: { branch: { id: string } }) => item.branch.id), ["verified"]);
  assert.deepEqual(body.result.candidates.map((item: { branch: { id: string } }) => item.branch.id), ["candidate"]);
});

test("events validates before D1 and persists only privacy-approved columns", async () => {
  let invalidReads = 0;
  const invalidHandler = createEventsHandler(async () => {
    invalidReads += 1;
    throw new Error("must not load DB");
  });
  const invalid = await invalidHandler(new Request("http://local/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: crypto.randomUUID(), eventType: "quick_started", lat: 37.3 }),
  }));
  assert.equal(invalid.status, 400);
  assert.equal(invalidReads, 0);

  for (const areaId of ["private note 37.39,126.96", "area:"]) {
    const privateArea = await invalidHandler(new Request("http://local/api/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: crypto.randomUUID(), eventType: "quick_started", areaId }),
    }));
    assert.equal(privateArea.status, 400);
  }
  assert.equal(invalidReads, 0);

  let sql = "";
  let bindings: unknown[] = [];
  const db = database((statement) => {
    sql = statement;
    return {
      bind(...values) { bindings = values; return this; },
      async all<T>() { return { results: [] as T[] }; },
      async first<T>() { return null as T | null; },
      async run() { return { meta: { changes: 1 } }; },
    };
  });
  const handler = createEventsHandler(async () => db);
  const sessionId = crypto.randomUUID();
  const response = await handler(new Request("http://local/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, eventType: "directions_clicked", elapsedMs: 12, areaId: "anyang", radiusKm: 3, verificationStatus: "verified" }),
  }));
  assert.equal(response.status, 204);
  assert.match(sql, /INSERT INTO product_events/);
  assert.doesNotMatch(sql, /\b(?:lat|lng|text|user_agent|ip)\b/i);
  assert.equal(bindings.includes(sessionId), false);
  assert.equal(typeof bindings[1], "string");
  assert.match(bindings[1] as string, /^[a-f0-9]{64}$/);
  assert.equal(bindings.filter((value) => value === "anyang").length, 1);
});

test("events returns 400 when a canonical area does not exist and persists no row", async () => {
  let runCalls = 0;
  const db = database(() => ({
    bind() { return this; },
    async all<T>() { return { results: [] as T[] }; },
    async first<T>() { return null as T | null; },
    async run() { runCalls += 1; return { meta: { changes: 0 } }; },
  }));
  const response = await createEventsHandler(async () => db)(new Request("http://local/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/activity+json" },
    body: JSON.stringify({ sessionId: crypto.randomUUID(), eventType: "quick_started", areaId: "not-found" }),
  }));
  assert.equal(response.status, 400);
  assertJson(response);
  assert.deepEqual(await response.json(), { error: "이벤트 지역을 확인해 주세요." });
  assert.equal(runCalls, 1);
});

test("areas, shop detail, and database failures return public response shapes", async () => {
  const areasDb = database(() => ({
    bind() { return this; },
    async all<T>() { return { results: [{ id: "anyang", name: "안양", kind: "district", lat: 37.39, lng: 126.96 }] as T[] }; },
    async first<T>() { return null as T | null; },
    async run() {},
  }));
  const areas = await createAreasHandler(async () => areasDb)();
  assertJson(areas);
  assert.deepEqual(await areas.json(), { areas: [{ id: "anyang", name: "안양", kind: "district", lat: 37.39, lng: 126.96 }] });

  const emptyDb = database(() => ({
    bind() { return this; },
    async all<T>() { return { results: [] as T[] }; },
    async first<T>() { return null as T | null; },
    async run() {},
  }));
  const missing = await createShopDetailHandler(async () => emptyDb)(new Request("http://local"), { params: Promise.resolve({ slug: "none" }) });
  assert.equal(missing.status, 404);
  assertJson(missing);
  assert.deepEqual(await missing.json(), { error: "매장을 찾지 못했습니다." });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const unavailable = await createAreasHandler(async () => { throw new Error("missing D1"); })();
    assert.equal(unavailable.status, 503);
  } finally {
    console.error = originalConsoleError;
  }
});

test("shop detail validates the slug before touching D1", async () => {
  let databaseReads = 0;
  const handler = createShopDetailHandler(async () => {
    databaseReads += 1;
    throw new Error("must not load DB");
  });
  const response = await handler(new Request("http://local"), { params: Promise.resolve({ slug: " ".repeat(201) }) });
  assert.equal(response.status, 400);
  assert.equal(databaseReads, 0);
  assertJson(response);
  assert.deepEqual(await response.json(), { error: "매장 주소를 확인해 주세요." });
});

test("compatibility shops returns verified, candidate, and stale public records explicitly", async () => {
  const base = { branch_name: null, region: "경기", district: "안양", address: "주소", lat: 37.39, lng: 126.96, phone: null, public_status: "active", hours_text: null, last_verified_at: null, opening_hours_json: "[]", menu_id: null };
  const rows = [
    { ...base, branch_id: "v", slug: "verified", shop_name: "검증", verification_status: "verified" },
    { ...base, branch_id: "c", slug: "candidate", shop_name: "후보", verification_status: "candidate" },
    { ...base, branch_id: "s", slug: "stale", shop_name: "오래됨", verification_status: "stale" },
  ];
  const db = database((sql) => ({
    bind() { return this; },
    async all<T>() {
      return sql.includes("FROM areas")
        ? { results: [{ id: "anyang", name: "안양", kind: "district", lat: 37.39, lng: 126.96 }] as T[] }
        : { results: rows as T[] };
    },
    async first<T>() { return null as T | null; },
    async run() {},
  }));
  const response = await createCompatibilityShopsHandler(async () => db)();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.shops.map((shop: { verificationStatus: string }) => shop.verificationStatus), ["verified", "candidate", "stale"]);
});
