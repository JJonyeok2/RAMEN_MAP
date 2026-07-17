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
  last_verified_at: "2026-01-01T00:00:00.000Z",
  opening_hours_json: "[]",
  menu_id: "m1",
  menu_name: "시오",
  price: 10000,
  availability_status: "available",
  menu_verification_status: "verified",
  menu_last_verified_at: "2026-01-01T00:00:00.000Z",
  ramen_types: '["shio"]',
  broth_style: "chintan",
  body_level: 2,
  spiciness_level: 0,
  broth_bases: '["닭"]',
  tags: '["담백"]',
};

test("groups normalized menu rows and excludes rejected menu facts", () => {
  const branches = mapBranchRows([
    joinedRow,
    { ...joinedRow, menu_id: "m2", menu_name: "츠케멘", ramen_types: "not-json", menu_verification_status: "candidate" },
    { ...joinedRow, menu_id: "m3", menu_name: "숨김", menu_verification_status: "rejected" },
    { ...joinedRow, branch_id: "rejected", slug: "rejected", verification_status: "rejected" },
  ], new Date("2026-07-17T00:00:00.000Z"));

  assert.equal(branches.length, 1);
  assert.equal(branches[0].verificationStatus, "stale");
  assert.deepEqual(branches[0].menus.map((menu) => [menu.id, menu.verificationStatus, menu.ramenTypes]), [
    ["m1", "stale", ["shio"]],
    ["m2", "candidate", []],
  ]);
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
          if (sql.includes("FROM areas")) return { results: [] as T[] };
          if (sql.includes("FROM source_evidence")) return { results: [] as T[] };
          return { results: [joinedRow] as T[] };
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
  const shops = await repository.listPublicBranches({ lat: 37.39, lng: 126.96 }, 3);
  await repository.getPublicShopBySlug("one");

  assert.equal(shops.length, 1);
  const nearby = statements[0];
  assert.match(nearby.sql, /b\.public_status = 'active'/);
  assert.match(nearby.sql, /b\.verification_status IN \('verified', 'candidate', 'stale'\)/);
  assert.match(nearby.sql, /m\.verification_status IN \('verified', 'candidate', 'stale'\)/);
  assert.match(nearby.sql, /b\.lat IS NOT NULL AND b\.lng IS NOT NULL/);
  assert.match(nearby.sql, /b\.lat BETWEEN \? AND \?/);
  assert.match(nearby.sql, /b\.lng BETWEEN \? AND \?/);
  assert.deepEqual(nearby.values.length, 4);
  const evidence = statements.find((statement) => statement.sql.includes("FROM source_evidence"));
  assert.ok(evidence);
  assert.match(evidence.sql, /ORDER BY checked_at DESC/);
});
