export const candidateStatuses = ["pending", "verified", "hold", "rejected"] as const;

export type CandidateStatus = (typeof candidateStatuses)[number];

export const createShopCandidatesTableSql = `
  CREATE TABLE IF NOT EXISTS shop_candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    region TEXT NOT NULL,
    district TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL,
    lng REAL,
    phone TEXT NOT NULL DEFAULT '',
    representative_menu TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    ramen_types TEXT NOT NULL DEFAULT '[]',
    broth_style TEXT NOT NULL DEFAULT 'unknown',
    body INTEGER NOT NULL DEFAULT 3,
    spiciness INTEGER NOT NULL DEFAULT 0,
    bases TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    hours TEXT NOT NULL DEFAULT '',
    closed TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    secondary_source_url TEXT NOT NULL DEFAULT '',
    evidence_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'verified', 'hold', 'rejected')),
    reviewer_note TEXT NOT NULL DEFAULT '',
    verified_by TEXT NOT NULL DEFAULT '',
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export const createShopCandidatesStatusIndexSql =
  "CREATE INDEX IF NOT EXISTS shop_candidates_status_idx ON shop_candidates(status)";

export const createShopCandidatesAreaIndexSql =
  "CREATE INDEX IF NOT EXISTS shop_candidates_area_idx ON shop_candidates(area)";
