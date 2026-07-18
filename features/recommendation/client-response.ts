import type { RecommendationItem, RecommendationResponse } from "../../domain/recommendation.ts";
import {
  brothBases,
  brothStyles,
  maxPublicAreas,
  maxPublicMenusPerBranch,
  ramenTypes,
  type Area,
  type PublicBranchSummary,
  type PublicMenuItem,
} from "../../domain/ramen.ts";

type UnknownRecord = Record<string, unknown>;

const areaIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const verificationStatuses = ["verified", "candidate", "stale"] as const;
const openingStatuses = ["open", "closed", "unknown"] as const;
const availabilityStatuses = ["available", "seasonal", "sold_out", "unknown"] as const;

function record(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
  return value as UnknownRecord;
}

function boundedString(value: unknown, maximum = 300): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new Error();
  return value;
}

function nullableString(value: unknown, maximum = 300): string | null {
  return value === null ? null : boundedString(value, maximum);
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  const parsed = finiteNumber(value, minimum, maximum);
  if (!Number.isInteger(parsed)) throw new Error();
  return parsed;
}

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  return value === null ? null : integer(value, minimum, maximum);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error();
  return value as T;
}

function radiusValue(value: unknown): 3 | 10 | 30 {
  if (value !== 3 && value !== 10 && value !== 30) throw new Error();
  return value;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value) || value.length > allowed.length) throw new Error();
  const parsed = value.map((item) => enumValue(item, allowed));
  if (new Set(parsed).size !== parsed.length) throw new Error();
  return parsed;
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  const parsed = boundedString(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed)) throw new Error();
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.slice(0, 10)) throw new Error();
  return parsed;
}

function parseMenu(value: unknown): PublicMenuItem {
  const input = record(value);
  const id = boundedString(input.id, 128);
  const price = input.price === null ? null : integer(input.price, 0, 1_000_000);
  const brothStyle = input.brothStyle === null ? null : enumValue(input.brothStyle, brothStyles);
  const tags = Array.isArray(input.tags) && input.tags.length <= 20
    ? input.tags.map((tag) => boundedString(tag, 80))
    : (() => { throw new Error(); })();
  return {
    id,
    name: boundedString(input.name, 200),
    price,
    ramenTypes: enumArray(input.ramenTypes, ramenTypes),
    brothStyle,
    bodyLevel: nullableInteger(input.bodyLevel, 1, 5) as PublicMenuItem["bodyLevel"],
    spicinessLevel: nullableInteger(input.spicinessLevel, 0, 5) as PublicMenuItem["spicinessLevel"],
    brothBases: enumArray(input.brothBases, brothBases),
    tags,
    availabilityStatus: enumValue(input.availabilityStatus, availabilityStatuses),
    verificationStatus: enumValue(input.verificationStatus, verificationStatuses),
    lastVerifiedAt: nullableDate(input.lastVerifiedAt),
  };
}

function parseBranch(value: unknown): PublicBranchSummary {
  const input = record(value);
  const verificationStatus = enumValue(input.verificationStatus, verificationStatuses);
  if (input.publicStatus !== "active" || !Array.isArray(input.menus) || input.menus.length > maxPublicMenusPerBranch) throw new Error();
  const slug = boundedString(input.slug, 100);
  if (!slugPattern.test(slug)) throw new Error();
  const menus = input.menus.map(parseMenu);
  if (new Set(menus.map((menu) => menu.id)).size !== menus.length) throw new Error();
  return {
    id: boundedString(input.id, 128),
    slug,
    shopName: boundedString(input.shopName, 200),
    branchName: nullableString(input.branchName, 120),
    region: boundedString(input.region, 80),
    district: boundedString(input.district, 100),
    address: boundedString(input.address, 300),
    lat: finiteNumber(input.lat, -90, 90),
    lng: finiteNumber(input.lng, -180, 180),
    phone: nullableString(input.phone, 40),
    publicStatus: "active",
    verificationStatus,
    lastVerifiedAt: nullableDate(input.lastVerifiedAt),
    openingStatus: enumValue(input.openingStatus, openingStatuses),
    menus,
  };
}

function parseItem(value: unknown, radiusKm: 3 | 10 | 30): RecommendationItem {
  const input = record(value);
  const branch = parseBranch(input.branch);
  const menuId = boundedString(input.menuId, 128);
  const menu = branch.menus.find((candidate) => candidate.id === menuId);
  if (!menu) throw new Error();
  if (branch.verificationStatus === "verified" && menu.verificationStatus !== "verified") throw new Error();
  if (!Array.isArray(input.reasons) || input.reasons.length < 1 || input.reasons.length > 2) throw new Error();
  return {
    branch,
    menuId,
    score: integer(input.score, 0, 100),
    distanceKm: finiteNumber(input.distanceKm, 0, radiusKm),
    reasons: input.reasons.map((reason) => boundedString(reason, 300)),
  };
}

export function parseAreasResponse(value: unknown): Area[] {
  try {
    const input = record(value);
    if (!Array.isArray(input.areas) || input.areas.length > maxPublicAreas) throw new Error();
    const areas = input.areas.map((value): Area => {
      const area = record(value);
      const id = boundedString(area.id, 64);
      if (!areaIdPattern.test(id)) throw new Error();
      return {
        id,
        name: boundedString(area.name, 100),
        kind: enumValue(area.kind, ["district", "neighborhood", "station"] as const),
        lat: finiteNumber(area.lat, -90, 90),
        lng: finiteNumber(area.lng, -180, 180),
      };
    });
    if (new Set(areas.map((area) => area.id)).size !== areas.length) throw new Error();
    return areas;
  } catch {
    throw new Error("지역 응답을 확인해 주세요.");
  }
}

export function parseRecommendationResponse(value: unknown): RecommendationResponse {
  try {
    const envelope = record(value);
    const input = record(envelope.result);
    const radiusKm = radiusValue(input.radiusKm);
    if (
      !Array.isArray(input.verified)
      || !Array.isArray(input.candidates)
      || input.verified.length > 3
      || input.candidates.length > Math.max(0, 3 - input.verified.length)
      || typeof input.expanded !== "boolean"
      || input.expanded !== (radiusKm !== 3)
    ) throw new Error();
    const verified = input.verified.map((item) => parseItem(item, radiusKm));
    const candidates = input.candidates.map((item) => parseItem(item, radiusKm));
    if (verified.some((item) => item.branch.verificationStatus !== "verified")) throw new Error();
    if (candidates.some((item) => item.branch.verificationStatus === "verified")) throw new Error();
    const ids = [...verified, ...candidates].map((item) => item.branch.id);
    if (new Set(ids).size !== ids.length) throw new Error();
    return { radiusKm, verified, candidates, expanded: input.expanded };
  } catch {
    throw new Error("추천 응답을 확인해 주세요.");
  }
}

/**
 * API error strings are rendered directly in the client. Keep that boundary as
 * strict as the successful-response parsers so an unexpected payload cannot
 * turn into unbounded or control-character content in the UI.
 */
export function parsePublicError(value: unknown, fallback: string): string {
  try {
    const input = record(value);
    return boundedString(input.error, 300);
  } catch {
    return fallback;
  }
}
