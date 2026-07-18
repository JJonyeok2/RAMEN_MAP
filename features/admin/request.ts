import {
  brothBases,
  brothStyles,
  publicStatuses,
  ramenTypes,
  verificationStatuses,
  type BrothBase,
  type BrothStyle,
  type PublicStatus,
  type RamenType,
  type VerificationStatus,
} from "../../domain/ramen.ts";
import type {
  BranchUpdateInput,
  EvidenceInput,
  MenuInput,
  StateTransitionInput,
  WeeklyHoursInput,
} from "./admin-service.ts";

type UnknownRecord = Record<string, unknown>;

const availabilityStatuses = ["available", "seasonal", "sold_out", "unknown"] as const;
const identifierPattern = /^[a-z][a-z0-9-]*(?::[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 형식을 확인해 주세요.`);
  }
  return value as UnknownRecord;
}

function onlyKeys(value: UnknownRecord, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} 형식을 확인해 주세요.`);
  }
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label}을(를) 확인해 주세요.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label}을(를) 확인해 주세요.`);
  }
  return normalized;
}

function nullableText(value: unknown, label: string, maximum: number): string | null {
  if (value === null) return null;
  const normalized = text(value, label, maximum, true);
  return normalized || null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label}을(를) 확인해 주세요.`);
  return value as T;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] {
  if (!Array.isArray(value) || value.length > allowed.length) throw new Error(`${label}을(를) 확인해 주세요.`);
  const parsed = value.map((item) => enumValue(item, allowed, label));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${label}을(를) 확인해 주세요.`);
  return parsed;
}

function stringArray(value: unknown, label: string, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label}을(를) 확인해 주세요.`);
  const parsed = value.map((item) => text(item, label, maximumLength));
  if (new Set(parsed).size !== parsed.length) throw new Error(`${label}을(를) 확인해 주세요.`);
  return parsed;
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label}을(를) 확인해 주세요.`);
  }
  return value as number;
}

function nullableCoordinate(value: unknown, label: string, minimum: number, maximum: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label}을(를) 확인해 주세요.`);
  }
  return value;
}

function coordinate(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = nullableCoordinate(value, label, minimum, maximum);
  if (parsed === null) throw new Error(`${label}을(를) 확인해 주세요.`);
  return parsed;
}

function identifier(value: unknown, label: string, prefix?: "shop:" | "branch:"): string {
  const parsed = text(value, label, 128);
  if (!identifierPattern.test(parsed) || prefix && !parsed.startsWith(prefix)) {
    throw new Error(`${label}을(를) 확인해 주세요.`);
  }
  return parsed;
}

function date(value: unknown, label: string): string {
  const parsed = text(value, label, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parsed);
  if (!match) throw new Error(`${label}을(를) 확인해 주세요.`);
  const [year, month, day] = match.slice(1).map(Number);
  const valueDate = new Date(Date.UTC(year, month - 1, day));
  if (
    valueDate.getUTCFullYear() !== year
    || valueDate.getUTCMonth() !== month - 1
    || valueDate.getUTCDate() !== day
  ) throw new Error(`${label}을(를) 확인해 주세요.`);
  return parsed;
}

