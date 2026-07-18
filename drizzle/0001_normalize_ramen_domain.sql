CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  slug TEXT NOT NULL UNIQUE,
  branch_name TEXT,
  region TEXT NOT NULL,
  district TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lng REAL,
  phone TEXT,
  public_status TEXT NOT NULL CHECK(public_status IN ('active','hidden','closed','moved')),
  verification_status TEXT NOT NULL CHECK(verification_status IN ('verified','candidate','stale','rejected')),
  hours_text TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  price INTEGER,
  availability_status TEXT NOT NULL CHECK(availability_status IN ('available','seasonal','sold_out','unknown')),
  verification_status TEXT NOT NULL CHECK(verification_status IN ('verified','candidate','stale','rejected')),
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_profiles (
  menu_item_id TEXT PRIMARY KEY REFERENCES menu_items(id),
  ramen_types TEXT NOT NULL DEFAULT '[]',
  broth_style TEXT,
  body_level INTEGER CHECK(body_level BETWEEN 1 AND 5),
  spiciness_level INTEGER CHECK(spiciness_level BETWEEN 0 AND 5),
  broth_bases TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  opens_at TEXT,
  closes_at TEXT,
  break_starts_at TEXT,
  break_ends_at TEXT,
  last_order_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0,1))
);

CREATE TABLE IF NOT EXISTS opening_exceptions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  service_date TEXT NOT NULL,
  opens_at TEXT,
  closes_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK(is_closed IN (0,1)),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS source_evidence (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('branch','menu')),
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL DEFAULT 'general',
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  collected_by TEXT NOT NULL DEFAULT 'seed'
);

CREATE TABLE IF NOT EXISTS verification_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('branch','menu')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  next_value TEXT,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('district','neighborhood','station')),
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('quick_started','recommendation_shown','shop_selected','directions_clicked')),
  elapsed_ms INTEGER CHECK(elapsed_ms IS NULL OR elapsed_ms >= 0),
  area_id TEXT,
  radius_km INTEGER CHECK(radius_km IS NULL OR radius_km IN (3,10,30)),
  verification_status TEXT CHECK(verification_status IS NULL OR verification_status IN ('verified','candidate','stale')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO shops (id, name, normalized_name)
SELECT 'shop:' || id, name, replace(lower(name), ' ', '') FROM shop_candidates;

INSERT OR IGNORE INTO branches (
  id, shop_id, slug, branch_name, region, district, address, lat, lng, phone,
  public_status, verification_status, hours_text, last_verified_at
)
SELECT
  'branch:' || id, 'shop:' || id, id, NULL, region, district, address, lat, lng,
  NULLIF(phone, ''),
  CASE WHEN status = 'rejected' THEN 'hidden' ELSE 'active' END,
  CASE status WHEN 'verified' THEN 'verified' WHEN 'rejected' THEN 'rejected' ELSE 'candidate' END,
  NULLIF(trim(hours || CASE WHEN closed = '' THEN '' ELSE ' · ' || closed END), ''),
  verified_at
FROM shop_candidates;

INSERT OR IGNORE INTO menu_items (
  id, branch_id, name, price, availability_status, verification_status, last_verified_at
)
SELECT
  'menu:' || id || ':signature', 'branch:' || id, representative_menu,
  NULLIF(price, 0), 'unknown',
  CASE status WHEN 'verified' THEN 'verified' WHEN 'rejected' THEN 'rejected' ELSE 'candidate' END,
  verified_at
FROM shop_candidates;

INSERT OR IGNORE INTO menu_profiles (
  menu_item_id, ramen_types, broth_style, body_level, spiciness_level, broth_bases, tags
)
SELECT
  'menu:' || id || ':signature', ramen_types, NULLIF(broth_style, 'unknown'),
  body, spiciness, bases, tags
FROM shop_candidates;

INSERT OR IGNORE INTO source_evidence (
  id, entity_type, entity_id, field_name, source_name, source_url, checked_at, note, collected_by
)
SELECT
  'evidence:' || id || ':primary', 'branch', 'branch:' || id, 'general',
  CASE WHEN source_name = '' THEN '수집 출처' ELSE source_name END,
  source_url, updated_at, evidence_note, 'seed'
FROM shop_candidates
WHERE source_url <> '';

INSERT OR IGNORE INTO source_evidence (
  id, entity_type, entity_id, field_name, source_name, source_url, checked_at, note, collected_by
)
SELECT
  'evidence:' || id || ':secondary', 'branch', 'branch:' || id, 'general',
  '보조 출처', secondary_source_url, updated_at, evidence_note, 'seed'
FROM shop_candidates
WHERE secondary_source_url <> '';

INSERT OR IGNORE INTO verification_events (
  id, entity_type, entity_id, action, previous_value, next_value, note, actor, created_at
)
SELECT
  'event:migration:' || id || ':legacy-verification',
  'branch',
  'branch:' || id,
  'migrate_legacy_verification',
  NULL,
  json_object(
    'legacyStatus', status,
    'normalizedVerificationStatus',
    CASE status WHEN 'verified' THEN 'verified' WHEN 'rejected' THEN 'rejected' ELSE 'candidate' END
  ),
  reviewer_note,
  CASE WHEN verified_by = '' THEN 'legacy migration' ELSE verified_by END,
  COALESCE(verified_at, updated_at, created_at)
FROM shop_candidates;

INSERT OR IGNORE INTO areas (id, name, kind, lat, lng) VALUES
  ('anyang', '안양', 'district', 37.3943, 126.9568),
  ('mangwon', '망원', 'neighborhood', 37.5560, 126.9100),
  ('hongdae', '홍대', 'neighborhood', 37.5563, 126.9236),
  ('hapjeong', '합정', 'neighborhood', 37.5495, 126.9139),
  ('pyeongchon-station', '평촌역', 'station', 37.3943, 126.9639),
  ('mangwon-station', '망원역', 'station', 37.5561, 126.9101),
  ('hongik-station', '홍대입구역', 'station', 37.5572, 126.9254),
  ('hapjeong-station', '합정역', 'station', 37.5499, 126.9145);

CREATE INDEX IF NOT EXISTS branches_public_verification_idx ON branches(public_status, verification_status);
CREATE INDEX IF NOT EXISTS branches_coordinates_idx ON branches(lat, lng);
CREATE INDEX IF NOT EXISTS menu_items_branch_idx ON menu_items(branch_id);
CREATE INDEX IF NOT EXISTS evidence_entity_idx ON source_evidence(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS product_events_type_created_idx ON product_events(event_type, created_at);
