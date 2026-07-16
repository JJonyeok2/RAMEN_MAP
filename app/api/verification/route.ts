import { NextResponse } from "next/server";
import { listVerificationCandidates, saveVerificationCandidate } from "../../../db";
import { candidateStatuses } from "../../../db/schema";
import {
  BROTH_STYLE_LABELS,
  RAMEN_TYPE_LABELS,
  REGIONS,
  type BrothBase,
} from "../../ramen-data";
import type { VerificationCandidate } from "../../verification-types";

export const dynamic = "force-dynamic";

const brothBases: BrothBase[] = ["닭", "돼지", "소", "해산물", "채소"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function number(value: unknown, fallback: number | null = 0) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeCandidate(value: unknown): VerificationCandidate {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const ramenTypes = stringList(input.ramenTypes).filter((item) => item in RAMEN_TYPE_LABELS);
  const bases = stringList(input.bases).filter((item): item is BrothBase =>
    brothBases.includes(item as BrothBase),
  );
  const status = candidateStatuses.includes(input.status as (typeof candidateStatuses)[number])
    ? (input.status as VerificationCandidate["status"])
    : "pending";
  const brothStyle = input.brothStyle === "unknown" ||
    (typeof input.brothStyle === "string" && input.brothStyle in BROTH_STYLE_LABELS)
    ? (input.brothStyle as VerificationCandidate["brothStyle"])
    : "unknown";
  const region = REGIONS.includes(input.region as (typeof REGIONS)[number])
    ? (input.region as VerificationCandidate["region"])
    : "서울";

  return {
    id: text(input.id) || crypto.randomUUID(),
    name: text(input.name),
    area: text(input.area),
    region,
    district: text(input.district),
    address: text(input.address),
    lat: number(input.lat, null),
    lng: number(input.lng, null),
    phone: text(input.phone),
    representativeMenu: text(input.representativeMenu),
    price: Math.max(0, Math.round(number(input.price, 0) ?? 0)),
    ramenTypes: ramenTypes as VerificationCandidate["ramenTypes"],
    brothStyle,
    body: Math.min(5, Math.max(1, Math.round(number(input.body, 3) ?? 3))),
    spiciness: Math.min(5, Math.max(0, Math.round(number(input.spiciness, 0) ?? 0))),
    bases,
    tags: stringList(input.tags).map((item) => item.trim()).filter(Boolean),
    hours: text(input.hours),
    closed: text(input.closed),
    sourceName: text(input.sourceName),
    sourceUrl: text(input.sourceUrl),
    secondarySourceUrl: text(input.secondarySourceUrl),
    evidenceNote: text(input.evidenceNote),
    status,
    reviewerNote: text(input.reviewerNote),
    verifiedBy: text(input.verifiedBy),
    verifiedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function validate(candidate: VerificationCandidate) {
  const errors: string[] = [];
  if (!candidate.name) errors.push("매장명");
  if (!candidate.area) errors.push("검증 지역");
  if (!candidate.address) errors.push("주소");
  if (candidate.status === "verified") {
    if (candidate.lat === null || candidate.lng === null) errors.push("좌표");
    if (!candidate.representativeMenu) errors.push("대표 메뉴");
    if (!candidate.ramenTypes.length) errors.push("메뉴 분류");
    if (candidate.brothStyle === "unknown") errors.push("청탕/백탕 분류");
    if (!candidate.sourceUrl) errors.push("출처 URL");
  }
  return errors;
}

export async function GET() {
  try {
    return NextResponse.json({ candidates: await listVerificationCandidates() });
  } catch (error) {
    console.error("Failed to list verification candidates", error);
    return NextResponse.json({ error: "검증 DB를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const candidate = normalizeCandidate(await request.json());
    const missing = validate(candidate);
    if (missing.length) {
      return NextResponse.json(
        { error: `${missing.join(", ")} 항목을 확인해 주세요.` },
        { status: 400 },
      );
    }
    await saveVerificationCandidate(candidate);
    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    console.error("Failed to save verification candidate", error);
    return NextResponse.json({ error: "검증 내용을 저장하지 못했습니다." }, { status: 500 });
  }
}
