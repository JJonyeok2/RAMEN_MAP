import type { D1DatabaseLike, D1Statement } from "../../db/d1.ts";
import type {
  BranchRow,
  MenuItemRow,
  MenuProfileRow,
  OpeningHoursRow,
  SourceEvidenceRow,
  VerificationEventRow,
} from "../../db/schema.ts";
import type { PublicStatus, VerificationStatus } from "../../domain/ramen.ts";
import type { CandidateCreationInput } from "./request.ts";

export const ADMIN_ACTOR = "RAMEN MAP 운영자";

export type AdminBranchListItem = BranchRow & {
  shop_name: string;
  menu_count: number;
  evidence_count: number;
};

export type AdminBranchDetail = AdminBranchListItem & {
  weeklyHours: OpeningHoursRow[];
  menus: Array<MenuItemRow & { profile: MenuProfileRow | null }>;
  evidence: SourceEvidenceRow[];
  history: VerificationEventRow[];
};

export type WeeklyHoursInput = {
  weekday: number;
  opensAt: string | null;
  closesAt: string | null;
  breakStartsAt: string | null;
  breakEndsAt: string | null;
  lastOrderAt: string | null;
  isClosed: boolean;
};

export type BranchUpdateInput = {
  branchName: string | null;
  region: string;
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  hoursText: string | null;
  weeklyHours: WeeklyHoursInput[];
};

export type MenuInput = {
  name: string;
  price: number | null;
  availabilityStatus: MenuItemRow["availability_status"];
  verificationStatus: VerificationStatus;
  ramenTypes: string[];
  brothStyle: string | null;
  bodyLevel: number | null;
  spicinessLevel: number | null;
  brothBases: string[];
  tags: string[];
};

export type EvidenceInput = {
  entityType: SourceEvidenceRow["entity_type"];
  entityId: string;
  fieldName: string;
  sourceName: string;
  sourceUrl: string;
  checkedAt: string;
  note: string;
};

export type StateTransitionInput = {
  entityType: "branch" | "menu";
  entityId?: string;
  verificationStatus?: VerificationStatus;
  publicStatus?: PublicStatus;
  note: string;
};

