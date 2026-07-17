import assert from "node:assert/strict";
import test from "node:test";

import type { D1DatabaseLike } from "../db/d1.ts";
import { createD1ShopRepository, mapBranchRows } from "../db/repositories/d1-shop-repository.ts";
import type { PublicBranchSummary } from "../domain/ramen.ts";
import type { ShopRepository } from "../domain/shop-repository.ts";
import { openingStatusAt } from "../features/shops/opening-status.ts";
import { createShopService } from "../features/shops/shop-service.ts";

const verified = {
  id: "b1",
  slug: "one",
  shopName: "하나",
  branchName: null,
  region: "경기",
  district: "안양",
  address: "주소1",
  lat: 37.39,
  lng: 126.96,
  phone: null,
  publicStatus: "active",
  verificationStatus: "verified",
  lastVerifiedAt: null,
  openingStatus: "unknown",
  menus: [],
} satisfies PublicBranchSummary;

const candidate = {
  ...verified,
  id: "b2",
  slug: "two",
  shopName: "둘",
  verificationStatus: "candidate",
} satisfies PublicBranchSummary;

const repository: ShopRepository = {
  async listAreas() {
    return [{ id: "anyang", name: "안양", kind: "district", lat: 37.3943, lng: 126.9568 }];
  },
  async listPublicBranches() {
    return [verified, candidate];
  },
  async getPublicShopBySlug(slug) {
    return slug === "one" ? { ...verified, evidence: [], hoursText: null } : null;
  },
};

test("keeps verified and candidate branches explicit", async () => {
  const result = await createShopService(repository).listNearby({ lat: 37.39, lng: 126.96 }, 3);
  assert.deepEqual(result.map((item) => item.verificationStatus), ["verified", "candidate"]);
});

test("returns null for a missing public shop", async () => {
  assert.equal(await createShopService(repository).getDetail("missing"), null);
});

test("computes opening state in Korea using structured hours", () => {
  const hours = [{
    weekday: 2,
    opens_at: "11:00",
    closes_at: "21:00",
    break_starts_at: "15:00",
    break_ends_at: "17:00",
    is_closed: 0,
  }];

  assert.equal(openingStatusAt(hours, new Date("2026-07-21T03:00:00.000Z")), "open");
  assert.equal(openingStatusAt(hours, new Date("2026-07-21T07:00:00.000Z")), "closed");
  assert.equal(openingStatusAt(hours, new Date("2026-07-22T03:00:00.000Z")), "closed");
  assert.equal(openingStatusAt([], new Date("2026-07-21T03:00:00.000Z")), "unknown");
});

test("returns unknown for ambiguous structured hours", () => {
  const now = new Date("2026-07-21T03:00:00.000Z");
  const interval = {
    weekday: 2,
    opens_at: "11:00",
    closes_at: "21:00",
    break_starts_at: null,
    break_ends_at: null,
    is_closed: 0,
  };

  for (const row of [
    { ...interval, opens_at: null },
    { ...interval, closes_at: null },
    { ...interval, opens_at: "bad" },
    { ...interval, closes_at: "25:00" },
    { ...interval, opens_at: "11:00", closes_at: "11:00" },
    { ...interval, break_starts_at: "15:00" },
    { ...interval, break_ends_at: "17:00" },
    { ...interval, break_starts_at: "bad", break_ends_at: "17:00" },
    { ...interval, break_starts_at: "15:00", break_ends_at: "bad" },
    { ...interval, is_closed: 2 },
  ]) {
    assert.equal(openingStatusAt([row], now), "unknown");
  }
  assert.equal(openingStatusAt([interval, { ...interval, is_closed: 1 }], now), "unknown");
});

test("keeps unambiguous closed and overnight structured hours deterministic", () => {
  const closed = [{
    weekday: 2,
    opens_at: null,
    closes_at: null,
    break_starts_at: null,
    break_ends_at: null,
    is_closed: 1,
  }];
  const overnight = [{
    weekday: 2,
    opens_at: "17:00",
    closes_at: "02:00",
    break_starts_at: null,
    break_ends_at: null,
    is_closed: 0,
  }];

  assert.equal(openingStatusAt(closed, new Date("2026-07-21T03:00:00.000Z")), "closed");
  assert.equal(openingStatusAt(overnight, new Date("2026-07-21T16:00:00.000Z")), "open");
});

