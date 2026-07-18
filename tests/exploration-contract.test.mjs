import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exploration combines quick preferences, natural language, and ranking mode", async () => {
  const page = await readFile(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
  for (const copy of ["청탕", "백탕", "쇼유", "시오", "츠케멘", "마제소바", "취향 우선", "균형 추천", "가까운 곳 우선", "추가로 원하는 맛을 말해보세요"]) {
    assert.match(page, new RegExp(copy));
  }
  assert.match(page, /\/api\/v1\/recommendations/);
  assert.match(page, /검증 전 후보/);
});

test("shop details render evidence associated with each public menu", async () => {
  const page = await readFile(new URL("../app/shops/[slug]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /menu\.evidence/);
  assert.match(page, /메뉴 출처/);
  assert.match(page, /evidence\.sourceUrl/);
});
