import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages a D1 migration with the eight requested verification candidates", async () => {
  const [migration, hosting] = await Promise.all([
    readFile(new URL("../drizzle/0000_real_shop_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shop_candidates/);
  assert.match(migration, /CHECK\(status IN \('pending', 'verified', 'hold', 'rejected'\)\)/);
  assert.equal((migration.match(/^\('[^']+', /gm) ?? []).length, 8);
  for (const shop of ["멘큐단", "신멘", "라멘 구락부", "멘지 망원점", "지로우 라멘", "오레노라멘 본점", "담택", "멘야준"]) {
    assert.match(migration, new RegExp(shop));
  }
});

test("connects verification status to the public nearby flow and recommendation data", async () => {
  const [home, nearby, clientEvents, verificationPage, recommendationApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/nearby/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/analytics/client-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/verify/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/recommendations/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(home, /fetch\(/);
  assert.match(nearby, /fetch\("\/api\/v1\/recommendations"/);
  assert.match(nearby, /fetch\("\/api\/v1\/areas"/);
  assert.match(nearby, /createProductEventEmitter/);
  assert.match(clientEvents, /fetch\("\/api\/v1\/events"/);
  assert.match(nearby, /verificationStatus: item\.branch\.verificationStatus/);
  assert.match(verificationPage, /검증 완료/);
  assert.match(verificationPage, /검증 완료.*지도와 챗봇에 반영됩니다/);
  assert.match(recommendationApi, /createD1ShopRepository/);
  assert.doesNotMatch(recommendationApi, /listVerifiedShops|RAMEN_SHOPS/);
});
