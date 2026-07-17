import type { Area, BrothBase, BrothStyle, PublicBranchSummary, RamenType, RecommendationMode } from "./ramen.ts";

export interface Coordinates { lat: number; lng: number }
export interface TasteIntent {
  ramenTypes: RamenType[];
  brothStyles: BrothStyle[];
  brothBases: BrothBase[];
  bodyTarget: number | null;
  spicinessTarget: number | null;
  avoidRich: boolean;
  avoidSpicy: boolean;
  wantsKarai: boolean;
  freeText: string;
}
export interface RecommendationRequest {
  origin: Coordinates;
  area?: Area;
  mode: RecommendationMode;
  quick: boolean;
  intent: TasteIntent;
}
export interface RecommendationItem {
  branch: PublicBranchSummary;
  menuId: string;
  score: number;
  distanceKm: number;
  reasons: string[];
}
export interface RecommendationResponse {
  radiusKm: 3 | 10 | 30;
  verified: RecommendationItem[];
  candidates: RecommendationItem[];
  expanded: boolean;
}
