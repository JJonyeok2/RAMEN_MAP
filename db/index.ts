import type { VerificationCandidate } from "../app/verification-types";
import type { RamenShop } from "../app/ramen-data";
import { getD1 } from "./d1.ts";

export type { D1DatabaseLike, D1Result, D1Statement } from "./d1.ts";

type CandidateRow = {
  id: string;
  name: string;
  area: string;
  region: VerificationCandidate["region"];
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  representative_menu: string;
  price: number;
  ramen_types: string;
  broth_style: VerificationCandidate["brothStyle"];
  body: number;
  spiciness: number;
  bases: string;
  tags: string;
  hours: string;
  closed: string;
  source_name: string;
  source_url: string;
  secondary_source_url: string;
  evidence_note: string;
  status: VerificationCandidate["status"];
  reviewer_note: string;
  verified_by: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseList<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toCandidate(row: CandidateRow): VerificationCandidate {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    region: row.region,
    district: row.district,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    representativeMenu: row.representative_menu,
    price: row.price,
    ramenTypes: parseList(row.ramen_types),
    brothStyle: row.broth_style,
    body: row.body,
    spiciness: row.spiciness,
    bases: parseList(row.bases),
    tags: parseList(row.tags),
    hours: row.hours,
    closed: row.closed,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    secondarySourceUrl: row.secondary_source_url,
    evidenceNote: row.evidence_note,
    status: row.status,
    reviewerNote: row.reviewer_note,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listVerificationCandidates() {
  const db = await getD1();
  const result = await db
    .prepare("SELECT * FROM shop_candidates ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'hold' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END, area, name")
    .all<CandidateRow>();
  return (result.results ?? []).map(toCandidate);
}

export async function saveVerificationCandidate(candidate: VerificationCandidate) {
  const verifiedAt = candidate.status === "verified" ? new Date().toISOString() : null;
  const verifiedBy = candidate.status === "verified" ? candidate.verifiedBy || "RAMEN MAP 운영자" : "";
  const db = await getD1();
  await db
    .prepare(`
      INSERT INTO shop_candidates (
        id, name, area, region, district, address, lat, lng, phone,
        representative_menu, price, ramen_types, broth_style, body, spiciness,
        bases, tags, hours, closed, source_name, source_url, secondary_source_url,
        evidence_note, status, reviewer_note, verified_by, verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, area=excluded.area, region=excluded.region,
        district=excluded.district, address=excluded.address, lat=excluded.lat,
        lng=excluded.lng, phone=excluded.phone,
        representative_menu=excluded.representative_menu, price=excluded.price,
        ramen_types=excluded.ramen_types, broth_style=excluded.broth_style,
        body=excluded.body, spiciness=excluded.spiciness, bases=excluded.bases,
        tags=excluded.tags, hours=excluded.hours, closed=excluded.closed,
        source_name=excluded.source_name, source_url=excluded.source_url,
        secondary_source_url=excluded.secondary_source_url,
        evidence_note=excluded.evidence_note, status=excluded.status,
        reviewer_note=excluded.reviewer_note, verified_by=excluded.verified_by,
        verified_at=excluded.verified_at, updated_at=CURRENT_TIMESTAMP
    `)
    .bind(
      candidate.id,
      candidate.name,
      candidate.area,
      candidate.region,
      candidate.district,
      candidate.address,
      candidate.lat,
      candidate.lng,
      candidate.phone,
      candidate.representativeMenu,
      candidate.price,
      JSON.stringify(candidate.ramenTypes),
      candidate.brothStyle,
      candidate.body,
      candidate.spiciness,
      JSON.stringify(candidate.bases),
      JSON.stringify(candidate.tags),
      candidate.hours,
      candidate.closed,
      candidate.sourceName,
      candidate.sourceUrl,
      candidate.secondarySourceUrl,
      candidate.evidenceNote,
      candidate.status,
      candidate.reviewerNote,
      verifiedBy,
      verifiedAt,
    )
    .run();
}

export async function listVerifiedShops(): Promise<RamenShop[]> {
  const db = await getD1();
  const result = await db
    .prepare("SELECT * FROM shop_candidates WHERE status = 'verified' AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY area, name")
    .all<CandidateRow>();
  return (result.results ?? []).map((row) => {
    const candidate = toCandidate(row);
    return {
      id: `verified-${candidate.id}`,
      name: candidate.name,
      region: candidate.region,
      district: candidate.district,
      address: candidate.address,
      lat: candidate.lat as number,
      lng: candidate.lng as number,
      types: candidate.ramenTypes.length ? candidate.ramenTypes : ["shoyu"],
      brothStyle: candidate.brothStyle === "unknown" ? "chintan" : candidate.brothStyle,
      signature: candidate.representativeMenu,
      price: candidate.price,
      body: Math.min(5, Math.max(1, candidate.body)) as RamenShop["body"],
      spiciness: Math.min(5, Math.max(0, candidate.spiciness)) as RamenShop["spiciness"],
      bases: candidate.bases.length ? candidate.bases : ["닭"],
      tags: candidate.tags,
      rating: 0,
      hours: candidate.hours,
      closed: candidate.closed,
      vegetarian: false,
      containsPork: candidate.bases.includes("돼지"),
      dataStatus: "verified",
      sourceUrl: candidate.sourceUrl,
      verifiedAt: candidate.verifiedAt ?? undefined,
    };
  });
}
