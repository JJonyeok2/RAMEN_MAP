import type { RecommendationItem, RecommendationRequest, RecommendationResponse } from "../../domain/recommendation.ts";
import { searchRadiiKm, type BranchSummary, type PublicBranchSummary, type PublicMenuItem } from "../../domain/ramen.ts";
import { distanceKm } from "../location/distance.ts";
import { scoreMenu } from "./scoring.ts";

type EligibleBranch = {
  branch: PublicBranchSummary;
  distanceKm: number;
  menus: PublicMenuItem[];
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function publicBranch(branch: BranchSummary): PublicBranchSummary | null {
  if (
    branch.publicStatus !== "active"
    || branch.verificationStatus === "rejected"
    || !Number.isFinite(branch.lat)
    || !Number.isFinite(branch.lng)
  ) return null;

  const menus = branch.menus.filter((menu): menu is PublicMenuItem => menu.verificationStatus !== "rejected");
  return { ...branch, menus } as PublicBranchSummary;
}

function compareItems(left: RecommendationItem, right: RecommendationItem): number {
  return right.score - left.score
    || left.distanceKm - right.distanceKm
    || compareIds(left.branch.id, right.branch.id)
    || compareIds(left.menuId, right.menuId);
}

export function recommend(
  branches: readonly BranchSummary[],
  request: RecommendationRequest,
): RecommendationResponse {
  const eligible: EligibleBranch[] = [];
  for (const source of branches) {
    const branch = publicBranch(source);
    if (!branch || (request.quick && branch.openingStatus === "closed")) continue;
    const menus = branch.menus.filter((menu) => (
      (menu.availabilityStatus === "available" || menu.availabilityStatus === "unknown")
      && (branch.verificationStatus !== "verified" || menu.verificationStatus === "verified")
      && !(request.intent.avoidSpicy && (menu.spicinessLevel === null || menu.spicinessLevel > 1))
      && !(
        request.intent.excludedBrothBases.length > 0
        && (menu.brothBases.length === 0 || request.intent.excludedBrothBases.some((base) => menu.brothBases.includes(base)))
      )
    ));
    if (menus.length === 0) continue;
    eligible.push({
      branch,
      distanceKm: distanceKm(request.origin, { lat: branch.lat, lng: branch.lng }),
      menus,
    });
  }

  const radiusKm = searchRadiiKm.find((radius) => (
    eligible.filter((value) => (
      value.branch.verificationStatus === "verified" && value.distanceKm <= radius
    )).length >= 3
  )) ?? 30;

  const items: RecommendationItem[] = [];
  for (const value of eligible) {
    if (value.distanceKm > radiusKm) continue;
    const scored = value.menus.map((menu) => ({
      menu,
      result: scoreMenu({
        branch: value.branch,
        menu,
        intent: request.intent,
        mode: request.mode,
        distanceKm: value.distanceKm,
        radiusKm,
      }),
    })).filter((entry) => entry.result !== null);

    scored.sort((left, right) => (
      (right.result?.score ?? 0) - (left.result?.score ?? 0)
      || compareIds(left.menu.id, right.menu.id)
    ));
    const best = scored[0];
    if (!best?.result) continue;
    items.push({
      branch: value.branch,
      menuId: best.menu.id,
      score: best.result.score,
      distanceKm: value.distanceKm,
      reasons: best.result.reasons,
    });
  }

  const verified = items.filter((item) => item.branch.verificationStatus === "verified").sort(compareItems).slice(0, 3);
  const candidates = items.filter((item) => item.branch.verificationStatus !== "verified")
    .sort(compareItems)
    .slice(0, Math.max(0, 3 - verified.length));
  return { radiusKm, verified, candidates, expanded: radiusKm !== 3 };
}
