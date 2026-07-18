import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAdminBranchMutation,
  parseAdminCandidateCreation,
} from "../features/admin/request.ts";

const menu = {
  name: "시오 라멘",
  price: 12_000,
  availabilityStatus: "available",
  verificationStatus: "verified",
  ramenTypes: ["shio"],
  brothStyle: "chintan",
  bodyLevel: 2,
  spicinessLevel: 0,
  brothBases: ["닭"],
  tags: ["깔끔"],
};

const weeklyHour = {
  weekday: 1,
  opensAt: "11:00",
  closesAt: "21:00",
  breakStartsAt: null,
  breakEndsAt: null,
  lastOrderAt: "20:30",
  isClosed: false,
};

const validMutations = [
  {
    action: "updateBranch",
    note: "공식 정보 재확인",
    branch: {
      branchName: null,
      region: "서울",
      district: "마포구",
      address: "서울 마포구 테스트로 1",
      lat: 37.55,
      lng: 126.91,
      phone: null,
      hoursText: null,
      weeklyHours: [weeklyHour],
    },
  },
  { action: "createMenu", note: "메뉴 확인", menu },
  { action: "updateMenu", note: "메뉴 확인", menuId: "menu:test:signature", menu },
  {
    action: "appendEvidence",
    note: "출처 확인",
    evidence: {
      entityType: "branch",
      fieldName: "address",
      sourceName: "공식 사이트",
      sourceUrl: "https://example.com/shop",
      checkedAt: "2026-07-18",
      note: "주소 확인",
    },
  },
  {
    action: "transitionState",
    transition: {
      entityType: "branch",
      verificationStatus: "verified",
      publicStatus: "active",
      note: "승인",
    },
  },
] as const;

test("parses and normalizes every authenticated branch mutation shape", () => {
  for (const input of validMutations) {
    const parsed = parseAdminBranchMutation(input, "branch:test");
    assert.equal(parsed.action, input.action);
  }
  const evidence = parseAdminBranchMutation(validMutations[3], "branch:test");
  assert.equal(evidence.action, "appendEvidence");
  if (evidence.action === "appendEvidence") assert.equal(evidence.evidence.entityId, "branch:test");
});

test("rejects malformed nested values for every admin action", () => {
  const invalid = [
    { ...validMutations[0], branch: null },
    { ...validMutations[0], branch: { ...validMutations[0].branch, lat: 91 } },
    { ...validMutations[0], branch: { ...validMutations[0].branch, lng: "126.91" } },
    { ...validMutations[0], branch: { ...validMutations[0].branch, region: "가".repeat(81) } },
    { ...validMutations[0], branch: { ...validMutations[0].branch, weeklyHours: [{ ...weeklyHour, opensAt: "25:00" }] } },
    { ...validMutations[1], menu: { ...menu, price: -1 } },
    { ...validMutations[1], menu: { ...menu, price: 1.5 } },
    { ...validMutations[1], menu: { ...menu, ramenTypes: ["udon"] } },
    { ...validMutations[1], menu: { ...menu, availabilityStatus: "private" } },
    { ...validMutations[2], menuId: "../../menu" },
    { ...validMutations[3], evidence: { ...validMutations[3].evidence, checkedAt: "2026-02-30" } },
    { ...validMutations[4], transition: { ...validMutations[4].transition, publicStatus: "published" } },
  ];
  for (const input of invalid) {
    assert.throws(() => parseAdminBranchMutation(input, "branch:test"), /확인|이하여야|형식/);
  }
});

test("allows only http and https evidence URLs", () => {
  for (const sourceUrl of ["javascript:alert(1)", "data:text/html,unsafe", "ftp://example.com/file"]) {
    assert.throws(() => parseAdminBranchMutation({
      ...validMutations[3],
      evidence: { ...validMutations[3].evidence, sourceUrl },
    }, "branch:test"), /URL/);
  }
});

const validCandidate = {
  note: "신규 후보 수집",
  candidate: {
    shopId: "shop:new-ramen",
    branchId: "branch:new-ramen",
    slug: "new-ramen",
    shopName: "  새 라멘  ",
    branchName: null,
    region: "서울",
    district: "마포구",
    address: "서울 마포구 테스트로 2",
    lat: 37.55,
    lng: 126.91,
    phone: null,
    sourceName: "공식 사이트",
    sourceUrl: "https://example.com/new-ramen",
    checkedAt: "2026-07-18",
    evidenceNote: "주소와 상호 확인",
  },
};

test("parses a bounded normalized candidate creation payload", () => {
  const parsed = parseAdminCandidateCreation(validCandidate);
  assert.equal(parsed.candidate.shopName, "새 라멘");
  assert.equal(parsed.candidate.shopId, "shop:new-ramen");
  assert.equal(parsed.candidate.branchId, "branch:new-ramen");
});

test("rejects invalid candidate identifiers, coordinates, dates, and URL schemes", () => {
  for (const candidate of [
    { ...validCandidate.candidate, shopId: "shop:New Ramen" },
    { ...validCandidate.candidate, branchId: "new-ramen" },
    { ...validCandidate.candidate, slug: "새-라멘" },
    { ...validCandidate.candidate, lat: null },
    { ...validCandidate.candidate, lng: 181 },
    { ...validCandidate.candidate, checkedAt: "2026-13-01" },
    { ...validCandidate.candidate, sourceUrl: "file:///etc/passwd" },
  ]) {
    assert.throws(() => parseAdminCandidateCreation({ ...validCandidate, candidate }), /확인|URL/);
  }
});
