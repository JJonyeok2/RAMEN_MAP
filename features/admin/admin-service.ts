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
  id?: string;
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
  entityId: string;
  verificationStatus?: VerificationStatus;
  publicStatus?: PublicStatus;
  note: string;
};

const verificationStatuses = new Set<VerificationStatus>(["verified", "candidate", "stale", "rejected"]);
const publicStatuses = new Set<PublicStatus>(["active", "hidden", "closed", "moved"]);
const availabilityStatuses = new Set<MenuItemRow["availability_status"]>(["available", "seasonal", "sold_out", "unknown"]);

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
  }) {
    if (!db.batch) throw new Error("D1 batch 기능이 필요합니다.");
    const audit = db.prepare(`
      INSERT INTO verification_events (
        id, entity_type, entity_id, action, previous_value, next_value, note, actor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `event:${newId()}`,
      event.entityType,
      event.entityId,
      event.action,
      event.previousValue ?? null,
      event.nextValue ?? null,
      event.note,
      ADMIN_ACTOR,
      now(),
    );
    await db.batch([...statements, audit]);
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

    async updateBranch(id: string, input: BranchUpdateInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (!input.weeklyHours.every((item) => Number.isInteger(item.weekday) && item.weekday >= 0 && item.weekday <= 6)) {
        throw new Error("요일 값을 확인해 주세요.");
      }
      if (new Set(input.weeklyHours.map((item) => item.weekday)).size !== input.weeklyHours.length) {
        throw new Error("요일별 영업시간은 한 번씩만 입력해 주세요.");
      }
      const nextValue = JSON.stringify(input);
      const statements = [
        db.prepare(`UPDATE branches SET branch_name = ?, region = ?, district = ?, address = ?, lat = ?, lng = ?,
          phone = ?, hours_text = ?, updated_at = ? WHERE id = ?`).bind(
          nullableText(input.branchName), requiredText(input.region, "시·도"), requiredText(input.district, "구·시"),
          requiredText(input.address, "주소"), input.lat, input.lng, nullableText(input.phone), nullableText(input.hoursText), now(), id,
        ),
        db.prepare("DELETE FROM opening_hours WHERE branch_id = ?").bind(id),
        ...input.weeklyHours.map((item) => db.prepare(`INSERT INTO opening_hours (
          id, branch_id, weekday, opens_at, closes_at, break_starts_at, break_ends_at, last_order_at, is_closed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          `hours:${newId()}`, id, item.weekday, item.opensAt, item.closesAt, item.breakStartsAt,
          item.breakEndsAt, item.lastOrderAt, item.isClosed ? 1 : 0,
        )),
      ];
      await auditedBatch(statements, { entityType: "branch", entityId: id, action: "update_facts", nextValue, note: changeNote });
    },

    async saveMenu(branchId: string, input: MenuInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (!availabilityStatuses.has(input.availabilityStatus) || !verificationStatuses.has(input.verificationStatus)) {
        throw new Error("메뉴 상태를 확인해 주세요.");
      }
      const menuId = input.id || `menu:${newId()}`;
      const timestamp = now();
      await auditedBatch([
        db.prepare(`INSERT INTO menu_items (
          id, branch_id, name, price, availability_status, verification_status, last_verified_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price,
          availability_status=excluded.availability_status, verification_status=excluded.verification_status,
          last_verified_at=excluded.last_verified_at, updated_at=excluded.updated_at`).bind(
          menuId, branchId, requiredText(input.name, "메뉴명"), input.price, input.availabilityStatus,
          input.verificationStatus, input.verificationStatus === "verified" ? timestamp : null, timestamp,
        ),
        db.prepare(`INSERT INTO menu_profiles (
          menu_item_id, ramen_types, broth_style, body_level, spiciness_level, broth_bases, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(menu_item_id) DO UPDATE SET ramen_types=excluded.ramen_types,
          broth_style=excluded.broth_style, body_level=excluded.body_level,
          spiciness_level=excluded.spiciness_level, broth_bases=excluded.broth_bases, tags=excluded.tags`).bind(
          menuId, JSON.stringify(input.ramenTypes), input.brothStyle, input.bodyLevel, input.spicinessLevel,
          JSON.stringify(input.brothBases), JSON.stringify(input.tags),
        ),
      ], { entityType: "menu", entityId: menuId, action: input.id ? "update_menu" : "create_menu", nextValue: JSON.stringify(input), note: changeNote });
      return menuId;
    },

    async appendEvidence(input: EvidenceInput, reviewerNote: string) {
      const changeNote = note(reviewerNote);
      if (input.entityType !== "branch" && input.entityType !== "menu") throw new Error("근거 대상을 확인해 주세요.");
      requiredText(input.entityId, "근거 대상");
      const evidenceId = `evidence:${newId()}`;
      await auditedBatch([
        db.prepare(`INSERT INTO source_evidence (
          id, entity_type, entity_id, field_name, source_name, source_url, checked_at, note, collected_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          evidenceId, input.entityType, input.entityId, requiredText(input.fieldName, "근거 필드"),
          requiredText(input.sourceName, "출처명"), requiredText(input.sourceUrl, "출처 URL"),
          requiredText(input.checkedAt, "확인일"), input.note.trim(), ADMIN_ACTOR,
        ),
      ], { entityType: input.entityType, entityId: input.entityId, action: "append_evidence", nextValue: JSON.stringify({ ...input, id: evidenceId }), note: changeNote });
      return evidenceId;
    },

    async transitionState(input: StateTransitionInput) {
      const reviewerNote = note(input.note, true);
      if (!input.verificationStatus && !input.publicStatus) throw new Error("변경할 상태가 필요합니다.");
      if (input.verificationStatus && !verificationStatuses.has(input.verificationStatus)) throw new Error("검증 상태를 확인해 주세요.");
      if (input.publicStatus && (!publicStatuses.has(input.publicStatus) || input.entityType !== "branch")) throw new Error("공개 상태를 확인해 주세요.");
      const assignments: string[] = [];
      const values: unknown[] = [];
      if (input.verificationStatus) {
        assignments.push("verification_status = ?", "last_verified_at = ?");
        values.push(input.verificationStatus, input.verificationStatus === "verified" ? now() : null);
      }
      if (input.publicStatus) {
        assignments.push("public_status = ?");
        values.push(input.publicStatus);
      }
      assignments.push("updated_at = ?");
      values.push(now(), input.entityId);
      const table = input.entityType === "branch" ? "branches" : "menu_items";
      await auditedBatch([
        db.prepare(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ?`).bind(...values),
      ], {
        entityType: input.entityType,
        entityId: input.entityId,
        action: "transition_state",
        nextValue: JSON.stringify({ verificationStatus: input.verificationStatus, publicStatus: input.publicStatus }),
        note: reviewerNote,
      });
    },
  };
}