test("opens when an overlapping interval is not on break regardless of row order", () => {
  const first = {
    weekday: 2,
    opens_at: "11:00",
    closes_at: "21:00",
    break_starts_at: "15:00",
    break_ends_at: "17:00",
    is_closed: 0,
  };
  const second = {
    weekday: 2,
    opens_at: "16:00",
    closes_at: "18:00",
    break_starts_at: null,
    break_ends_at: null,
    is_closed: 0,
  };
  const now = new Date("2026-07-21T07:30:00.000Z");

  assert.equal(openingStatusAt([first, second], now), "open");
  assert.equal(openingStatusAt([second, first], now), "open");
});

test("normalizes and validates overnight breaks inside their opening interval", () => {
  const opening = {
    weekday: 2,
    opens_at: "17:00",
    closes_at: "02:00",
    break_starts_at: "00:00",
    break_ends_at: "00:30",
    is_closed: 0,
  };
  const now = new Date("2026-07-21T15:15:00.000Z");

  assert.equal(openingStatusAt([opening], now), "closed");
  assert.equal(openingStatusAt([{ ...opening, break_starts_at: "23:30", break_ends_at: "00:30" }], now), "closed");
  assert.equal(openingStatusAt([{ ...opening, break_starts_at: "00:00", break_ends_at: "00:00" }], now), "unknown");
  assert.equal(openingStatusAt([{ ...opening, break_starts_at: "02:00", break_ends_at: "02:30" }], now), "unknown");
  assert.equal(openingStatusAt([{ ...opening, break_starts_at: "16:00", break_ends_at: "01:00" }], now), "unknown");
});

const joinedRow = {
  branch_id: "b1",
  slug: "one",
  shop_name: "하나",
  branch_name: null,
  region: "경기",
  district: "안양",
  address: "주소1",
  lat: 37.39,
  lng: 126.96,
  phone: null,
  public_status: "active",
  verification_status: "verified",
  hours_text: "11:00-21:00",
  last_verified_at: "2026-04-01T00:00:00.000Z",
  opening_hours_json: "[]",
  menu_id: "m1",
  menu_name: "시오",
  price: 10000,
  availability_status: "available",
  menu_verification_status: "verified",
  menu_last_verified_at: "2026-04-01T00:00:00.000Z",
  ramen_types: '["shio"]',
  broth_style: "chintan",
  body_level: 2,
  spiciness_level: 0,
  broth_bases: '["닭"]',
  tags: '["담백"]',
};

test("groups normalized menu rows and handles stale windows and invalid profiles", () => {
  const branches = mapBranchRows([
    joinedRow,
    { ...joinedRow },
    {
      ...joinedRow,
      menu_id: "m2",
      menu_name: "츠케멘",
      menu_last_verified_at: "2025-12-01T00:00:00.000Z",
      ramen_types: '"tsukemen"',
      broth_style: null,
      body_level: null,
      spiciness_level: null,
      broth_bases: "not-json",
      tags: "[1]",
    },
    { ...joinedRow, menu_id: "m4", menu_name: "후보", menu_verification_status: "candidate" },
    {
      ...joinedRow,
      menu_id: "m5",
      menu_name: "프로필 없음",
      ramen_types: undefined,
      broth_style: undefined,
      body_level: undefined,
      spiciness_level: undefined,
      broth_bases: undefined,
      tags: undefined,
    },
    { ...joinedRow, menu_id: "m3", menu_name: "숨김", menu_verification_status: "rejected" },
    { ...joinedRow, branch_id: "rejected", slug: "rejected", verification_status: "rejected" },
  ], new Date("2026-07-17T00:00:00.000Z"));

  assert.equal(branches.length, 1);
  assert.equal(branches[0].verificationStatus, "stale");
  assert.deepEqual(branches[0].menus.map((menu) => [menu.id, menu.verificationStatus, menu.ramenTypes]), [
    ["m1", "verified", ["shio"]],
    ["m2", "stale", []],
    ["m4", "candidate", ["shio"]],
    ["m5", "verified", []],
  ]);
  assert.deepEqual(branches[0].menus[1], {
    id: "m2",
    name: "츠케멘",
    price: 10000,
    ramenTypes: [],
    brothStyle: null,
    bodyLevel: null,
    spicinessLevel: null,
    brothBases: [],
    tags: [],
    availabilityStatus: "available",
    verificationStatus: "stale",
    lastVerifiedAt: "2025-12-01T00:00:00.000Z",
  });
  assert.deepEqual(branches[0].menus[3], {
    id: "m5",
    name: "프로필 없음",
    price: 10000,
    ramenTypes: [],
    brothStyle: null,
    bodyLevel: null,
    spicinessLevel: null,
    brothBases: [],
    tags: [],
    availabilityStatus: "available",
    verificationStatus: "verified",
    lastVerifiedAt: "2026-04-01T00:00:00.000Z",
  });
});

