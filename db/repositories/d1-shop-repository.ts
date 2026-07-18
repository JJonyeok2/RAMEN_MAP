import type { D1DatabaseLike } from "../d1.ts";
import type { AreaRow } from "../schema.ts";
import {
  effectiveVerificationStatus,
  type Area,
  type BrothBase,
  type BrothStyle,
  type PublicBranchSummary,
  type PublicEvidence,
  type PublicMenuItem,
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
const areaIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function stringValue(value: unknown, maximum = 300): string | null {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function nullableString(value: unknown, maximum = 300): string | null {
  return value === null || value === undefined ? null : stringValue(value, maximum);
}

function finiteNumber(value: unknown, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finiteNumber(value, minimum, maximum);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 20) return [];
    const strings = parsed.map((item) => stringValue(item, 80));
    return strings.every((item): item is string => item !== null) ? [...new Set(strings)] : [];
  } catch {
    return [];
  }
}

function enumArray<T extends string>(value: unknown, allowed: ReadonlySet<T>): T[] {
  return [...new Set(parseStringArray(value).filter((item): item is T => allowed.has(item as T)))];
}

function normalizedIsoDate(value: unknown): string | null {
  const parsed = stringValue(value, 40);
  if (!parsed) return null;
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(parsed)
    ? `${parsed.replace(" ", "T")}Z`
    : parsed;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(candidate)) return null;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === candidate.slice(0, 10)
    ? candidate
    : null;
}

function checkedDate(value: unknown): string | null {
  const parsed = stringValue(value, 40);
  if (!parsed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    const date = new Date(`${parsed}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === parsed ? parsed : null;
  }
  return normalizedIsoDate(parsed);
}

function httpUrl(value: unknown): string | null {
  const parsed = stringValue(value, 2_048);
  if (!parsed) return null;
  try {
    const url = new URL(parsed);
    return url.protocol === "http:" || url.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function publicVerificationStatus(value: unknown, checkedAt: string | null, entity: "branch" | "menu", now: Date): PublicVerificationStatus | null {
  if (typeof value !== "string" || !publicStatuses.has(value as PublicVerificationStatus)) return null;
  const effective = effectiveVerificationStatus(value as PublicVerificationStatus, checkedAt, entity, now);
  return publicStatuses.has(effective as PublicVerificationStatus) ? effective as PublicVerificationStatus : null;
}

function level(value: unknown, minimum: number, maximum: number): number | null {
  return integer(value, minimum, maximum);
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
  const id = stringValue(row.menu_id, 128);
  const name = stringValue(row.menu_name, 200);
  const availabilityStatus = stringValue(row.availability_status, 20);
  const lastVerifiedAt = row.menu_last_verified_at === null || row.menu_last_verified_at === undefined
    ? null
    : normalizedIsoDate(row.menu_last_verified_at);
  const verificationStatus = publicVerificationStatus(row.menu_verification_status, lastVerifiedAt, "menu", now);
  const price = row.price === null || row.price === undefined ? null : integer(row.price, 0, 1_000_000);
  if (
    !id || !name || !verificationStatus
    || row.menu_last_verified_at !== null && row.menu_last_verified_at !== undefined && lastVerifiedAt === null
    || row.price !== null && row.price !== undefined && price === null
    || !["available", "seasonal", "sold_out", "unknown"].includes(availabilityStatus ?? "")
  ) return null;

  const brothStyle = stringValue(row.broth_style, 20);
  return {
    id,
    name,
    price,
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
    const id = stringValue(row.branch_id, 128);
    const slug = stringValue(row.slug, 100);
    const shopName = stringValue(row.shop_name, 200);
    const branchName = nullableString(row.branch_name, 120);
    const region = stringValue(row.region, 80);
    const district = stringValue(row.district, 100);
    const address = stringValue(row.address, 300);
    const lat = finiteNumber(row.lat, -90, 90);
    const lng = finiteNumber(row.lng, -180, 180);
    const lastVerifiedAt = row.last_verified_at === null || row.last_verified_at === undefined
      ? null
      : normalizedIsoDate(row.last_verified_at);
    const verificationStatus = publicVerificationStatus(row.verification_status, lastVerifiedAt, "branch", now);
    if (
      !id || !slug || !slugPattern.test(slug) || !shopName
      || branchName === null && row.branch_name !== null && row.branch_name !== undefined
      || !region || !district || !address || lat === null || lng === null
      || row.last_verified_at !== null && row.last_verified_at !== undefined && lastVerifiedAt === null
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
          phone: nullableString(row.phone, 40),
          publicStatus: "active",
          verificationStatus,
          lastVerifiedAt,
          openingStatus: openingStatusAt(openingHours(row.opening_hours_json), now),
          menus: [],
        },
        hoursText: nullableString(row.hours_text, 500),
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
  const id = stringValue(row.id, 64);
  const name = stringValue(row.name, 100);
  const lat = finiteNumber(row.lat, -90, 90);
  const lng = finiteNumber(row.lng, -180, 180);
  if (!id || !areaIdPattern.test(id) || !name || !["district", "neighborhood", "station"].includes(row.kind) || lat === null || lng === null) return null;
  return { id, name, kind: row.kind, lat, lng };
}

type MappedEvidence = PublicEvidence & { entityType: "branch" | "menu"; entityId: string };

function mapEvidence(rows: readonly Record<string, unknown>[]): MappedEvidence[] {
  return rows.flatMap((row) => {
    const id = stringValue(row.id, 128);
    const entityType = row.entity_type === "branch" || row.entity_type === "menu" ? row.entity_type : null;
    const entityId = stringValue(row.entity_id, 128);
    const sourceName = stringValue(row.source_name, 200);
    const safeSourceUrl = httpUrl(row.source_url);
    const checkedAt = checkedDate(row.checked_at);
    const note = row.note === "" ? "" : stringValue(row.note, 1_000);
    return id && entityType && entityId && sourceName && safeSourceUrl && checkedAt && note !== null
      ? [{ id, entityType, entityId, sourceName, sourceUrl: safeSourceUrl, checkedAt, note }]
      : [];
  });
}

function publicEvidence(item: MappedEvidence): PublicEvidence {
  return {
    id: item.id,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    checkedAt: item.checkedAt,
    note: item.note,
  };
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
        SELECT entity_type, entity_id, id, source_name, source_url, checked_at, note
        FROM source_evidence
        WHERE (entity_type = 'branch' AND entity_id = ?)
          OR (entity_type = 'menu' AND entity_id IN (
            SELECT id FROM menu_items
            WHERE branch_id = ? AND verification_status IN ('verified', 'candidate', 'stale')
          ))
        ORDER BY checked_at DESC
      `).bind(mapped.branch.id, mapped.branch.id).all<Record<string, unknown>>();
      const mappedEvidence = mapEvidence(evidence.results ?? []);
      const menus = mapped.branch.menus.map((menu) => ({
        ...menu,
        evidence: mappedEvidence
          .filter((item) => item.entityType === "menu" && item.entityId === menu.id)
          .map(publicEvidence),
      }));
      const branchEvidence = mappedEvidence
        .filter((item) => item.entityType === "branch" && item.entityId === mapped.branch.id)
        .map(publicEvidence);
      return { ...mapped.branch, menus, evidence: branchEvidence, hoursText: mapped.hoursText };
    },
  };
}