function sourceUrl(value: unknown): string {
  const parsed = text(value, "출처 URL", 2_048);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new Error("출처 URL을 확인해 주세요.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("출처 URL을 확인해 주세요.");
  return parsed;
}

function optionalTime(value: unknown, label: string): string | null {
  if (value === null) return null;
  const parsed = text(value, label, 5);
  if (!timePattern.test(parsed)) throw new Error(`${label}을(를) 확인해 주세요.`);
  return parsed;
}

function weeklyHours(value: unknown): WeeklyHoursInput[] {
  if (!Array.isArray(value) || value.length > 7) throw new Error("주간 영업시간 형식을 확인해 주세요.");
  const parsed = value.map((item): WeeklyHoursInput => {
    const input = record(item, "주간 영업시간");
    onlyKeys(input, ["weekday", "opensAt", "closesAt", "breakStartsAt", "breakEndsAt", "lastOrderAt", "isClosed"], "주간 영업시간");
    if (!Number.isInteger(input.weekday) || (input.weekday as number) < 0 || (input.weekday as number) > 6) {
      throw new Error("요일 값을 확인해 주세요.");
    }
    if (typeof input.isClosed !== "boolean") throw new Error("휴무 여부를 확인해 주세요.");
    return {
      weekday: input.weekday as number,
      opensAt: optionalTime(input.opensAt, "오픈 시간"),
      closesAt: optionalTime(input.closesAt, "마감 시간"),
      breakStartsAt: optionalTime(input.breakStartsAt, "브레이크 시작"),
      breakEndsAt: optionalTime(input.breakEndsAt, "브레이크 종료"),
      lastOrderAt: optionalTime(input.lastOrderAt, "라스트 오더"),
      isClosed: input.isClosed,
    };
  });
  if (new Set(parsed.map((item) => item.weekday)).size !== parsed.length) {
    throw new Error("요일별 영업시간은 한 번씩만 입력해 주세요.");
  }
  return parsed.sort((left, right) => left.weekday - right.weekday);
}

function branchInput(value: unknown): BranchUpdateInput {
  const input = record(value, "지점 정보");
  onlyKeys(input, ["branchName", "region", "district", "address", "lat", "lng", "phone", "hoursText", "weeklyHours"], "지점 정보");
  const lat = nullableCoordinate(input.lat, "위도", -90, 90);
  const lng = nullableCoordinate(input.lng, "경도", -180, 180);
  if ((lat === null) !== (lng === null)) throw new Error("지점 좌표를 확인해 주세요.");
  return {
    branchName: nullableText(input.branchName, "지점명", 120),
    region: text(input.region, "시·도", 80),
    district: text(input.district, "구·시", 100),
    address: text(input.address, "주소", 300),
    lat,
    lng,
    phone: nullableText(input.phone, "전화번호", 40),
    hoursText: nullableText(input.hoursText, "영업시간", 500),
    weeklyHours: weeklyHours(input.weeklyHours),
  };
}

function menuInput(value: unknown, expectedId?: string): MenuInput {
  const input = record(value, "메뉴 정보");
  onlyKeys(input, ["id", "name", "price", "availabilityStatus", "verificationStatus", "ramenTypes", "brothStyle", "bodyLevel", "spicinessLevel", "brothBases", "tags"], "메뉴 정보");
  if (input.id !== undefined) {
    const parsedId = identifier(input.id, "메뉴 식별자");
    if (expectedId && parsedId !== expectedId) throw new Error("메뉴 식별자를 확인해 주세요.");
  }
  return {
    name: text(input.name, "메뉴명", 200),
    price: nullableInteger(input.price, "가격", 0, 1_000_000),
    availabilityStatus: enumValue(input.availabilityStatus, availabilityStatuses, "판매 상태"),
    verificationStatus: enumValue<VerificationStatus>(input.verificationStatus, verificationStatuses, "검증 상태"),
    ramenTypes: enumArray<RamenType>(input.ramenTypes, ramenTypes, "라멘 유형"),
    brothStyle: input.brothStyle === null ? null : enumValue<BrothStyle>(input.brothStyle, brothStyles, "국물 스타일"),
    bodyLevel: nullableInteger(input.bodyLevel, "농도", 1, 5),
    spicinessLevel: nullableInteger(input.spicinessLevel, "맵기", 0, 5),
    brothBases: enumArray<BrothBase>(input.brothBases, brothBases, "육수 베이스"),
    tags: stringArray(input.tags, "태그", 20, 80),
  };
}

function evidenceInput(value: unknown, branchId: string): EvidenceInput {
  const input = record(value, "근거 정보");
  onlyKeys(input, ["entityType", "entityId", "fieldName", "sourceName", "sourceUrl", "checkedAt", "note"], "근거 정보");
  const entityType = enumValue(input.entityType, ["branch", "menu"] as const, "근거 대상");
  let entityId: string;
  if (entityType === "branch") {
    if (input.entityId !== undefined && identifier(input.entityId, "지점 근거 대상", "branch:") !== branchId) {
      throw new Error("지점 근거 대상이 요청 경로와 일치하는지 확인해 주세요.");
    }
    entityId = branchId;
  } else {
    entityId = identifier(input.entityId, "메뉴 근거 대상");
  }
  return {
    entityType,
    entityId,
    fieldName: text(input.fieldName, "근거 필드", 80),
    sourceName: text(input.sourceName, "출처명", 200),
    sourceUrl: sourceUrl(input.sourceUrl),
    checkedAt: date(input.checkedAt, "확인일"),
    note: text(input.note, "근거 설명", 1_000, true),
  };
}

function transitionInput(value: unknown, branchId: string): Omit<StateTransitionInput, "entityId"> & { entityId?: string } {
  const input = record(value, "상태 전환");
  onlyKeys(input, ["entityType", "entityId", "verificationStatus", "publicStatus", "note"], "상태 전환");
  const entityType = enumValue(input.entityType, ["branch", "menu"] as const, "상태 대상");
  const verificationStatus = input.verificationStatus === undefined
    ? undefined
    : enumValue<VerificationStatus>(input.verificationStatus, verificationStatuses, "검증 상태");
  const publicStatus = input.publicStatus === undefined
    ? undefined
    : enumValue<PublicStatus>(input.publicStatus, publicStatuses, "공개 상태");
  if (!verificationStatus && !publicStatus) throw new Error("변경할 상태를 확인해 주세요.");
  if (entityType === "menu" && publicStatus) throw new Error("공개 상태를 확인해 주세요.");
  const entityId = entityType === "menu"
    ? identifier(input.entityId, "메뉴 식별자")
    : input.entityId === undefined ? undefined : identifier(input.entityId, "지점 식별자", "branch:");
  if (entityType === "branch" && entityId && entityId !== branchId) throw new Error("지점 식별자를 확인해 주세요.");
  return {
    entityType,
    ...(entityId ? { entityId } : {}),
    ...(verificationStatus ? { verificationStatus } : {}),
    ...(publicStatus ? { publicStatus } : {}),
    note: text(input.note, "검토 메모", 1_000),
  };
}

export type AdminBranchMutation =
  | { action: "updateBranch"; note: string; branch: BranchUpdateInput }
  | { action: "createMenu"; note: string; menu: MenuInput }
  | { action: "updateMenu"; note: string; menuId: string; menu: MenuInput }
  | { action: "appendEvidence"; note: string; evidence: EvidenceInput }
  | { action: "transitionState"; transition: Omit<StateTransitionInput, "entityId"> & { entityId?: string } };

export function parseAdminBranchMutation(value: unknown, routeBranchId: string): AdminBranchMutation {
  const branchId = identifier(routeBranchId, "지점 식별자", "branch:");
  const input = record(value, "관리자 요청");
  if (input.action === "updateBranch") {
    onlyKeys(input, ["action", "note", "branch"], "관리자 요청");
    return { action: "updateBranch", note: text(input.note, "변경 메모", 1_000), branch: branchInput(input.branch) };
  }
  if (input.action === "createMenu") {
    onlyKeys(input, ["action", "note", "menu"], "관리자 요청");
    return { action: "createMenu", note: text(input.note, "변경 메모", 1_000), menu: menuInput(input.menu) };
  }
  if (input.action === "updateMenu") {
    onlyKeys(input, ["action", "note", "menuId", "menu"], "관리자 요청");
    const menuId = identifier(input.menuId, "메뉴 식별자");
    return { action: "updateMenu", note: text(input.note, "변경 메모", 1_000), menuId, menu: menuInput(input.menu, menuId) };
  }
  if (input.action === "appendEvidence") {
    onlyKeys(input, ["action", "note", "evidence"], "관리자 요청");
    return { action: "appendEvidence", note: text(input.note, "변경 메모", 1_000), evidence: evidenceInput(input.evidence, branchId) };
  }
  if (input.action === "transitionState") {
    onlyKeys(input, ["action", "transition"], "관리자 요청");
    return { action: "transitionState", transition: transitionInput(input.transition, branchId) };
  }
  throw new Error("지원하지 않는 관리자 작업입니다.");
}

export type CandidateCreationInput = {
  shopId: string;
  branchId: string;
  slug: string;
  shopName: string;
  branchName: string | null;
  region: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  sourceName: string;
  sourceUrl: string;
  checkedAt: string;
  evidenceNote: string;
};

export function parseAdminCandidateCreation(value: unknown): { note: string; candidate: CandidateCreationInput } {
  const input = record(value, "후보 생성 요청");
  onlyKeys(input, ["note", "candidate"], "후보 생성 요청");
  const candidate = record(input.candidate, "후보 정보");
  onlyKeys(candidate, ["shopId", "branchId", "slug", "shopName", "branchName", "region", "district", "address", "lat", "lng", "phone", "sourceName", "sourceUrl", "checkedAt", "evidenceNote"], "후보 정보");
  const slug = text(candidate.slug, "슬러그", 100);
  if (!slugPattern.test(slug)) throw new Error("슬러그를 확인해 주세요.");
  return {
    note: text(input.note, "변경 메모", 1_000),
    candidate: {
      shopId: identifier(candidate.shopId, "매장 식별자", "shop:"),
      branchId: identifier(candidate.branchId, "지점 식별자", "branch:"),
      slug,
      shopName: text(candidate.shopName, "매장명", 200),
      branchName: nullableText(candidate.branchName, "지점명", 120),
      region: text(candidate.region, "시·도", 80),
      district: text(candidate.district, "구·시", 100),
      address: text(candidate.address, "주소", 300),
      lat: coordinate(candidate.lat, "위도", -90, 90),
      lng: coordinate(candidate.lng, "경도", -180, 180),
      phone: nullableText(candidate.phone, "전화번호", 40),
      sourceName: text(candidate.sourceName, "출처명", 200),
      sourceUrl: sourceUrl(candidate.sourceUrl),
      checkedAt: date(candidate.checkedAt, "확인일"),
      evidenceNote: text(candidate.evidenceNote, "근거 설명", 1_000, true),
    },
  };
}