test("uses normalized public D1 queries and never writes nearby origins", async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      const statement = { sql, values: [] as unknown[] };
      statements.push(statement);
      return {
        bind(...values) {
          statement.values = values;
          return this;
        },
        async all<T>() {
          if (sql.includes("FROM areas")) {
            assert.deepEqual(statement.values, []);
            return { results: [{ id: "anyang", name: "안양", kind: "district", lat: 37.3943, lng: 126.9568 }] as T[] };
          }
          if (sql.includes("FROM source_evidence")) {
            assert.deepEqual(statement.values, ["b1"]);
            return { results: [
              { id: "e2", source_name: "새 출처", source_url: "https://example.com/new", checked_at: "2026-07-16T00:00:00.000Z", note: "새" },
              { id: "e1", source_name: "기존 출처", source_url: "https://example.com/old", checked_at: "2026-07-01T00:00:00.000Z", note: "기존" },
            ] as T[] };
          }
          if (sql.includes("WHERE b.slug = ?")) {
            assert.deepEqual(statement.values, ["one"]);
            return { results: [joinedRow] as T[] };
          }
          if (sql.includes("b.lat BETWEEN ? AND ?")) {
            const [latLow, latHigh, lngLow, lngHigh] = statement.values;
            assert.equal(typeof latLow, "number");
            assert.equal(typeof latHigh, "number");
            assert.equal(typeof lngLow, "number");
            assert.equal(typeof lngHigh, "number");
            assert.deepEqual(statement.values, [
              37.39 - 3 / 110.574,
              37.39 + 3 / 110.574,
              126.96 - 3 / (111.320 * Math.cos(37.39 * Math.PI / 180)),
              126.96 + 3 / (111.320 * Math.cos(37.39 * Math.PI / 180)),
            ]);
            return { results: [
              joinedRow,
              { ...joinedRow, branch_id: "b-out", slug: "outside-circle", lat: 37.41, lng: 126.99, menu_id: "m-out" },
            ] as T[] };
          }
          throw new Error(`Unexpected public repository query: ${sql}`);
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          throw new Error("The shop repository must not write during public reads.");
        },
      };
    },
  };

  const repository = createD1ShopRepository(database, new Date("2026-07-17T00:00:00.000Z"));
  const areas = await repository.listAreas();
  const shops = await repository.listPublicBranches({ lat: 37.39, lng: 126.96 }, 3);
  const detail = await repository.getPublicShopBySlug("one");

  assert.deepEqual(areas, [{ id: "anyang", name: "안양", kind: "district", lat: 37.3943, lng: 126.9568 }]);
  assert.equal(shops.length, 1);
  assert.deepEqual(shops.map((shop) => shop.id), ["b1"]);
  assert.deepEqual(detail?.evidence.map((item) => item.id), ["e2", "e1"]);
  const nearby = statements.find((statement) => statement.sql.includes("b.lat BETWEEN ? AND ?"));
  assert.ok(nearby);
  assert.match(nearby.sql, /b\.public_status = 'active'/);
  assert.match(nearby.sql, /b\.verification_status IN \('verified', 'candidate', 'stale'\)/);
  assert.match(nearby.sql, /m\.verification_status IN \('verified', 'candidate', 'stale'\)/);
  assert.match(nearby.sql, /b\.lat IS NOT NULL AND b\.lng IS NOT NULL/);
  assert.match(nearby.sql, /b\.lat BETWEEN \? AND \?/);
  assert.match(nearby.sql, /b\.lng BETWEEN \? AND \?/);
  assert.equal(nearby.values.length, 4);
  const [latLow, latHigh, lngLow, lngHigh] = nearby.values as number[];
  assert.ok(Math.abs(latLow - (37.39 - 3 / 110.574)) < 1e-12);
  assert.ok(Math.abs(latHigh - (37.39 + 3 / 110.574)) < 1e-12);
  assert.ok(Math.abs(lngLow - (126.96 - 3 / (111.320 * Math.cos(37.39 * Math.PI / 180)))) < 1e-12);
  assert.ok(Math.abs(lngHigh - (126.96 + 3 / (111.320 * Math.cos(37.39 * Math.PI / 180)))) < 1e-12);
  const evidence = statements.find((statement) => statement.sql.includes("FROM source_evidence"));
  assert.ok(evidence);
  assert.match(evidence.sql, /ORDER BY checked_at DESC/);
});
