import type { D1DatabaseLike } from "../d1.ts";
import type { AreaRow } from "../schema.ts";
import {
  effectiveVerificationStatus,
  type Area,
  type BrothBase,
  type BrothStyle,
  type PublicBranchSummary,
  type PublicMenuItem,
  type PublicShopDetail,
  type PublicVerificationStatus,
  type RamenType,
} from "../../domain/ramen.ts";
import type { Coordinates } from "../../domain/recommendation.ts";
import type { ShopRepository } from "../../domain/shop-repository.ts";
import { distanceKm } from "../../features/location/distance.ts";
import { openingStatusAt, type OpeningStatusHours } from "../../features/shops/opening-status.ts";

type JoinedBranchRow = Record<string, unknown>;
type MappedBranch = { branch: PublicBranchSummary; hoursText: string | null };

const publicStatuses = new Set<PublicVerificationStatus>(["verified", "candidate", "stale"]);
const ramenTypes = new Set<RamenType>(["shoyu", "shio", "miso", "tonkotsu", "tsukemen", "mazesoba"]);
const brothStyles = new Set<BrothStyle>(["chintan", "paitan", "dry", "dipping"]);
const brothBases = new Set<BrothBase>(["닭", "돼지", "소", "해산물", "채소"]);

const branchSelect = `
  SELECT
    b.id AS branch_id, b.slug, s.name AS shop_name, b.branch_name, b.region, b.district,
    b.address, b.lat, b.lng, b.phone, b.public_status, b.verification_status,
    b.hours_text, b.last_verified_at,
    COALESCE((
      SELECT json_group_array(json_object(
        'weekday', oh.weekday, 'opens_at', oh.opens_at, 'closes_at', oh.closes_at,
        'break_starts_at', oh.break_starts_at, 'break_ends_at', oh.break_ends_at,
        'is_closed', oh.is_closed
      ))
      FROM opening_hours oh WHERE oh.branch_id = b.id
    ), '[]') AS opening_hours_json,
    m.id AS menu_id, m.name AS menu_name, m.price, m.availability_status,
    m.verification_status AS menu_verification_status, m.last_verified_at AS menu_last_verified_at,
    p.ramen_types, p.broth_style, p.body_level, p.spiciness_level, p.broth_bases, p.tags
  FROM branches b
  JOIN shops s ON s.id = b.shop_id
  LEFT JOIN menu_items m ON m.branch_id = b.id
    AND m.verification_status IN ('verified', 'candidate', 'stale')
  LEFT JOIN menu_profiles p ON p.menu_item_id = m.id
`;

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function enumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>): T[] {
  return parseStringArray(value).filter((item): item is T => allowed.has(item as T));
}

function publicVerificationStatus(value: unknown, checkedAt: string | null, entity: "branch" | "menu", now: Date): PublicVerificationStatus | null {
  if (typeof value !== "string" || !publicStatuses.has(value as PublicVerificationStatus)) return null;
  const effective = effectiveVerificationStatus(value as PublicVerificationStatus, checkedAt, entity, now);
  return publicStatuses.has(effective as PublicVerificationStatus) ? effective as PublicVerificationStatus : null;
}

function level(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function openingHours(value: unknown): OpeningStatusHours[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row): OpeningStatusHours[] => {
      if (typeof row !== "object" || row === null) return [];
      const item = row as Record<string, unknown>;
      const weekday = level(item.weekday, 0, 6);
      const isClosed = item.is_closed === 0 || item.is_closed === 1 ? item.is_closed : null;
      if (weekday === null || isClosed === null) return [];
      const time = (name: string) => nullableString(item[name]);
      return [{
        weekday,
        opens_at: time("opens_at"),
        closes_at: time("closes_at"),
        break_starts_at: time("break_starts_at"),
        break_ends_at: time("break_ends_at"),
        is_closed: isClosed,
      }];
    });
  } catch {
    return [];
  }
}

function menuFromRow(row: JoinedBranchRow, now: Date): PublicMenuItem | null {
  const id = stringValue(row.menu_id);
  const name = stringValue(row.menu_name);
  const availabilityStatus = stringValue(row.availability_status);
  const lastVerifiedAt = nullableString(row.menu_last_verified_at);
  const verificationStatus = publicVerificationStatus(row.menu_verification_status, lastVerifiedAt, "menu", now);
  if (!id || !name || !verificationStatus || !["available", "seasonal", "sold_out", "unknown"].includes(availabilityStatus ?? "")) return null;

  const brothStyle = stringValue(row.broth_style);
  return {
    id,
    name,
    price: finiteNumber(row.price),
    ramenTypes: enumArray(row.ramen_types, ramenTypes),
    brothStyle: brothStyle && brothStyles.has(brothStyle as BrothStyle) ? brothStyle as BrothStyle : null,
    bodyLevel: level(row.body_level, 1, 5) as PublicMenuItem["bodyLevel"],
    spicinessLevel: level(row.spiciness_level, 0, 5) as PublicMenuItem["spicinessLevel"],
    brothBases: enumArray(row.broth_bases, brothBases),
    tags: parseStringArray(row.tags),
    availabilityStatus: availabilityStatus as PublicMenuItem["availabilityStatus"],
    verificationStatus,
    lastVerifiedAt,
  };
}

