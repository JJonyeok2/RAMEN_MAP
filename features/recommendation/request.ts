import type { RecommendationRequest } from "../../domain/recommendation.ts";
import {
  brothBases,
  brothStyles,
  ramenTypes,
  recommendationModes,
  type BrothBase,
  type BrothStyle,
  type RamenType,
} from "../../domain/ramen.ts";
import { parseTasteIntent, type PreferenceSelections } from "./intent-parser.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, message: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as UnknownRecord;
}

function onlyKeys(value: UnknownRecord, allowed: readonly string[], message: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(message);
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (
    !Array.isArray(value)
    || value.length > allowed.length
    || !value.every((item): item is T => typeof item === "string" && allowed.includes(item as T))
  ) {
    throw new Error("추천 선택 항목을 확인해 주세요.");
  }
  return [...new Set(value)];
}

function optionalLevel(value: unknown, minimum: number, maximum: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("추천 선택 항목을 확인해 주세요.");
  }
  return value as number;
}

function parseSelections(value: unknown): PreferenceSelections {
  if (value === undefined) return {};
  const input = record(value, "추천 선택 항목을 확인해 주세요.");
  onlyKeys(input, ["ramenTypes", "brothStyles", "brothBases", "bodyTarget", "spicinessTarget"], "추천 선택 항목을 확인해 주세요.");
  const selections: PreferenceSelections = {};
  if (input.ramenTypes !== undefined) selections.ramenTypes = enumArray<RamenType>(input.ramenTypes, ramenTypes);
  if (input.brothStyles !== undefined) selections.brothStyles = enumArray<BrothStyle>(input.brothStyles, brothStyles);
  if (input.brothBases !== undefined) selections.brothBases = enumArray<BrothBase>(input.brothBases, brothBases);
  if (input.bodyTarget !== undefined) selections.bodyTarget = optionalLevel(input.bodyTarget, 1, 5);
  if (input.spicinessTarget !== undefined) selections.spicinessTarget = optionalLevel(input.spicinessTarget, 0, 5);
  return selections;
}

export function parseRecommendationRequest(value: unknown): RecommendationRequest {
  const input = record(value, "요청 형식을 확인해 주세요.");
  onlyKeys(input, ["origin", "mode", "quick", "selections", "text"], "요청 형식을 확인해 주세요.");

  const origin = record(input.origin, "추천 위치를 확인해 주세요.");
  onlyKeys(origin, ["lat", "lng"], "추천 위치를 확인해 주세요.");
  if (
    typeof origin.lat !== "number" || !Number.isFinite(origin.lat) || origin.lat < -90 || origin.lat > 90
    || typeof origin.lng !== "number" || !Number.isFinite(origin.lng) || origin.lng < -180 || origin.lng > 180
  ) throw new Error("추천 위치를 확인해 주세요.");

  if (typeof input.mode !== "string" || !recommendationModes.includes(input.mode as RecommendationRequest["mode"])) {
    throw new Error("추천 방식을 확인해 주세요.");
  }
  if (typeof input.quick !== "boolean") throw new Error("빠른 추천 여부를 확인해 주세요.");
  if (input.text !== undefined && typeof input.text !== "string") throw new Error("추천 문장을 확인해 주세요.");
  const text = input.text ?? "";
  if (text.length > 500) throw new Error("추천 문장은 500자 이하여야 합니다.");

  return {
    origin: { lat: origin.lat, lng: origin.lng },
    mode: input.mode as RecommendationRequest["mode"],
    quick: input.quick,
    intent: parseTasteIntent(text, parseSelections(input.selections)),
  };
}
