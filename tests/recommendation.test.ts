import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeRecommendationIntent,
  distanceBetweenKm,
  hasKaraiMenu,
  recommendShops,
} from "../app/recommendation.ts";

test("maps anger and stress language to exact karai menu recommendations", () => {
  const result = recommendShops(
    "오늘 화가 나는데 스트레스 풀고 싶어",
    "전국",
  );

  assert.equal(result.intent.stressRelief, true);
  assert.equal(result.intent.wantsKarai, true);
  assert.equal(result.strategy, "karai");
  assert.equal(result.recommendations.length, 3);
  assert.ok(result.recommendations.every(({ shop }) => hasKaraiMenu(shop)));
  assert.match(result.recommendations[0].reason, /카라이/);
});

test("spicy negation wins over the inferred stress intent", () => {
  const result = recommendShops(
    "스트레스 받았지만 매운 건 싫어. 안 매운 걸로 부탁해",
    "전국",
  );

  assert.equal(result.intent.stressRelief, true);
  assert.equal(result.intent.avoidSpicy, true);
  assert.equal(result.intent.spicy, false);
  assert.equal(result.strategy, "taste");
  assert.ok(result.recommendations.every(({ shop }) => shop.spiciness <= 1));
});

test("does not infer anger from a negated statement", () => {
  const intent = analyzeRecommendationIntent("오늘은 화가 안 났어. 담백한 걸로");
  assert.equal(intent.stressRelief, false);
  assert.equal(intent.wantsKarai, false);
});

test("nearby intent ignores a stale region filter and ranks by distance", () => {
  const location = { lat: 37.5618, lng: 126.9237 };
  const result = recommendShops(
    "내 위치에서 가까운 라멘 추천해줘",
    "부산",
    location,
  );

  assert.equal(result.targetRegion, "전국");
  assert.equal(result.nearbyUsed, true);
  assert.deepEqual(
    result.recommendations.map(({ shop }) => shop.id),
    [
      "demo-seoul-mapo-001",
      "demo-seoul-seongdong-002",
      "demo-incheon-namdong-007",
    ],
  );
});

test("location-aware stress recommendations choose the nearest karai menus", () => {
  const result = recommendShops(
    "오늘 화가 나는데 스트레스 풀고 싶어",
    "전국",
    { lat: 37.5618, lng: 126.9237 },
  );

  assert.equal(result.recommendations[0].shop.id, "demo-seoul-seongdong-002");
  assert.ok(result.recommendations.every(({ shop }) => hasKaraiMenu(shop)));
  assert.ok(
    result.recommendations.every(
      (item, index, all) => index === 0 || (all[index - 1].distanceKm ?? 0) <= (item.distanceKm ?? 0),
    ),
  );
});

test("keeps a mentioned region and labels the absence of karai as a fallback", () => {
  const result = recommendShops("부산에서 스트레스 풀고 싶어", "전국");

  assert.equal(result.targetRegion, "부산");
  assert.equal(result.strategy, "taste");
  assert.ok(result.recommendations.every(({ shop }) => shop.region === "부산"));
  assert.ok(result.recommendations.every(({ shop }) => !hasKaraiMenu(shop)));
});

test("calculates haversine distance deterministically", () => {
  const distance = distanceBetweenKm(
    { lat: 37.5618, lng: 126.9237 },
    { lat: 37.5446, lng: 127.0561 },
  );
  assert.ok(Math.abs(distance - 11.827) < 0.02);
});
