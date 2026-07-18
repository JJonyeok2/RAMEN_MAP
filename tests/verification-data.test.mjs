import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("packages both D1 migrations and normalizes all eight real-data candidates", async () => {
  const [seedMigration, normalizedMigration, hosting] = await Promise.all([
    readFile(new URL("../drizzle/0000_real_shop_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_normalize_ramen_domain.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(seedMigration, /CREATE TABLE IF NOT EXISTS shop_candidates/);
  assert.match(seedMigration, /CHECK\(status IN \('pending', 'verified', 'hold', 'rejected'\)\)/);
  assert.equal((seedMigration.match(/^\('[^']+', /gm) ?? []).length, 8);
  for (const shop of ["멘큐단", "신멘", "라멘 구락부", "멘지 망원점", "지로우 라멘", "오레노라멘 본점", "담택", "멘야준"]) {
    assert.match(seedMigration, new RegExp(shop));
  }

  const normalizedTables = [
    "shops",
    "branches",
    "menu_items",
    "menu_profiles",
    "opening_hours",
    "opening_exceptions",
    "source_evidence",
    "verification_events",
    "areas",
    "product_events",
  ];
  for (const table of normalizedTables) {
    assert.match(normalizedMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(seedMigration);
    database.exec(normalizedMigration);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    for (const table of ["shops", "branches", "menu_items"]) {
      assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 8);
    }
  } finally {
    database.close();
  }
});

test("connects public verification status to discovery and keeps administration private", async () => {
  const [home, nearby, clientEvents, legacyVerifyPage, adminPage, recommendationApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/nearby/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/analytics/client-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/verify/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/recommendations/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(home, /fetch\(/);
  assert.match(nearby, /fetch\("\/api\/v1\/recommendations"/);
  assert.match(nearby, /fetch\("\/api\/v1\/areas"/);
  assert.match(nearby, /createProductEventEmitter/);
  assert.match(clientEvents, /fetch\("\/api\/v1\/events"/);
  assert.match(nearby, /verificationStatus: item\.branch\.verificationStatus/);
  assert.doesNotMatch(home, /href=["']\/(?:admin|verify)/);
  assert.match(legacyVerifyPage, /redirect\("\/admin"\)/);
  assert.doesNotMatch(legacyVerifyPage, /shop_candidates|textarea|<form/);
  assert.match(adminPage, /검증 완료/);
  assert.match(adminPage, /검증 후보/);
  assert.match(adminPage, /재검증 필요/);
  assert.match(adminPage, /폐점/);
  assert.match(recommendationApi, /createD1ShopRepository/);
  assert.doesNotMatch(recommendationApi, /listVerifiedShops|RAMEN_SHOPS/);
});
