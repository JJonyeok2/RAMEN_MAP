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

test("connects verification status to the public map and recommendation data", async () => {
  const [home, verificationPage, shopApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/verify/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/shops/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(home, /fetch\("\/api\/shops"/);
  assert.match(home, /recommendShops\(cleanPrompt, region, coordinates, shops\)/);
  assert.match(home, /실데이터 검증/);
  assert.match(verificationPage, /검증 완료/);
  assert.match(verificationPage, /검증 완료.*지도와 챗봇에 반영됩니다/);
  assert.match(shopApi, /createD1ShopRepository/);
  assert.doesNotMatch(shopApi, /listVerifiedShops|RAMEN_SHOPS/);
});