const verificationStatuses = new Set<VerificationStatus>(["verified", "candidate", "stale", "rejected"]);
const publicStatuses = new Set<PublicStatus>(["active", "hidden", "closed", "moved"]);
const availabilityStatuses = new Set<MenuItemRow["availability_status"]>(["available", "seasonal", "sold_out", "unknown"]);
const identifierPattern = /^[a-z][a-z0-9-]*(?::[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}을(를) 확인해 주세요.`);
  return normalized;
}

function note(value: string, transition = false) {
  const normalized = value.trim();
  if (!normalized) throw new Error(transition ? "상태 전환에는 검토 메모가 필요합니다." : "변경 메모가 필요합니다.");
  return normalized;
}

function nullableText(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function sourceUrl(value: string) {
  const normalized = requiredText(value, "출처 URL");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("출처 URL을 확인해 주세요.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("출처 URL을 확인해 주세요.");
  return normalized;
}

function normalizedShopName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function canonicalWeeklyHours(input: WeeklyHoursInput[]): WeeklyHoursInput[] {
  return input.map((item) => ({
    weekday: item.weekday,
    opensAt: nullableText(item.opensAt),
    closesAt: nullableText(item.closesAt),
    breakStartsAt: nullableText(item.breakStartsAt),
    breakEndsAt: nullableText(item.breakEndsAt),
    lastOrderAt: nullableText(item.lastOrderAt),
    isClosed: item.isClosed,
  })).sort((left, right) => left.weekday - right.weekday);
}

function canonicalBranchInput(input: BranchUpdateInput): BranchUpdateInput {
  if (
    input.lat !== null && (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90)
    || input.lng !== null && (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180)
    || (input.lat === null) !== (input.lng === null)
  ) throw new Error("지점 좌표를 확인해 주세요.");
  return {
    branchName: nullableText(input.branchName),
    region: requiredText(input.region, "시·도"),
    district: requiredText(input.district, "구·시"),
    address: requiredText(input.address, "주소"),
    lat: input.lat,
    lng: input.lng,
    phone: nullableText(input.phone),
    hoursText: nullableText(input.hoursText),
    weeklyHours: canonicalWeeklyHours(input.weeklyHours),
  };
}

function list<T>(result: { results?: T[] }) {
  return result.results ?? [];
}

function parseProfileArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function profile(row: MenuProfileRow | null) {
  if (!row) return null;
  return {
    ...row,
    ramen_types: JSON.stringify(parseProfileArray(row.ramen_types)),
    broth_bases: JSON.stringify(parseProfileArray(row.broth_bases)),
    tags: JSON.stringify(parseProfileArray(row.tags)),
  };
}

function changedRows(result: unknown): number | null {
  if (typeof result !== "object" || result === null || !("meta" in result)) return null;
  const { meta } = result;
  if (typeof meta !== "object" || meta === null || !("changes" in meta)) return null;
  return typeof meta.changes === "number" && Number.isSafeInteger(meta.changes) && meta.changes >= 0
    ? meta.changes
    : null;
}

function canonicalMenuInput(input: MenuInput): MenuInput {
  return {
    name: requiredText(input.name, "메뉴명"),
    price: input.price,
    availabilityStatus: input.availabilityStatus,
    verificationStatus: input.verificationStatus,
    ramenTypes: [...input.ramenTypes],
    brothStyle: input.brothStyle,
    bodyLevel: input.bodyLevel,
    spicinessLevel: input.spicinessLevel,
    brothBases: [...input.brothBases],
    tags: [...input.tags],
  };
}

type MenuUpdatePreimage = Pick<
  MenuItemRow,
  "name" | "price" | "availability_status" | "verification_status" | "last_verified_at" | "updated_at"
> & Partial<Pick<
  MenuProfileRow,
  "ramen_types" | "broth_style" | "body_level" | "spiciness_level" | "broth_bases" | "tags"
>>;

function menuSnapshot(
  menu: {
    name: string;
    price: number | null;
    availabilityStatus: MenuItemRow["availability_status"];
    verificationStatus: VerificationStatus;
    lastVerifiedAt: string | null;
    updatedAt: string;
  },
  profileValue: {
    ramenTypes: string[];
    brothStyle: string | null;
    bodyLevel: number | null;
    spicinessLevel: number | null;
    brothBases: string[];
    tags: string[];
  },
) {
  return { ...menu, profile: profileValue };
}

export function createAdminService(
  db: D1DatabaseLike,
  now: () => string = () => new Date().toISOString(),
  newId: () => string = () => crypto.randomUUID(),
) {
  async function auditedBatch(statements: D1Statement[], event: {
    entityType: "branch" | "menu";
    entityId: string;
    action: string;
    previousValue?: string | null;
    nextValue?: string | null;
    note: string;
  }, guard?: { eventId: string; sql: string; bindings: unknown[] }) {
    if (!db.batch) throw new Error("D1 batch 기능이 필요합니다.");
    const eventId = guard?.eventId ?? `event:${newId()}`;
    const audit = db.prepare(`
      INSERT INTO verification_events (
        id, entity_type, entity_id, action, previous_value, next_value, note, actor, created_at
      ) ${guard ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.sql})` : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"}
    `).bind(
      eventId,
      event.entityType,
      event.entityId,
      event.action,
      event.previousValue ?? null,
      event.nextValue ?? null,
      event.note,
      ADMIN_ACTOR,
      now(),
      ...(guard?.bindings ?? []),
    );
    const results = await db.batch(guard ? [audit, ...statements] : [...statements, audit]);
    if (guard && changedRows(results[0]) !== 1) {
      throw new Error("다른 관리자 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.");
    }
  }

  return {
    async listBranches(filters: { verificationStatus?: VerificationStatus; publicStatus?: PublicStatus } = {}) {
      const conditions: string[] = [];
      const bindings: unknown[] = [];
      if (filters.verificationStatus) {
        if (!verificationStatuses.has(filters.verificationStatus)) throw new Error("검증 상태를 확인해 주세요.");
        conditions.push("b.verification_status = ?");
        bindings.push(filters.verificationStatus);
      }
      if (filters.publicStatus) {
        if (!publicStatuses.has(filters.publicStatus)) throw new Error("공개 상태를 확인해 주세요.");
        conditions.push("b.public_status = ?");
        bindings.push(filters.publicStatus);
      }
      const result = await db.prepare(`
        SELECT b.*, s.name AS shop_name,
          (SELECT COUNT(*) FROM menu_items m WHERE m.branch_id = b.id) AS menu_count,
          (SELECT COUNT(*) FROM source_evidence e WHERE e.entity_type = 'branch' AND e.entity_id = b.id) AS evidence_count
        FROM branches b JOIN shops s ON s.id = b.shop_id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY CASE b.verification_status
          WHEN 'candidate' THEN 0 WHEN 'stale' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END,
          s.name, b.branch_name
      `).bind(...bindings).all<AdminBranchListItem>();
      return list(result);
    },

    async getDashboardCounts() {
      const result = await db.prepare(`
        SELECT verification_status, public_status, COUNT(*) AS count
        FROM branches GROUP BY verification_status, public_status
      `).all<{ verification_status: VerificationStatus; public_status: PublicStatus; count: number }>();
      const counts = {
        verification: { verified: 0, candidate: 0, stale: 0, rejected: 0 },
        public: { active: 0, hidden: 0, closed: 0, moved: 0 },
      };
      for (const row of list(result)) {
        if (verificationStatuses.has(row.verification_status)) counts.verification[row.verification_status] += row.count;
        if (publicStatuses.has(row.public_status)) counts.public[row.public_status] += row.count;
      }
      return counts;
    },

    async loadBranch(id: string): Promise<AdminBranchDetail | null> {
      const branch = await db.prepare(`
        SELECT b.*, s.name AS shop_name,
          (SELECT COUNT(*) FROM menu_items m WHERE m.branch_id = b.id) AS menu_count,
          (SELECT COUNT(*) FROM source_evidence e WHERE e.entity_type = 'branch' AND e.entity_id = b.id) AS evidence_count
        FROM branches b JOIN shops s ON s.id = b.shop_id WHERE b.id = ?
      `).bind(id).first<AdminBranchListItem>();
      if (!branch) return null;
      const [hours, menuRows, profiles, evidence, history] = await Promise.all([
        db.prepare("SELECT * FROM opening_hours WHERE branch_id = ? ORDER BY weekday").bind(id).all<OpeningHoursRow>(),
        db.prepare("SELECT * FROM menu_items WHERE branch_id = ? ORDER BY created_at, id").bind(id).all<MenuItemRow>(),
        db.prepare("SELECT p.* FROM menu_profiles p JOIN menu_items m ON m.id = p.menu_item_id WHERE m.branch_id = ?").bind(id).all<MenuProfileRow>(),
        db.prepare(`SELECT * FROM source_evidence WHERE
          (entity_type = 'branch' AND entity_id = ?)
          OR (entity_type = 'menu' AND entity_id IN (SELECT id FROM menu_items WHERE branch_id = ?))
          ORDER BY checked_at DESC`).bind(id, id).all<SourceEvidenceRow>(),
        db.prepare(`SELECT * FROM verification_events WHERE
          (entity_type = 'branch' AND entity_id = ?)
          OR (entity_type = 'menu' AND entity_id IN (SELECT id FROM menu_items WHERE branch_id = ?))
          ORDER BY created_at DESC`).bind(id, id).all<VerificationEventRow>(),
      ]);
      const profilesByMenu = new Map(list(profiles).map((item) => [item.menu_item_id, profile(item)]));
      return {
        ...branch,
        weeklyHours: list(hours),
        menus: list(menuRows).map((menu) => ({ ...menu, profile: profilesByMenu.get(menu.id) ?? null })),
        evidence: list(evidence),
        history: list(history),
      };
    },

    async createCandidate(input: CandidateCreationInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      const shopId = requiredText(input.shopId, "매장 식별자");
      const branchId = requiredText(input.branchId, "지점 식별자");
      const slug = requiredText(input.slug, "슬러그");
      if (
        !identifierPattern.test(shopId) || !shopId.startsWith("shop:")
        || !identifierPattern.test(branchId) || !branchId.startsWith("branch:")
        || !slugPattern.test(slug)
      ) throw new Error("후보 식별자를 확인해 주세요.");
      if (
        !Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90
        || !Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180
      ) throw new Error("후보 좌표를 확인해 주세요.");
      const normalizedSourceUrl = sourceUrl(input.sourceUrl);
      const duplicate = await db.prepare(`SELECT
        EXISTS(SELECT 1 FROM shops WHERE id = ?) AS shop_id_exists,
        EXISTS(SELECT 1 FROM branches WHERE id = ?) AS branch_id_exists,
        EXISTS(SELECT 1 FROM branches WHERE slug = ?) AS slug_exists
      `).bind(shopId, branchId, slug).first<{
        shop_id_exists: number;
        branch_id_exists: number;
        slug_exists: number;
      }>();
      if (duplicate?.shop_id_exists || duplicate?.branch_id_exists || duplicate?.slug_exists) {
        throw new Error("후보 식별자 또는 슬러그가 이미 사용 중입니다.");
      }

      const timestamp = now();
      const shopName = requiredText(input.shopName, "매장명");
      const normalizedName = normalizedShopName(shopName);
      const evidenceId = `evidence:${newId()}`;
      const branch = {
        id: branchId,
        shopId,
        slug,
        branchName: nullableText(input.branchName),
        region: requiredText(input.region, "시·도"),
        district: requiredText(input.district, "구·시"),
        address: requiredText(input.address, "주소"),
        lat: input.lat,
        lng: input.lng,
        phone: nullableText(input.phone),
        publicStatus: "hidden" as const,
        verificationStatus: "candidate" as const,
        hoursText: null,
        lastVerifiedAt: null,
      };
      const evidence = {
        id: evidenceId,
        entityType: "branch" as const,
        entityId: branchId,
        fieldName: "general",
        sourceName: requiredText(input.sourceName, "출처명"),
        sourceUrl: normalizedSourceUrl,
        checkedAt: requiredText(input.checkedAt, "확인일"),
        note: input.evidenceNote.trim(),
      };
      const nextValue = JSON.stringify({
        shop: { id: shopId, name: shopName, normalizedName },
        branch,
        evidence,
      });
      await auditedBatch([
        db.prepare(`INSERT INTO shops (id, name, normalized_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`).bind(shopId, shopName, normalizedName, timestamp, timestamp),
        db.prepare(`INSERT INTO branches (
          id, shop_id, slug, branch_name, region, district, address, lat, lng, phone,
          public_status, verification_status, hours_text, last_verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          branch.id, branch.shopId, branch.slug, branch.branchName, branch.region, branch.district,
          branch.address, branch.lat, branch.lng, branch.phone, branch.publicStatus,
          branch.verificationStatus, branch.hoursText, branch.lastVerifiedAt, timestamp, timestamp,
        ),
        db.prepare(`INSERT INTO source_evidence (
          id, entity_type, entity_id, field_name, source_name, source_url, checked_at, note, collected_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          evidence.id, evidence.entityType, evidence.entityId, evidence.fieldName, evidence.sourceName,
          evidence.sourceUrl, evidence.checkedAt, evidence.note, ADMIN_ACTOR,
        ),
      ], {
        entityType: "branch",
        entityId: branchId,
        action: "create_candidate",
        previousValue: null,
        nextValue,
        note: changeNote,
      });
      return branchId;
    },

    async updateBranch(id: string, input: BranchUpdateInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      const canonical = canonicalBranchInput(input);
      if (!canonical.weeklyHours.every((item) => Number.isInteger(item.weekday) && item.weekday >= 0 && item.weekday <= 6)) {
        throw new Error("요일 값을 확인해 주세요.");
      }
      if (new Set(canonical.weeklyHours.map((item) => item.weekday)).size !== canonical.weeklyHours.length) {
        throw new Error("요일별 영업시간은 한 번씩만 입력해 주세요.");
      }
      const previousBranch = await db.prepare(`SELECT branch_name, region, district, address, lat, lng,
        phone, hours_text, updated_at FROM branches WHERE id = ?`).bind(id).first<Pick<
          BranchRow,
          "branch_name" | "region" | "district" | "address" | "lat" | "lng" | "phone" | "hours_text" | "updated_at"
        >>();
      if (!previousBranch) throw new Error("수정할 지점을 찾지 못했습니다.");
      const previousHours = await db.prepare("SELECT * FROM opening_hours WHERE branch_id = ? ORDER BY weekday")
        .bind(id).all<OpeningHoursRow>();
      const previousValue = JSON.stringify({
        branchName: previousBranch.branch_name,
        region: previousBranch.region,
        district: previousBranch.district,
        address: previousBranch.address,
        lat: previousBranch.lat,
        lng: previousBranch.lng,
        phone: previousBranch.phone,
        hoursText: previousBranch.hours_text,
        weeklyHours: list(previousHours).map((item) => ({
          weekday: item.weekday,
          opensAt: item.opens_at,
          closesAt: item.closes_at,
          breakStartsAt: item.break_starts_at,
          breakEndsAt: item.break_ends_at,
          lastOrderAt: item.last_order_at,
          isClosed: item.is_closed === 1,
        })),
        updatedAt: previousBranch.updated_at,
      });
      const timestamp = now();
      const mutationEventId = `event:${newId()}`;
      const nextValue = JSON.stringify({ ...canonical, updatedAt: timestamp });
      const statements = [
        db.prepare(`UPDATE branches SET branch_name = ?, region = ?, district = ?, address = ?, lat = ?, lng = ?,
          phone = ?, hours_text = ?, updated_at = ? WHERE id = ? AND updated_at = ?
          AND EXISTS (SELECT 1 FROM verification_events WHERE id = ?)`).bind(
          canonical.branchName, canonical.region, canonical.district, canonical.address, canonical.lat, canonical.lng,
          canonical.phone, canonical.hoursText, timestamp, id, previousBranch.updated_at, mutationEventId,
        ),
        db.prepare(`DELETE FROM opening_hours WHERE branch_id = ?
          AND EXISTS (SELECT 1 FROM verification_events WHERE id = ?)
          AND EXISTS (SELECT 1 FROM branches WHERE id = ? AND updated_at = ?)`).bind(
          id, mutationEventId, id, timestamp,
        ),
        ...canonical.weeklyHours.map((item) => db.prepare(`INSERT INTO opening_hours (
          id, branch_id, weekday, opens_at, closes_at, break_starts_at, break_ends_at, last_order_at, is_closed
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM verification_events WHERE id = ?)
          AND EXISTS (SELECT 1 FROM branches WHERE id = ? AND updated_at = ?)`).bind(
          `hours:${newId()}`, id, item.weekday, item.opensAt, item.closesAt, item.breakStartsAt,
          item.breakEndsAt, item.lastOrderAt, item.isClosed ? 1 : 0, mutationEventId, id, timestamp,
        )),
      ];
      await auditedBatch(statements, {
        entityType: "branch", entityId: id, action: "update_facts", previousValue, nextValue, note: changeNote,
      }, {
        eventId: mutationEventId,
        sql: "SELECT 1 FROM branches WHERE id = ? AND updated_at = ?",
        bindings: [id, previousBranch.updated_at],
      });
    },

    async createMenu(branchId: string, input: MenuInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (!availabilityStatuses.has(input.availabilityStatus) || !verificationStatuses.has(input.verificationStatus)) {
        throw new Error("메뉴 상태를 확인해 주세요.");
      }
      const menuId = `menu:${newId()}`;
      const timestamp = now();
      await auditedBatch([
        db.prepare(`INSERT INTO menu_items (
          id, branch_id, name, price, availability_status, verification_status, last_verified_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          menuId, branchId, requiredText(input.name, "메뉴명"), input.price, input.availabilityStatus,
          input.verificationStatus, input.verificationStatus === "verified" ? timestamp : null, timestamp,
        ),
        db.prepare(`INSERT INTO menu_profiles (
          menu_item_id, ramen_types, broth_style, body_level, spiciness_level, broth_bases, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
          menuId, JSON.stringify(input.ramenTypes), input.brothStyle, input.bodyLevel, input.spicinessLevel,
          JSON.stringify(input.brothBases), JSON.stringify(input.tags),
        ),
      ], { entityType: "menu", entityId: menuId, action: "create_menu", nextValue: JSON.stringify(input), note: changeNote });
      return menuId;
    },

    async updateMenu(branchId: string, menuId: string, input: MenuInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (!availabilityStatuses.has(input.availabilityStatus) || !verificationStatuses.has(input.verificationStatus)) {
        throw new Error("메뉴 상태를 확인해 주세요.");
      }
      const canonical = canonicalMenuInput(input);
      const targetId = requiredText(menuId, "메뉴");
      const previous = await db.prepare(`SELECT
          m.name, m.price, m.availability_status, m.verification_status,
          m.last_verified_at, m.updated_at,
          p.ramen_types, p.broth_style, p.body_level, p.spiciness_level, p.broth_bases, p.tags
        FROM menu_items m LEFT JOIN menu_profiles p ON p.menu_item_id = m.id
        WHERE m.id = ? AND m.branch_id = ?`)
        .bind(targetId, branchId).first<MenuUpdatePreimage>();
      if (!previous) throw new Error("이 지점에 소속된 메뉴를 찾지 못했습니다.");
      const timestamp = now();
      const mutationEventId = `event:${newId()}`;
      const lastVerifiedAt = canonical.verificationStatus === "verified" ? timestamp : null;
      const previousValue = JSON.stringify(menuSnapshot({
        name: previous.name,
        price: previous.price,
        availabilityStatus: previous.availability_status,
        verificationStatus: previous.verification_status,
        lastVerifiedAt: previous.last_verified_at,
        updatedAt: previous.updated_at,
      }, {
        ramenTypes: parseProfileArray(previous.ramen_types),
        brothStyle: previous.broth_style ?? null,
        bodyLevel: previous.body_level ?? null,
        spicinessLevel: previous.spiciness_level ?? null,
        brothBases: parseProfileArray(previous.broth_bases),
        tags: parseProfileArray(previous.tags),
      }));
      const nextValue = JSON.stringify(menuSnapshot({
        name: canonical.name,
        price: canonical.price,
        availabilityStatus: canonical.availabilityStatus,
        verificationStatus: canonical.verificationStatus,
        lastVerifiedAt,
        updatedAt: timestamp,
      }, {
        ramenTypes: canonical.ramenTypes,
        brothStyle: canonical.brothStyle,
        bodyLevel: canonical.bodyLevel,
        spicinessLevel: canonical.spicinessLevel,
        brothBases: canonical.brothBases,
        tags: canonical.tags,
      }));
      await auditedBatch([
        db.prepare(`UPDATE menu_items SET name = ?, price = ?, availability_status = ?,
          verification_status = ?, last_verified_at = ?, updated_at = ?
          WHERE id = ? AND branch_id = ? AND updated_at = ?
          AND EXISTS (SELECT 1 FROM verification_events WHERE id = ?)`).bind(
          canonical.name, canonical.price, canonical.availabilityStatus, canonical.verificationStatus,
          lastVerifiedAt, timestamp, targetId, branchId, previous.updated_at, mutationEventId,
        ),
        db.prepare(`INSERT INTO menu_profiles (
          menu_item_id, ramen_types, broth_style, body_level, spiciness_level, broth_bases, tags
        ) SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM verification_events WHERE id = ?)
          AND EXISTS (SELECT 1 FROM menu_items WHERE id = ? AND branch_id = ? AND updated_at = ?)
        ON CONFLICT(menu_item_id) DO UPDATE SET ramen_types=excluded.ramen_types,
          broth_style=excluded.broth_style, body_level=excluded.body_level,
          spiciness_level=excluded.spiciness_level, broth_bases=excluded.broth_bases, tags=excluded.tags`).bind(
          targetId, JSON.stringify(canonical.ramenTypes), canonical.brothStyle, canonical.bodyLevel, canonical.spicinessLevel,
          JSON.stringify(canonical.brothBases), JSON.stringify(canonical.tags), mutationEventId, targetId, branchId, timestamp,
        ),
      ], {
        entityType: "menu",
        entityId: targetId,
        action: "update_menu",
        previousValue,
        nextValue,
        note: changeNote,
      }, {
        eventId: mutationEventId,
        sql: "SELECT 1 FROM menu_items WHERE id = ? AND branch_id = ? AND updated_at = ?",
        bindings: [targetId, branchId, previous.updated_at],
      });
    },

    async appendEvidence(branchId: string, input: EvidenceInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (input.entityType !== "branch" && input.entityType !== "menu") throw new Error("근거 대상을 확인해 주세요.");
      let targetId = branchId;
      if (input.entityType === "branch") {
        const branch = await db.prepare("SELECT id FROM branches WHERE id = ?").bind(branchId).first<{ id: string }>();
        if (!branch) throw new Error("지점 근거 대상을 찾지 못했습니다.");
      } else {
        targetId = requiredText(input.entityId, "메뉴 근거 대상");
        const menu = await db.prepare("SELECT id FROM menu_items WHERE id = ? AND branch_id = ?")
          .bind(targetId, branchId).first<{ id: string }>();
        if (!menu) throw new Error("이 지점에 소속된 메뉴 근거 대상을 찾지 못했습니다.");
      }
      const evidenceId = `evidence:${newId()}`;
      const normalizedSourceUrl = sourceUrl(input.sourceUrl);
      await auditedBatch([
        db.prepare(`INSERT INTO source_evidence (
          id, entity_type, entity_id, field_name, source_name, source_url, checked_at, note, collected_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          evidenceId, input.entityType, targetId, requiredText(input.fieldName, "근거 필드"),
          requiredText(input.sourceName, "출처명"), normalizedSourceUrl,
          requiredText(input.checkedAt, "확인일"), input.note.trim(), ADMIN_ACTOR,
        ),
      ], { entityType: input.entityType, entityId: targetId, action: "append_evidence", nextValue: JSON.stringify({ ...input, entityId: targetId, id: evidenceId }), note: changeNote });
      return evidenceId;
    },

    async transitionState(branchId: string, input: StateTransitionInput) {
      const reviewerNote = note(input.note, true);
      if (!input.verificationStatus && !input.publicStatus) throw new Error("변경할 상태가 필요합니다.");
      if (input.verificationStatus && !verificationStatuses.has(input.verificationStatus)) throw new Error("검증 상태를 확인해 주세요.");
      if (input.publicStatus && (!publicStatuses.has(input.publicStatus) || input.entityType !== "branch")) throw new Error("공개 상태를 확인해 주세요.");
      const timestamp = now();
      const assignments: string[] = [];
      const values: unknown[] = [];
      if (input.verificationStatus) {
        assignments.push("verification_status = ?", "last_verified_at = ?");
        values.push(input.verificationStatus, input.verificationStatus === "verified" ? timestamp : null);
      }
      if (input.publicStatus) {
        assignments.push("public_status = ?");
        values.push(input.publicStatus);
      }
      assignments.push("updated_at = ?");
      values.push(timestamp);

      let targetId: string;
      let previousValue: string;
      let nextValue: string;
      let previousUpdatedAt: string;
      let mutation: D1Statement;
      const mutationEventId = `event:${newId()}`;
      if (input.entityType === "branch") {
        targetId = branchId;
        if (input.entityId && input.entityId !== branchId) throw new Error("지점 상태 대상을 찾지 못했습니다.");
        const previous = await db.prepare(`SELECT verification_status, public_status, last_verified_at, updated_at
          FROM branches WHERE id = ?`).bind(branchId).first<Pick<
            BranchRow, "verification_status" | "public_status" | "last_verified_at" | "updated_at"
          >>();
        if (!previous) throw new Error("상태를 변경할 지점을 찾지 못했습니다.");
        previousUpdatedAt = previous.updated_at;
        previousValue = JSON.stringify({
          verificationStatus: previous.verification_status,
          publicStatus: previous.public_status,
          lastVerifiedAt: previous.last_verified_at,
          updatedAt: previous.updated_at,
        });
        nextValue = JSON.stringify({
          verificationStatus: input.verificationStatus ?? previous.verification_status,
          publicStatus: input.publicStatus ?? previous.public_status,
          lastVerifiedAt: input.verificationStatus
            ? input.verificationStatus === "verified" ? timestamp : null
            : previous.last_verified_at,
          updatedAt: timestamp,
        });
        mutation = db.prepare(`UPDATE branches SET ${assignments.join(", ")}
          WHERE id = ? AND updated_at = ?
          AND EXISTS (SELECT 1 FROM verification_events WHERE id = ?)`).bind(
          ...values, targetId, previous.updated_at, mutationEventId,
        );
      } else {
        targetId = requiredText(input.entityId ?? "", "메뉴 상태 대상");
        const previous = await db.prepare(`SELECT m.verification_status, m.last_verified_at, m.updated_at
          FROM menu_items m WHERE m.id = ? AND m.branch_id = ?`).bind(targetId, branchId).first<Pick<
            MenuItemRow, "verification_status" | "last_verified_at" | "updated_at"
          >>();
        if (!previous) throw new Error("이 지점에 소속된 상태 변경 메뉴를 찾지 못했습니다.");
        previousUpdatedAt = previous.updated_at;
        previousValue = JSON.stringify({
          verificationStatus: previous.verification_status,
          lastVerifiedAt: previous.last_verified_at,
          updatedAt: previous.updated_at,
        });
        nextValue = JSON.stringify({
          verificationStatus: input.verificationStatus ?? previous.verification_status,
          lastVerifiedAt: input.verificationStatus
            ? input.verificationStatus === "verified" ? timestamp : null
            : previous.last_verified_at,
          updatedAt: timestamp,
        });
        mutation = db.prepare(`UPDATE menu_items SET ${assignments.join(", ")}
          WHERE id = ? AND branch_id = ? AND updated_at = ?
          AND EXISTS (SELECT 1 FROM verification_events WHERE id = ?)`).bind(
          ...values, targetId, branchId, previous.updated_at, mutationEventId,
        );
      }
      await auditedBatch([
        mutation,
      ], {
        entityType: input.entityType,
        entityId: targetId,
        action: "transition_state",
        previousValue,
        nextValue,
        note: reviewerNote,
      }, input.entityType === "branch" ? {
        eventId: mutationEventId,
        sql: "SELECT 1 FROM branches WHERE id = ? AND updated_at = ?",
        bindings: [targetId, previousUpdatedAt],
      } : {
        eventId: mutationEventId,
        sql: "SELECT 1 FROM menu_items WHERE id = ? AND branch_id = ? AND updated_at = ?",
        bindings: [targetId, branchId, previousUpdatedAt],
      });
    },
  };
}
