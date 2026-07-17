import assert from "node:assert/strict";
import test from "node:test";

import type { TasteIntent } from "../domain/recommendation.ts";
import type { BranchSummary, MenuItem } from "../domain/ramen.ts";
import { modeWeights } from "../features/recommendation/config.ts";
import { parseTasteIntent } from "../features/recommendation/intent-parser.ts";
import { recommend } from "../features/recommendation/recommend.ts";
import { scoreMenu } from "../features/recommendation/scoring.ts";

const origin = { lat: 37.39, lng: 126.96 };

function makeMenu(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: "menu-default",
    name: "시오 청탕",
    price: 10_000,
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

function makeBranch(overrides: Partial<BranchSummary> = {}): BranchSummary {
  const id = overrides.id ?? "branch-default";
  return {
    id,
    slug: id,
    shopName: id,
    branchName: null,
    region: "경기",
    district: "안양",
    address: `${id} 주소`,
    lat: 37.395,
    lng: 126.96,
    phone: null,
    publicStatus: "active",
    verificationStatus: "verified",
    lastVerifiedAt: "2026-07-01T00:00:00.000Z",
    openingStatus: "open",
    menus: [makeMenu({ id: `${id}-menu` })],
    ...overrides,
  };
}

function makeScenarioBranches(): BranchSummary[] {
  return [
    makeBranch({
      id: "verified-chintan",
      lat: 37.395,
      menus: [makeMenu({ id: "verified-chintan-menu" })],
    }),
    makeBranch({
      id: "verified-paitan",
      lat: 37.4,
      menus: [makeMenu({
        id: "verified-paitan-menu",
        name: "돈코츠 백탕",
        ramenTypes: ["tonkotsu"],
        brothStyle: "paitan",
        bodyLevel: 5,
        brothBases: ["돼지"],
        tags: ["진한"],
      })],
    }),
    makeBranch({
      id: "candidate-karai",
      lat: 37.41,
      verificationStatus: "candidate",
      menus: [makeMenu({
        id: "candidate-karai-menu",
        name: "카라이 미소",
        ramenTypes: ["miso"],
        brothStyle: "paitan",
        bodyLevel: 4,
        spicinessLevel: 5,
        tags: ["카라이", "매운"],
        verificationStatus: "candidate",
      })],
    }),
    makeBranch({
      id: "verified-midrange",
      lat: 37.43,
      menus: [makeMenu({
        id: "verified-midrange-menu",
        name: "쇼유 청탕",
        ramenTypes: ["shoyu"],
      })],
    }),
  ];
}

const emptyIntent: TasteIntent = {
  ramenTypes: [],
  brothStyles: [],
  brothBases: [],
  bodyTarget: null,
  spicinessTarget: null,
  avoidRich: false,
  avoidSpicy: false,
  wantsKarai: false,
  freeText: "",
};

test("locks the approved recommendation mode weights", () => {
  assert.deepEqual(modeWeights, {
    taste: { taste: 60, distance: 20, opening: 10, trust: 10 },
    balanced: { taste: 40, distance: 30, opening: 20, trust: 10 },
    distance: { taste: 15, distance: 55, opening: 20, trust: 10 },
  });
});

test("starts empty and merges normalized button selections", () => {
  assert.deepEqual(parseTasteIntent("", {}), emptyIntent);
  assert.deepEqual(parseTasteIntent("", {
    ramenTypes: ["shio", "shio"],
    brothStyles: ["chintan"],
    brothBases: ["닭", "해산물"],
    bodyTarget: 2,
    spicinessTarget: 1,
  }), {
    ...emptyIntent,
    ramenTypes: ["shio"],
    brothStyles: ["chintan"],
    brothBases: ["닭", "해산물"],
    bodyTarget: 2,
    spicinessTarget: 1,
  });
});

test("spicy negation wins over stress inference", () => {
  const intent = parseTasteIntent("스트레스받았지만 매운 건 싫어", {});
  assert.equal(intent.wantsKarai, false);
  assert.equal(intent.avoidSpicy, true);
  assert.equal(intent.spicinessTarget, 0);
});

test("binds spicy exclusions and double negatives to the complete phrase", () => {
  const dislikesSpicy = parseTasteIntent("매운 건 안 좋아", {});
  assert.equal(dislikesSpicy.avoidSpicy, true);
  assert.equal(dislikesSpicy.spicinessTarget, 0);
  assert.equal(dislikesSpicy.wantsKarai, false);

  const dislikesMild = parseTasteIntent("안 매운 건 싫어", {});
  assert.equal(dislikesMild.avoidSpicy, false);
  assert.equal(dislikesMild.spicinessTarget, 4);

  const acceptsSpicy = parseTasteIntent("매운 건 싫지 않아", {});
  assert.equal(acceptsSpicy.avoidSpicy, false);
  assert.equal(acceptsSpicy.spicinessTarget, 4);
});

test("does not infer anger from a negated statement", () => {
  const intent = parseTasteIntent("오늘은 화가 안 났어. 담백한 걸로", {});
  assert.equal(intent.wantsKarai, false);
});

test("binds mood negation to its own clause", () => {
  assert.equal(parseTasteIntent("화는 안 났지만 스트레스 받았어", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("스트레스 안 받았는데 화가 나", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("화는 안 났지만 짜증은 나", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("스트레스는 안 받았지만 업무 스트레스가 심해", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("화는 안 났고 짜증은 나", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("스트레스는 안 받았고 화가 나", {}).wantsKarai, true);
  assert.equal(parseTasteIntent("회의가 끝나고 화가 안 나", {}).wantsKarai, false);
  assert.equal(parseTasteIntent("회의가 끝나고 화가 나", {}).wantsKarai, true);
});

test("anger and stress prefer actual karai or spicy menu profiles", () => {
  const intent = parseTasteIntent("오늘 화가 나서 스트레스 풀고 싶어", {});
  assert.equal(intent.wantsKarai, true);
  assert.equal(intent.spicinessTarget, 4);

  const response = recommend(makeScenarioBranches(), {
    origin,
    mode: "taste",
    quick: false,
    intent,
  });
  assert.equal(response.candidates[0]?.menuId, "candidate-karai-menu");
});

test("anti-rich language prefers chintan without excluding an explicit light paitan request", () => {
  assert.deepEqual(parseTasteIntent("느끼한 건 싫어", {}).brothStyles, ["chintan"]);
  const explicit = parseTasteIntent("느끼하지 않은 백탕", {});
  assert.equal(explicit.avoidRich, true);
  assert.deepEqual(explicit.brothStyles, ["paitan"]);
});

test("preserves double-negation and acceptable-richness cases", () => {
  for (const prompt of ["느끼한 건 안 싫어", "느끼해도 괜찮아", "느끼하지 않아도 돼"]) {
    const intent = parseTasteIntent(prompt, {});
    assert.equal(intent.avoidRich, false, prompt);
    assert.deepEqual(intent.brothStyles, [], prompt);
  }
});

test("explicit broth wording and negations win over other style terms", () => {
  assert.deepEqual(parseTasteIntent("청탕 추천해줘", {}).brothStyles, ["chintan"]);
  assert.deepEqual(parseTasteIntent("백탕 추천해줘", {}).brothStyles, ["paitan"]);
  assert.deepEqual(parseTasteIntent("백탕 말고 청탕", {}).brothStyles, ["chintan"]);
  assert.deepEqual(parseTasteIntent("청탕 말고 백탕", {}).brothStyles, ["paitan"]);
  assert.deepEqual(parseTasteIntent("백탕은 싫어, 청탕으로", {}).brothStyles, ["chintan"]);
  assert.deepEqual(parseTasteIntent("청탕은 싫어, 백탕으로", {}).brothStyles, ["paitan"]);
  assert.deepEqual(parseTasteIntent("백탕은 빼줘", { brothStyles: ["paitan"] }).brothStyles, []);
});

test("neutral broth wording does not choose one arbitrarily", () => {
  assert.deepEqual(parseTasteIntent("청탕이든 백탕이든 상관없어", {}).brothStyles, []);
});

test("dry and dipping requests suppress descriptive soup inference", () => {
  assert.deepEqual(parseTasteIntent("깔끔한 마제소바", {}).brothStyles, ["dry"]);
  assert.deepEqual(parseTasteIntent("시원한 츠케멘", {}).brothStyles, ["dipping"]);
  assert.deepEqual(parseTasteIntent("크리미한 마제소바", {}).brothStyles, ["dry"]);
});

test("applies dry and dipping exclusions before deriving styles", () => {
  const dryOnly = parseTasteIntent("츠케멘 말고 마제소바", {});
  assert.deepEqual(dryOnly.ramenTypes, ["mazesoba"]);
  assert.deepEqual(dryOnly.brothStyles, ["dry"]);

  const dippingOnly = parseTasteIntent("마제소바 말고 츠케멘", {});
  assert.deepEqual(dippingOnly.ramenTypes, ["tsukemen"]);
  assert.deepEqual(dippingOnly.brothStyles, ["dipping"]);
});

test("parses approved explicit and descriptive taste vocabulary", () => {
  const cleanShoyu = parseTasteIntent("깔끔한 닭 간장 라멘", {});
  assert.deepEqual(cleanShoyu.ramenTypes, ["shoyu"]);
  assert.deepEqual(cleanShoyu.brothStyles, ["chintan"]);
  assert.deepEqual(cleanShoyu.brothBases, ["닭"]);
  assert.equal(cleanShoyu.bodyTarget, 2);

  const actions = parseTasteIntent("찍어 먹기와 비벼 먹기 중 고민", {});
  assert.deepEqual(actions.ramenTypes, ["tsukemen", "mazesoba"]);
  assert.deepEqual(actions.brothStyles, ["dipping", "dry"]);
});

test("does not retain explicitly excluded ramen types or broth bases", () => {
  const intent = parseTasteIntent("돈코츠 말고 쇼유, 돼지 말고 닭 육수", {
    ramenTypes: ["tonkotsu"],
    brothBases: ["돼지"],
  });
  assert.deepEqual(intent.ramenTypes, ["shoyu"]);
  assert.deepEqual(intent.brothBases, ["닭"]);

  assert.deepEqual(parseTasteIntent("돈코츠는 원하지 않고 쇼유로", {}).ramenTypes, ["shoyu"]);
  assert.deepEqual(parseTasteIntent("돈코츠가 아닌 쇼유로", {}).ramenTypes, ["shoyu"]);
  assert.deepEqual(parseTasteIntent("돼지는 안 먹고 닭으로", {}).brothBases, ["닭"]);
});

test("natural-language explicit style replaces a conflicting style button", () => {
  assert.deepEqual(parseTasteIntent("백탕으로", { brothStyles: ["chintan"] }).brothStyles, ["paitan"]);
});

test("returns the exact weighted integer score and two deterministic Korean reasons", () => {
  const branch = makeBranch();
  const first = scoreMenu({
    branch,
    menu: branch.menus[0],
    intent: parseTasteIntent("시오 청탕 닭 담백하고 안 매운 것", {}),
    mode: "balanced",
    distanceKm: 0,
    radiusKm: 3,
  });
  const second = scoreMenu({
    branch,
    menu: branch.menus[0],
    intent: parseTasteIntent("시오 청탕 닭 담백하고 안 매운 것", {}),
    mode: "balanced",
    distanceKm: 0,
    radiusKm: 3,
  });
  assert.deepEqual(first, second);
  assert.equal(first?.score, 100);
  assert.equal(first?.reasons.length, 2);
  assert.ok(first?.reasons.every((reason) => /[가-힣]/.test(reason)));
});

test("normalizes distance, opening, and trust using the approved balanced weights", () => {
  const branch = makeBranch({ verificationStatus: "candidate", openingStatus: "unknown" });
  const result = scoreMenu({
    branch,
    menu: branch.menus[0],
    intent: emptyIntent,
    mode: "balanced",
    distanceKm: 3,
    radiusKm: 3,
  });
  // taste 40 + distance 0 + opening (0.45 * 20) + trust (0.35 * 10)
  assert.equal(result?.score, 53);
});

test("taste proximity scores body and spiciness over their complete ranges", () => {
  const branch = makeBranch();
  const result = scoreMenu({
    branch,
    menu: makeMenu({
      ramenTypes: [], brothStyle: null, brothBases: [], bodyLevel: 5, spicinessLevel: 5,
    }),
    intent: { ...emptyIntent, bodyTarget: 1, spicinessTarget: 0 },
    mode: "taste",
    distanceKm: 3,
    radiusKm: 3,
  });
  // both taste proximity dimensions are zero; only opening and trust contribute
  assert.equal(result?.score, 20);
});

test("taste reasons never claim closeness without a positive known profile match", () => {
  const branch = makeBranch();
  const oppositeBody = scoreMenu({
    branch,
    menu: makeMenu({ ramenTypes: [], brothStyle: null, brothBases: [], bodyLevel: 5, spicinessLevel: null }),
    intent: { ...emptyIntent, bodyTarget: 1 },
    mode: "taste",
    distanceKm: 0,
    radiusKm: 3,
  });
  const unknownSpiciness = scoreMenu({
    branch,
    menu: makeMenu({ ramenTypes: [], brothStyle: null, brothBases: [], bodyLevel: null, spicinessLevel: null }),
    intent: { ...emptyIntent, spicinessTarget: 4 },
    mode: "taste",
    distanceKm: 0,
    radiusKm: 3,
  });
  assert.equal(oppositeBody?.reasons[0], "취향 일치 정보가 확인되지 않았어요");
  assert.equal(unknownSpiciness?.reasons[0], "취향 일치 정보가 확인되지 않았어요");

  for (const bodyLevel of [5, null] as const) {
    const partiallyMatched = scoreMenu({
      branch,
      menu: makeMenu({ ramenTypes: [], brothStyle: null, brothBases: [], bodyLevel, spicinessLevel: 4 }),
      intent: { ...emptyIntent, bodyTarget: 1, spicinessTarget: 4 },
      mode: "taste",
      distanceKm: 0,
      radiusKm: 3,
    });
    assert.equal(partiallyMatched?.reasons[0], "원하는 맵기에 가까운 프로필이에요");
  }
});

test("rejects a menu that violates the avoid-spicy hard constraint", () => {
  const branch = makeBranch();
  assert.equal(scoreMenu({
    branch,
    menu: makeMenu({ spicinessLevel: 2 }),
    intent: { ...emptyIntent, avoidSpicy: true },
    mode: "taste",
    distanceKm: 0,
    radiusKm: 3,
  }), null);
});

test("returns verified results separately from stale and candidate suggestions", () => {
  const branches = [
    ...makeScenarioBranches(),
    makeBranch({ id: "stale", lat: 37.405, verificationStatus: "stale" }),
  ];
  const response = recommend(branches, {
    origin,
    mode: "balanced",
    quick: false,
    intent: parseTasteIntent("시오 청탕", {}),
  });
  assert.ok(response.verified.every((item) => item.branch.verificationStatus === "verified"));
  assert.ok(response.candidates.every((item) => item.branch.verificationStatus !== "verified"));
  assert.ok(response.candidates.some((item) => item.branch.verificationStatus === "stale"));
  assert.ok(response.candidates.some((item) => item.branch.verificationStatus === "candidate"));
});

test("a verified branch uses only a verified representative menu", () => {
  const branch = makeBranch({
    id: "mixed-verification",
    menus: [
      makeMenu({
        id: "candidate-perfect",
        verificationStatus: "candidate",
      }),
      makeMenu({
        id: "verified-fallback",
        ramenTypes: ["tonkotsu"],
        brothStyle: "paitan",
        verificationStatus: "verified",
      }),
    ],
  });
  const response = recommend([branch], {
    origin, mode: "taste", quick: false, intent: parseTasteIntent("시오 청탕", {}),
  });
  assert.equal(response.verified[0]?.menuId, "verified-fallback");
  assert.ok(response.candidates.every((item) => item.branch.verificationStatus !== "verified"));
});

test("does not relax an avoid-spicy hard constraint", () => {
  const response = recommend(makeScenarioBranches(), {
    origin,
    mode: "distance",
    quick: true,
    intent: parseTasteIntent("맵찔이라 안 매운 것", {}),
  });
  assert.ok([...response.verified, ...response.candidates].every((item) => {
    const menu = item.branch.menus.find((value) => value.id === item.menuId);
    return menu?.spicinessLevel !== null && menu?.spicinessLevel !== undefined && menu.spicinessLevel <= 1;
  }));
});

test("uses the smallest approved radius containing three eligible branches", () => {
  const response = recommend(makeScenarioBranches(), {
    origin,
    mode: "balanced",
    quick: false,
    intent: emptyIntent,
  });
  assert.equal(response.radiusKm, 3);
  assert.equal(response.expanded, false);

  const expanded = recommend(makeScenarioBranches().slice(1), {
    origin,
    mode: "balanced",
    quick: false,
    intent: emptyIntent,
  });
  assert.equal(expanded.radiusKm, 10);
  assert.equal(expanded.expanded, true);
});

test("falls back to 30km when fewer than three eligible branches exist", () => {
  const response = recommend(makeScenarioBranches().slice(0, 2), {
    origin,
    mode: "balanced",
    quick: false,
    intent: emptyIntent,
  });
  assert.equal(response.radiusKm, 30);
  assert.equal(response.expanded, true);
});

test("returns a stable empty response", () => {
  assert.deepEqual(recommend([], {
    origin, mode: "balanced", quick: false, intent: emptyIntent,
  }), {
    radiusKm: 30,
    verified: [],
    candidates: [],
    expanded: true,
  });
});

test("includes branches exactly on the 10km and 30km boundaries", () => {
  const latitudeAt = (kilometers: number) => origin.lat + kilometers / 6371.0088 * 180 / Math.PI;
  const ten = recommend([
    makeBranch({ id: "ten-near", lat: latitudeAt(1) }),
    makeBranch({ id: "ten-middle", lat: latitudeAt(9) }),
    makeBranch({ id: "ten-boundary", lat: latitudeAt(10) }),
  ], { origin, mode: "distance", quick: false, intent: emptyIntent });
  assert.equal(ten.radiusKm, 10);
  assert.ok(ten.verified.some((item) => item.branch.id === "ten-boundary"));

  const thirty = recommend([
    makeBranch({ id: "thirty-near", lat: latitudeAt(1) }),
    makeBranch({ id: "thirty-middle", lat: latitudeAt(29) }),
    makeBranch({ id: "thirty-boundary", lat: latitudeAt(30) }),
    makeBranch({ id: "thirty-outside", lat: latitudeAt(30.001) }),
  ], { origin, mode: "distance", quick: false, intent: emptyIntent });
  assert.equal(thirty.radiusKm, 30);
  assert.ok(thirty.verified.some((item) => item.branch.id === "thirty-boundary"));
  assert.ok(!thirty.verified.some((item) => item.branch.id === "thirty-outside"));
});

test("excludes branches outside the selected radius using exact haversine distance", () => {
  const branches = [
    makeBranch({ id: "inside-1", lat: 37.39 + (2.99 / 111.2) }),
    makeBranch({ id: "inside-2", lat: 37.39 - (2.99 / 111.2) }),
    makeBranch({ id: "inside-3", lat: 37.39, lng: 126.96 + (2.99 / 88.2) }),
    makeBranch({ id: "outside", lat: 37.39 + (3.01 / 111.2) }),
  ];
  const response = recommend(branches, { origin, mode: "distance", quick: false, intent: emptyIntent });
  assert.equal(response.radiusKm, 3);
  assert.deepEqual(response.verified.map((item) => item.branch.id).sort(), ["inside-1", "inside-2", "inside-3"]);
});

test("quick recommendations exclude closed branches while exploration retains them", () => {
  const branches = [
    makeBranch({ id: "closed", openingStatus: "closed", lat: 37.3901 }),
    makeBranch({ id: "open", lat: 37.4 }),
  ];
  const quick = recommend(branches, { origin, mode: "distance", quick: true, intent: emptyIntent });
  const exploration = recommend(branches, { origin, mode: "distance", quick: false, intent: emptyIntent });
  assert.ok(!quick.verified.some((item) => item.branch.id === "closed"));
  assert.ok(exploration.verified.some((item) => item.branch.id === "closed"));
});

test("quick hunger with no taste preference chooses the nearby menu", () => {
  const response = recommend([
    makeBranch({ id: "near", lat: 37.391, menus: [makeMenu({ id: "near-rich", brothStyle: "paitan" })] }),
    makeBranch({ id: "far", lat: 37.41, menus: [makeMenu({ id: "far-light", brothStyle: "chintan" })] }),
  ], { origin, mode: "distance", quick: true, intent: emptyIntent });
  assert.equal(response.verified[0]?.branch.id, "near");
});

test("exploration keeps the requested area origin instead of replacing it with nearby context", () => {
  const area = { id: "busan", name: "부산", kind: "district" as const, lat: 35.1796, lng: 129.0756 };
  const response = recommend([
    makeBranch({ id: "anyang", lat: 37.391, lng: 126.96 }),
    makeBranch({ id: "busan", region: "부산", district: "부산진", lat: 35.18, lng: 129.0756 }),
  ], { origin: { lat: area.lat, lng: area.lng }, area, mode: "balanced", quick: false, intent: emptyIntent });
  assert.equal(response.verified[0]?.branch.id, "busan");
});

test("evaluates available and unknown menus but excludes seasonal and sold-out menus", () => {
  const branch = makeBranch({ menus: [
    makeMenu({ id: "sold-out-perfect", availabilityStatus: "sold_out" }),
    makeMenu({ id: "seasonal-perfect", availabilityStatus: "seasonal" }),
    makeMenu({ id: "unknown-menu", ramenTypes: ["tonkotsu"], brothStyle: "paitan", availabilityStatus: "unknown" }),
  ] });
  const response = recommend([branch], { origin, mode: "taste", quick: false, intent: parseTasteIntent("시오 청탕", {}) });
  assert.equal(response.verified[0]?.menuId, "unknown-menu");
});

test("rejected branches and rejected menus can never enter output", () => {
  const rejectedBranch = makeBranch({ id: "rejected-branch", verificationStatus: "rejected" });
  const rejectedMenu = makeBranch({ id: "rejected-menu", menus: [makeMenu({ id: "bad-menu", verificationStatus: "rejected" })] });
  const good = makeBranch({ id: "good" });
  const response = recommend([rejectedBranch, rejectedMenu, good], {
    origin, mode: "balanced", quick: false, intent: emptyIntent,
  });
  assert.deepEqual(response.verified.map((item) => item.branch.id), ["good"]);
  assert.deepEqual(response.candidates, []);
});

test("picks the highest-scoring eligible menu per branch", () => {
  const branch = makeBranch({ menus: [
    makeMenu({ id: "paitan", ramenTypes: ["tonkotsu"], brothStyle: "paitan" }),
    makeMenu({ id: "chintan", ramenTypes: ["shio"], brothStyle: "chintan" }),
  ] });
  const response = recommend([branch], { origin, mode: "taste", quick: false, intent: parseTasteIntent("시오 청탕", {}) });
  assert.equal(response.verified[0]?.menuId, "chintan");
});

test("breaks equal menu scores by menu ID within a branch", () => {
  const branch = makeBranch({ menus: [
    makeMenu({ id: "menu-z" }),
    makeMenu({ id: "menu-a" }),
  ] });
  const response = recommend([branch], { origin, mode: "balanced", quick: false, intent: emptyIntent });
  assert.equal(response.verified[0]?.menuId, "menu-a");
});

test("sorts by score, then distance, then stable identifiers and caps each group at three", () => {
  const branches = Array.from({ length: 8 }, (_, index) => makeBranch({
    id: `branch-${String(index).padStart(2, "0")}`,
    lat: 37.395,
    verificationStatus: index < 4 ? "verified" : "candidate",
    menus: [makeMenu({
      id: `menu-${String(7 - index).padStart(2, "0")}`,
      verificationStatus: index < 4 ? "verified" : "candidate",
    })],
  }));
  const response = recommend(branches.reverse(), { origin, mode: "balanced", quick: false, intent: emptyIntent });
  assert.deepEqual(response.verified.map((item) => item.branch.id), ["branch-00", "branch-01", "branch-02"]);
  assert.deepEqual(response.candidates.map((item) => item.branch.id), ["branch-04", "branch-05", "branch-06"]);
});
