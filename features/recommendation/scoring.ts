import type { TasteIntent } from "../../domain/recommendation.ts";
import type { BranchSummary, MenuItem, RecommendationMode, VerificationStatus } from "../../domain/ramen.ts";
import { modeWeights } from "./config.ts";

export interface ScoreMenuInput {
  branch: Pick<BranchSummary, "openingStatus" | "verificationStatus">;
  menu: MenuItem;
  intent: TasteIntent;
  mode: RecommendationMode;
  distanceKm: number;
  radiusKm: 3 | 10 | 30;
}

export interface MenuScore {
  score: number;
  reasons: [string, string];
}

const trustValues: Record<VerificationStatus, number> = {
  verified: 1,
  stale: 0.55,
  candidate: 0.35,
  rejected: 0,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isKaraiProfile(menu: MenuItem): boolean {
  const description = `${menu.name} ${menu.tags.join(" ")}`;
  return /(?:카라이|매운|매콤|얼큰|spicy)/i.test(description) || (menu.spicinessLevel ?? -1) >= 3;
}

function profileProximity(value: number | null, target: number | null, range: number): number | null {
  return value === null || target === null ? null : clamp(1 - Math.abs(value - target) / range);
}

function tasteScore(menu: MenuItem, intent: TasteIntent): number {
  const components: number[] = [];
  if (intent.ramenTypes.length > 0) {
    components.push(intent.ramenTypes.some((type) => menu.ramenTypes.includes(type)) ? 1 : 0);
  }
  if (intent.brothStyles.length > 0) {
    components.push(menu.brothStyle !== null && intent.brothStyles.includes(menu.brothStyle) ? 1 : 0);
  }
  if (intent.brothBases.length > 0) {
    components.push(intent.brothBases.some((base) => menu.brothBases.includes(base)) ? 1 : 0);
  }
  if (intent.bodyTarget !== null) {
    components.push(profileProximity(menu.bodyLevel, intent.bodyTarget, 4) ?? 0);
  }
  if (intent.spicinessTarget !== null) {
    components.push(profileProximity(menu.spicinessLevel, intent.spicinessTarget, 5) ?? 0);
  }
  if (intent.wantsKarai) components.push(isKaraiProfile(menu) ? 1 : 0);
  return components.length === 0 ? 1 : components.reduce((sum, value) => sum + value, 0) / components.length;
}

function tasteReason(menu: MenuItem, intent: TasteIntent): string {
  if (intent.wantsKarai && isKaraiProfile(menu)) return "카라이·매운맛 메뉴 취향과 맞아요";
  if (menu.brothStyle !== null && intent.brothStyles.includes(menu.brothStyle)) return "요청한 국물 스타일과 잘 맞아요";
  if (intent.ramenTypes.some((type) => menu.ramenTypes.includes(type))) return "요청한 라멘 종류와 잘 맞아요";
  if (intent.brothBases.some((base) => menu.brothBases.includes(base))) return "원하는 육수 재료와 잘 맞아요";
  const bodyIsClose = (profileProximity(menu.bodyLevel, intent.bodyTarget, 4) ?? -1) >= 0.5;
  const spicinessIsClose = (profileProximity(menu.spicinessLevel, intent.spicinessTarget, 5) ?? -1) >= 0.5;
  if (bodyIsClose && spicinessIsClose) return "원하는 농도와 맵기에 가까운 프로필이에요";
  if (bodyIsClose) return "원하는 농도에 가까운 프로필이에요";
  if (spicinessIsClose) return "원하는 맵기에 가까운 프로필이에요";
  const hasPreference = intent.ramenTypes.length > 0 || intent.brothStyles.length > 0
    || intent.brothBases.length > 0 || intent.bodyTarget !== null
    || intent.spicinessTarget !== null || intent.wantsKarai;
  return hasPreference ? "취향 일치 정보가 확인되지 않았어요" : "별도 취향 조건 없이 고른 메뉴예요";
}

export function scoreMenu(input: ScoreMenuInput): MenuScore | null {
  const { branch, menu, intent, mode, radiusKm } = input;
  if (intent.avoidSpicy && (menu.spicinessLevel === null || menu.spicinessLevel > 1)) return null;
  if (
    intent.excludedBrothBases.length > 0
    && (menu.brothBases.length === 0 || intent.excludedBrothBases.some((base) => menu.brothBases.includes(base)))
  ) return null;

  const taste = tasteScore(menu, intent);
  const distance = clamp(1 - input.distanceKm / radiusKm);
  const opening = branch.openingStatus === "open" ? 1 : branch.openingStatus === "unknown" ? 0.45 : 0;
  const trust = Math.min(trustValues[branch.verificationStatus], trustValues[menu.verificationStatus]);
  const weights = modeWeights[mode];
  const score = Math.round(
    taste * weights.taste
    + distance * weights.distance
    + opening * weights.opening
    + trust * weights.trust,
  );
  const openingText = branch.openingStatus === "open"
    ? "현재 영업 중"
    : branch.openingStatus === "closed" ? "현재 영업 종료" : "영업 여부 확인 필요";
  const trustText = trust === 1 ? "검증 완료" : trust === 0.55 ? "재확인 필요" : "검증 전 후보";

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: [tasteReason(menu, intent), `${input.distanceKm.toFixed(1)}km 거리 · ${openingText} · ${trustText}`],
  };
}