function mapBranchDetails(rows: readonly JoinedBranchRow[], now: Date): MappedBranch[] {
  const branches = new Map<string, MappedBranch>();
  const menuIds = new Map<string, Set<string>>();

  for (const row of rows) {
    const id = stringValue(row.branch_id);
    const slug = stringValue(row.slug);
    const shopName = stringValue(row.shop_name);
    const branchName = nullableString(row.branch_name);
    const region = stringValue(row.region);
    const district = stringValue(row.district);
    const address = stringValue(row.address);
    const lat = finiteNumber(row.lat);
    const lng = finiteNumber(row.lng);
    const lastVerifiedAt = nullableString(row.last_verified_at);
    const verificationStatus = publicVerificationStatus(row.verification_status, lastVerifiedAt, "branch", now);
    if (
      !id || !slug || !shopName || branchName === null && row.branch_name !== null && row.branch_name !== undefined
      || !region || !district || !address || lat === null || lng === null
      || row.public_status !== "active" || !verificationStatus
    ) continue;

    let mapped = branches.get(id);
    if (!mapped) {
      mapped = {
        branch: {
          id,
          slug,
          shopName,
          branchName,
          region,
          district,
          address,
          lat,
          lng,
          phone: nullableString(row.phone),
          publicStatus: "active",
          verificationStatus,
          lastVerifiedAt,
          openingStatus: openingStatusAt(openingHours(row.opening_hours_json), now),
          menus: [],
        },
        hoursText: nullableString(row.hours_text),
      };
      branches.set(id, mapped);
      menuIds.set(id, new Set());
    }

    const menu = menuFromRow(row, now);
    const ids = menuIds.get(id)!;
    if (menu && !ids.has(menu.id)) {
      mapped.branch.menus.push(menu);
      ids.add(menu.id);
    }
  }
  return [...branches.values()];
}

export function mapBranchRows(rows: readonly JoinedBranchRow[], now = new Date()): PublicBranchSummary[] {
  return mapBranchDetails(rows, now).map(({ branch }) => branch);
}

function mapArea(row: AreaRow): Area | null {
  if (!["district", "neighborhood", "station"].includes(row.kind) || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  return { id: row.id, name: row.name, kind: row.kind, lat: row.lat, lng: row.lng };
}

function mapEvidence(rows: readonly Record<string, unknown>[]): PublicShopDetail["evidence"] {
  return rows.flatMap((row) => {
    const id = stringValue(row.id);
    const sourceName = stringValue(row.source_name);
    const sourceUrl = stringValue(row.source_url);
    const checkedAt = stringValue(row.checked_at);
    const note = stringValue(row.note);
    return id && sourceName && sourceUrl && checkedAt && note !== null
      ? [{ id, sourceName, sourceUrl, checkedAt, note }]
      : [];
  });
}

export function createD1ShopRepository(
  db: D1DatabaseLike,
  clock: Date | (() => Date) = () => new Date(),
): ShopRepository {
  const now = () => clock instanceof Date ? clock : clock();

  return {
    async listAreas() {
      const result = await db.prepare("SELECT id, name, kind, lat, lng FROM areas ORDER BY name").all<AreaRow>();
      return (result.results ?? []).flatMap((row) => {
        const area = mapArea(row);
        return area ? [area] : [];
      });
    },

    async listPublicBranches(origin: Coordinates, radiusKm: 3 | 10 | 30) {
      if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return [];
      const latitudeDelta = radiusKm / 110.574;
      const longitudeDelta = radiusKm / (111.320 * Math.max(Math.abs(Math.cos(origin.lat * Math.PI / 180)), 0.01));
      const result = await db.prepare(`${branchSelect}
        WHERE b.public_status = 'active'
          AND b.verification_status IN ('verified', 'candidate', 'stale')
          AND b.lat IS NOT NULL AND b.lng IS NOT NULL
          AND b.lat BETWEEN ? AND ?
          AND b.lng BETWEEN ? AND ?
        ORDER BY b.id, m.id
      `).bind(
        origin.lat - latitudeDelta,
        origin.lat + latitudeDelta,
        origin.lng - longitudeDelta,
        origin.lng + longitudeDelta,
      ).all<JoinedBranchRow>();

      return mapBranchRows(result.results ?? [], now())
        .filter((branch) => distanceKm(origin, branch) <= radiusKm);
    },

    async getPublicShopBySlug(slug: string) {
      const result = await db.prepare(`${branchSelect}
        WHERE b.slug = ?
          AND b.public_status = 'active'
          AND b.verification_status IN ('verified', 'candidate', 'stale')
          AND b.lat IS NOT NULL AND b.lng IS NOT NULL
        ORDER BY m.id
      `).bind(slug).all<JoinedBranchRow>();
      const mapped = mapBranchDetails(result.results ?? [], now())[0];
      if (!mapped) return null;

      const evidence = await db.prepare(`
        SELECT id, source_name, source_url, checked_at, note
        FROM source_evidence
        WHERE entity_type = 'branch' AND entity_id = ?
        ORDER BY checked_at DESC
      `).bind(mapped.branch.id).all<Record<string, unknown>>();
      return { ...mapped.branch, evidence: mapEvidence(evidence.results ?? []), hoursText: mapped.hoursText };
    },
  };
}
