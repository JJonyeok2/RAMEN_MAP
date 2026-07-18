import assert from "node:assert/strict";
import test from "node:test";
import { parseRecommendationRequest } from "../features/recommendation/request.ts";

const validRequest = {
  origin: { lat: 37.39, lng: 126.96 },
  mode: "balanced",
  quick: true,
  selections: {},
  text: "청탕",
};

test("accepts an approved mode and finite Korean coordinates", () => {
  const value = parseRecommendationRequest(validRequest);
  assert.equal(value.mode, "balanced");
  assert.equal(value.quick, true);
  assert.deepEqual(value.intent.brothStyles, ["chintan"]);
});

test("rejects invalid modes and out-of-range coordinates", () => {
  assert.throws(
    () => parseRecommendationRequest({ origin: { lat: 191, lng: 126.96 }, mode: "fast" }),
    /위치|추천/,
  );
  assert.throws(() => parseRecommendationRequest({ ...validRequest, origin: { lat: 37.3, lng: -181 } }), /위치/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, origin: { lat: Number.NaN, lng: 126.96 } }), /위치/);
});

test("rejects malformed shapes, missing booleans, long text, and unknown fields", () => {
  assert.throws(() => parseRecommendationRequest(null), /요청/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, quick: "true" }), /빠른/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, text: "가".repeat(501) }), /500/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, coordinates: validRequest.origin }), /요청/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, origin: { ...validRequest.origin, accuracy: 3 } }), /위치/);
});

test("accepts only runtime domain values in selection arrays", () => {
  const value = parseRecommendationRequest({
    ...validRequest,
    selections: {
      ramenTypes: ["shio"],
      brothStyles: ["chintan"],
      brothBases: ["닭"],
      bodyTarget: 3,
      spicinessTarget: 0,
    },
  });
  assert.deepEqual(value.intent.ramenTypes, ["shio"]);
  assert.equal(value.intent.bodyTarget, 3);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, selections: { ramenTypes: ["udon"] } }), /선택/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, selections: { bodyTarget: 0 } }), /선택/);
  assert.throws(() => parseRecommendationRequest({ ...validRequest, selections: { extra: [] } }), /선택/);
});

test("rejects selection arrays larger than their approved vocabulary before deduplication", () => {
  assert.throws(
    () => parseRecommendationRequest({
      ...validRequest,
      selections: { ramenTypes: ["shio", "shio", "shio", "shio", "shio", "shio", "shio"] },
    }),
    /선택/,
  );
});
