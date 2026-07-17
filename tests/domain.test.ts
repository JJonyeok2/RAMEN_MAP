import assert from "node:assert/strict";
import test from "node:test";
import type { BranchSummary, MenuItem, PublicBranchSummary, ShopDetail } from "../domain/ramen.ts";
import type { ShopRepository } from "../domain/shop-repository.ts";
import {
  effectiveVerificationStatus,
  isPublicBranch,
  recommendationModes,
  searchRadiiKm,
  verificationStatuses,
} from "../domain/ramen.ts";

function acceptsPublicBranch(branch: PublicBranchSummary): void {
  void branch;
}

function validatesPublicTypeContracts(
  fullBranch: BranchSummary,
  rejectedBranch: BranchSummary & {
    publicStatus: "active";
    verificationStatus: "rejected";
  },
  rejectedMenuBranch: BranchSummary & {
    publicStatus: "active";
    verificationStatus: "candidate";
    menus: Array<MenuItem & { verificationStatus: "rejected" }>;
  },
  rejectedShop: ShopDetail & {
    publicStatus: "active";
    verificationStatus: "rejected";
  },
): void {
  if (isPublicBranch(fullBranch)) {
    acceptsPublicBranch(fullBranch);
  }

  type PublicBranches = Awaited<ReturnType<ShopRepository["listPublicBranches"]>>;
  type PublicShop = Awaited<ReturnType<ShopRepository["getPublicShopBySlug"]>>;

  // @ts-expect-error Public repository results exclude rejected branches.
  const rejectedPublicBranches: PublicBranches = [rejectedBranch];
  // @ts-expect-error Public repository results exclude rejected menus.
  const rejectedMenuPublicBranches: PublicBranches = [rejectedMenuBranch];
  // @ts-expect-error Public repository details exclude rejected branches.
  const rejectedPublicShop: PublicShop = rejectedShop;

  void rejectedPublicBranches;
  void rejectedMenuPublicBranches;
  void rejectedPublicShop;
}

void validatesPublicTypeContracts;

test("publishes only active real branches with usable coordinates", () => {
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "candidate", lat: 37.3, lng: 126.9 }), true);
  assert.equal(isPublicBranch({ publicStatus: "closed", verificationStatus: "verified", lat: 37.3, lng: 126.9 }), false);
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "rejected", lat: 37.3, lng: 126.9 }), false);
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "verified", lat: null, lng: null }), false);
  assert.equal(isPublicBranch({
    publicStatus: "active",
    verificationStatus: "candidate",
    lat: 37.3,
    lng: 126.9,
    menus: [{ verificationStatus: "rejected" }],
  } as BranchSummary), false);
});

test("locks the approved search and recommendation vocabulary", () => {
  assert.deepEqual(searchRadiiKm, [3, 10, 30]);
  assert.deepEqual(recommendationModes, ["taste", "balanced", "distance"]);
  assert.deepEqual(verificationStatuses, ["verified", "candidate", "stale", "rejected"]);
});

test("marks old verified facts stale using entity-specific windows", () => {
  const now = new Date("2026-07-17T00:00:00.000Z");
  assert.equal(effectiveVerificationStatus("verified", "2026-01-01T00:00:00.000Z", "branch", now), "stale");
  assert.equal(effectiveVerificationStatus("verified", "2026-04-01T00:00:00.000Z", "menu", now), "verified");
});
