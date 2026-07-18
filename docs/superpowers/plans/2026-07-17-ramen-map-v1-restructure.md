# RAMEN MAP V1 Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed demo/real-data application with a normalized real-data platform that supports list-first nearby discovery, menu-level preference recommendations, exploration, shop details, and protected verification administration without waiting for a map SDK.

**Architecture:** Introduce runtime domain contracts and application services between UI/API code and D1 repositories. Normalize shops, branches, menus, profiles, evidence, hours, areas, and verification history; then build one deterministic menu-level recommendation engine consumed by both `/nearby` and `/explore`. Keep the map behind an unused adapter boundary until Kakao approval, and remove all demo data from production paths at final cutover.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, vinext 0.0.50, Cloudflare Workers/D1, Node built-in test runner, CSS.

## Global Constraints

- Node.js must remain `>=22.13.0`; do not introduce a second runtime or ORM.
- V1 must work without Kakao Maps, a geocoder, or a routing API.
- Public production code must return only normalized real records in `verified`, `candidate`, or `stale` verification states.
- Demo shops may exist only under `tests/fixtures/` after final cutover.
- Nearby radii are exactly `3`, `10`, then `30` kilometers and all displayed distances are labeled as straight-line distance.
- Recommendation modes are exactly `taste`, `balanced`, and `distance` with weights from the approved design.
- Verified recommendations and unverified candidate suggestions must never be merged into one ranked list.
- Consumer login is out of V1 scope; raw user coordinates must not be persisted.
- Admin writes must fail closed when admin authentication environment is absent or invalid.
- Preserve unrelated untracked duplicate files already present in the worktree.

---

## Target File Map

```text
app/
  page.tsx                         # two-mode home
  nearby/page.tsx                  # fast location-first flow
  explore/page.tsx                 # preference exploration flow
  shops/[slug]/page.tsx            # public detail
  admin/login/page.tsx             # operator sign-in
  admin/page.tsx                   # verification dashboard
  admin/branches/[id]/page.tsx     # branch/menu/evidence editor
  api/v1/areas/route.ts
  api/v1/events/route.ts
  api/v1/recommendations/route.ts
  api/v1/shops/[slug]/route.ts
  api/admin/session/route.ts
  api/admin/branches/route.ts
  api/admin/branches/[id]/route.ts
components/
  mode-card.tsx
  preference-controls.tsx
  recommendation-card.tsx
  verification-badge.tsx
domain/
  ramen.ts                         # runtime enums and entity types
  recommendation.ts                # request/result contracts
  shop-repository.ts               # repository port
features/
  analytics/events.ts
  location/distance.ts
  location/radius-search.ts
  recommendation/intent-parser.ts
  recommendation/scoring.ts
  recommendation/recommend.ts
  recommendation/request.ts
  shops/opening-status.ts
  shops/shop-service.ts
  admin/auth.ts
  admin/admin-service.ts
db/
  d1.ts                            # one Cloudflare binding boundary
  schema.ts                        # schema metadata and row types
  repositories/d1-shop-repository.ts
map/
  map-adapter.ts                    # future SDK port, no provider import in V1
drizzle/
  0001_normalize_ramen_domain.sql
tests/
  fixtures/demo-shops.ts
  domain.test.ts
  normalized-migration.test.mjs
  shop-service.test.ts
  recommendation-v2.test.ts
  request-validation.test.ts
  analytics-events.test.ts
  admin-auth.test.ts
  public-cutover.test.mjs
```

---

### Task 1: Runtime Domain Contracts

**Files:**
- Create: `domain/ramen.ts`
- Create: `domain/recommendation.ts`
- Create: `domain/shop-repository.ts`
- Create: `map/map-adapter.ts`
- Create: `tests/domain.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `BranchSummary`, `ShopDetail`, `MenuItem`, `Area`, `VerificationStatus`, `PublicStatus`, `RecommendationRequest`, `RecommendationResponse`, and `ShopRepository`.
- Consumes: no new application interfaces.

- [ ] **Step 1: Write the failing runtime-contract test**

```ts
// tests/domain.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveVerificationStatus,
  isPublicBranch,
  recommendationModes,
  searchRadiiKm,
  verificationStatuses,
} from "../domain/ramen.ts";

test("publishes only active real branches with usable coordinates", () => {
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "candidate", lat: 37.3, lng: 126.9 }), true);
  assert.equal(isPublicBranch({ publicStatus: "closed", verificationStatus: "verified", lat: 37.3, lng: 126.9 }), false);
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "rejected", lat: 37.3, lng: 126.9 }), false);
  assert.equal(isPublicBranch({ publicStatus: "active", verificationStatus: "verified", lat: null, lng: null }), false);
});

test("locks the approved search and recommendation vocabulary", () => {
  assert.deepEqual(searchRadiiKm, [3, 10, 30]);
  assert.deepEqual(recommendationModes, ["taste", "balanced", "distance"]);
  assert.deepEqual(verificationStatuses, ["verified", "candidate", "stale", "rejected"]);
});

test("marks old verified facts stale using entity-specific windows", () => {
  const now = new Date("2026-07-17T00:00:00.000Z");
  assert.equal(effectiveVerificationStatus("verified", "2026-01-01T00:00:00.000Z", "branch", now), "stale");
  assert.equal(effectiveVerificationStatus("verified", "2026-04-01T00:00:00.000Z", "menu", now), "verified");
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node --experimental-strip-types --test tests/domain.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `domain/ramen.ts`.

- [ ] **Step 3: Implement the runtime enums and entity contracts**

```ts
// domain/ramen.ts
export const ramenTypes = ["shoyu", "shio", "miso", "tonkotsu", "tsukemen", "mazesoba"] as const;
export const brothStyles = ["chintan", "paitan", "dry", "dipping"] as const;
export const brothBases = ["닭", "돼지", "소", "해산물", "채소"] as const;
export const verificationStatuses = ["verified", "candidate", "stale", "rejected"] as const;
export const publicStatuses = ["active", "hidden", "closed", "moved"] as const;
export const recommendationModes = ["taste", "balanced", "distance"] as const;
export const searchRadiiKm = [3, 10, 30] as const;

export type RamenType = (typeof ramenTypes)[number];
export type BrothStyle = (typeof brothStyles)[number];
export type BrothBase = (typeof brothBases)[number];
export type VerificationStatus = (typeof verificationStatuses)[number];
export type PublicStatus = (typeof publicStatuses)[number];
export type RecommendationMode = (typeof recommendationModes)[number];

export interface MenuItem {
  id: string;
  name: string;
  price: number | null;
  ramenTypes: RamenType[];
  brothStyle: BrothStyle | null;
  bodyLevel: 1 | 2 | 3 | 4 | 5 | null;
  spicinessLevel: 0 | 1 | 2 | 3 | 4 | 5 | null;
  brothBases: BrothBase[];
  tags: string[];
  availabilityStatus: "available" | "seasonal" | "sold_out" | "unknown";
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
}

export interface BranchSummary {
  id: string;
  slug: string;
  shopName: string;
  branchName: string | null;
  region: string;
  district: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  publicStatus: PublicStatus;
  verificationStatus: VerificationStatus;
  lastVerifiedAt: string | null;
  openingStatus: "open" | "closed" | "unknown";
  menus: MenuItem[];
}

export interface ShopDetail extends BranchSummary {
  evidence: Array<{ id: string; sourceName: string; sourceUrl: string; checkedAt: string; note: string }>;
  hoursText: string | null;
}

export interface Area {
  id: string;
  name: string;
  kind: "district" | "neighborhood" | "station";
  lat: number;
  lng: number;
}

export function isPublicBranch(value: Pick<BranchSummary, "publicStatus" | "verificationStatus" | "lat" | "lng"> | { publicStatus: PublicStatus; verificationStatus: VerificationStatus; lat: number | null; lng: number | null }) {
  return value.publicStatus === "active" && value.verificationStatus !== "rejected" && Number.isFinite(value.lat) && Number.isFinite(value.lng);
}

export function effectiveVerificationStatus(status: VerificationStatus, checkedAt: string | null, entity: "branch" | "menu", now = new Date()): VerificationStatus {
  if (status !== "verified" || !checkedAt) return status;
  const ageDays = (now.getTime() - new Date(checkedAt).getTime()) / 86_400_000;
  return ageDays > (entity === "branch" ? 90 : 180) ? "stale" : "verified";
}
```

```ts
// domain/recommendation.ts
import type { Area, BranchSummary, BrothBase, BrothStyle, RamenType, RecommendationMode } from "./ramen.ts";

export interface Coordinates { lat: number; lng: number }
export interface TasteIntent {
  ramenTypes: RamenType[];
  brothStyles: BrothStyle[];
  brothBases: BrothBase[];
  bodyTarget: number | null;
  spicinessTarget: number | null;
  avoidRich: boolean;
  avoidSpicy: boolean;
  wantsKarai: boolean;
  freeText: string;
}
export interface RecommendationRequest {
  origin: Coordinates;
  area?: Area;
  mode: RecommendationMode;
  quick: boolean;
  intent: TasteIntent;
}
export interface RecommendationItem {
  branch: BranchSummary;
  menuId: string;
  score: number;
  distanceKm: number;
  reasons: string[];
}
export interface RecommendationResponse {
  radiusKm: 3 | 10 | 30;
  verified: RecommendationItem[];
  candidates: RecommendationItem[];
  expanded: boolean;
}
```

```ts
// domain/shop-repository.ts
import type { Area, BranchSummary, ShopDetail } from "./ramen.ts";
import type { Coordinates } from "./recommendation.ts";

export interface ShopRepository {
  listAreas(): Promise<Area[]>;
  listPublicBranches(origin: Coordinates, radiusKm: 3 | 10 | 30): Promise<BranchSummary[]>;
  getPublicShopBySlug(slug: string): Promise<ShopDetail | null>;
}
```

Create the future-only map port without importing Kakao or another SDK:

```ts
// map/map-adapter.ts
import type { BranchSummary } from "../domain/ramen.ts";
export interface MapAdapter {
  mount(element: HTMLElement, branches: BranchSummary[], onSelect: (branchId: string) => void): void;
  update(branches: BranchSummary[]): void;
  destroy(): void;
}
```

- [ ] **Step 4: Add the domain test to the logic command and run it**

Modify `package.json` so `test:logic` explicitly includes `tests/domain.test.ts`.

Run: `npm run test:logic`

Expected: all existing logic tests plus the two new domain tests PASS.

- [ ] **Step 5: Commit the domain boundary**

```bash
git add domain map/map-adapter.ts tests/domain.test.ts package.json
git commit -m "Add normalized ramen domain contracts"
```

---

### Task 2: Normalized D1 Schema and Existing-Data Migration

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0001_normalize_ramen_domain.sql`
- Create: `tests/normalized-migration.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: status values and entity shapes from Task 1.
- Produces: D1 tables `shops`, `branches`, `menu_items`, `menu_profiles`, `opening_hours`, `opening_exceptions`, `source_evidence`, `verification_events`, `areas`, and privacy-limited `product_events` populated from all eight `shop_candidates` rows.

- [ ] **Step 1: Write the failing migration contract test**

```js
// tests/normalized-migration.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("normalizes all eight seed candidates without losing their signature menu or source", async () => {
  const sql = await readFile(new URL("../drizzle/0001_normalize_ramen_domain.sql", import.meta.url), "utf8");
  for (const table of ["shops", "branches", "menu_items", "menu_profiles", "source_evidence", "verification_events", "areas", "product_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /INSERT OR IGNORE INTO shops[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO branches[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO menu_items[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO source_evidence[\s\S]+FROM shop_candidates/);
  assert.equal((sql.match(/INSERT OR IGNORE INTO areas/g) ?? []).length, 1);
});
```

- [ ] **Step 2: Run the test and verify it fails because migration 0001 is absent**

Run: `node --test tests/normalized-migration.test.mjs`

Expected: FAIL with `ENOENT` for `0001_normalize_ramen_domain.sql`.

- [ ] **Step 3: Add the complete normalized migration**

Create `drizzle/0001_normalize_ramen_domain.sql` with these exact identity rules:

```sql
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
```

After the DDL, migrate every old row with stable IDs:

```sql
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
```

Insert one primary evidence row and an optional secondary row per old candidate, then seed these exact area centers:

```sql
INSERT OR IGNORE INTO areas (id, name, kind, lat, lng) VALUES
  ('anyang', '안양', 'district', 37.3943, 126.9568),
  ('mangwon', '망원', 'neighborhood', 37.5560, 126.9100),
  ('hongdae', '홍대', 'neighborhood', 37.5563, 126.9236),
  ('hapjeong', '합정', 'neighborhood', 37.5495, 126.9139),
  ('pyeongchon-station', '평촌역', 'station', 37.3943, 126.9639),
  ('mangwon-station', '망원역', 'station', 37.5561, 126.9101),
  ('hongik-station', '홍대입구역', 'station', 37.5572, 126.9254),
  ('hapjeong-station', '합정역', 'station', 37.5499, 126.9145);
```

Add these exact indexes after all seed inserts:

```sql
CREATE INDEX IF NOT EXISTS branches_public_verification_idx ON branches(public_status, verification_status);
CREATE INDEX IF NOT EXISTS branches_coordinates_idx ON branches(lat, lng);
CREATE INDEX IF NOT EXISTS menu_items_branch_idx ON menu_items(branch_id);
CREATE INDEX IF NOT EXISTS evidence_entity_idx ON source_evidence(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS product_events_type_created_idx ON product_events(event_type, created_at);
```

- [ ] **Step 4: Export matching schema metadata and row types from `db/schema.ts`**

Replace the old candidate-only metadata with table-name constants and row interfaces matching the migration. Keep `candidateStatuses` only until Task 8 removes the compatibility API.

- [ ] **Step 5: Verify migration integrity and row preservation**

Run:

```bash
sqlite3 /tmp/ramen-map-v1.db ".read drizzle/0000_real_shop_verification.sql" ".read drizzle/0001_normalize_ramen_domain.sql" "PRAGMA foreign_key_check;" "SELECT (SELECT count(*) FROM shops), (SELECT count(*) FROM branches), (SELECT count(*) FROM menu_items), (SELECT count(*) FROM source_evidence), (SELECT count(*) FROM areas);"
```

Expected: no foreign-key output and counts `8|8|8|` followed by an evidence count of at least `8` and area count `8`.

Run: `node --test tests/normalized-migration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Add the migration test to `test:ssr` and commit**

```bash
git add db/schema.ts drizzle/0001_normalize_ramen_domain.sql tests/normalized-migration.test.mjs package.json
git commit -m "Normalize real ramen data schema"
```

---

### Task 3: D1 Repository and Shop Application Service

**Files:**
- Create: `db/d1.ts`
- Create: `db/repositories/d1-shop-repository.ts`
- Create: `features/location/distance.ts`
- Create: `features/shops/opening-status.ts`
- Create: `features/shops/shop-service.ts`
- Create: `tests/shop-service.test.ts`
- Modify: `db/index.ts`

**Interfaces:**
- Consumes: `ShopRepository`, `BranchSummary`, `ShopDetail`, `Area`, and `Coordinates` from Task 1; normalized tables from Task 2.
- Produces: `createShopService(repository)` with `listAreas`, `listNearby`, and `getDetail`; `createD1ShopRepository(db)` implementing `ShopRepository`.

- [ ] **Step 1: Write failing service tests with an in-memory repository**

```ts
// tests/shop-service.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createShopService } from "../features/shops/shop-service.ts";
import type { ShopRepository } from "../domain/shop-repository.ts";
import type { BranchSummary } from "../domain/ramen.ts";

const verified = { id: "b1", slug: "one", shopName: "하나", branchName: null, region: "경기", district: "안양", address: "주소1", lat: 37.39, lng: 126.96, phone: null, publicStatus: "active", verificationStatus: "verified", lastVerifiedAt: null, openingStatus: "unknown", menus: [] } satisfies BranchSummary;
const candidate = { ...verified, id: "b2", slug: "two", shopName: "둘", verificationStatus: "candidate" } satisfies BranchSummary;

const repository: ShopRepository = {
  async listAreas() { return [{ id: "anyang", name: "안양", kind: "district", lat: 37.3943, lng: 126.9568 }]; },
  async listPublicBranches() { return [verified, candidate]; },
  async getPublicShopBySlug(slug) { return slug === "one" ? { ...verified, evidence: [], hoursText: null } : null; },
};

test("keeps verified and candidate branches explicit", async () => {
  const service = createShopService(repository);
  const result = await service.listNearby({ lat: 37.39, lng: 126.96 }, 3);
  assert.deepEqual(result.map((item) => item.verificationStatus), ["verified", "candidate"]);
});

test("returns null for a missing public shop", async () => {
  assert.equal(await createShopService(repository).getDetail("missing"), null);
});
```

- [ ] **Step 2: Run the tests and verify the missing-service failure**

Run: `node --experimental-strip-types --test tests/shop-service.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `features/shops/shop-service.ts`.

- [ ] **Step 3: Centralize D1 access in `db/d1.ts`**

Move the Cloudflare dynamic import and the minimal D1 interfaces out of `db/index.ts`:

```ts
export interface D1Result<T> { results?: T[] }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1DatabaseLike { prepare(sql: string): D1Statement }

export async function getD1(): Promise<D1DatabaseLike> {
  const { env } = await import("cloudflare:workers");
  const db = (env as unknown as { DB?: D1DatabaseLike }).DB;
  if (!db) throw new Error("D1 binding DB is not configured.");
  return db;
}
```

- [ ] **Step 4: Implement distance and the service boundary**

```ts
// features/location/distance.ts
import type { Coordinates } from "../../domain/recommendation.ts";
export function distanceKm(from: Coordinates, to: Coordinates) {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

```ts
// features/shops/shop-service.ts
import type { ShopRepository } from "../../domain/shop-repository.ts";
import type { Coordinates } from "../../domain/recommendation.ts";
export function createShopService(repository: ShopRepository) {
  return {
    listAreas: () => repository.listAreas(),
    listNearby: (origin: Coordinates, radiusKm: 3 | 10 | 30) => repository.listPublicBranches(origin, radiusKm),
    getDetail: (slug: string) => repository.getPublicShopBySlug(slug),
  };
}
```

Implement `openingStatusAt(rows, now, timeZone = "Asia/Seoul")` in `features/shops/opening-status.ts`. It returns `unknown` when no structured rows exist, `closed` for an explicit closure or a time outside every interval, and `open` only when Korean local weekday/time is inside an interval and outside its break. Add fixed-time assertions for open, break, closed day, and unknown to `tests/shop-service.test.ts`.

- [ ] **Step 5: Implement `createD1ShopRepository`**

Use one branch/menu/evidence mapper and these query guarantees:

- Public queries require `branches.public_status = 'active'` and `branches.verification_status IN ('verified','candidate','stale')`.
- Nearby SQL applies a latitude/longitude bounding box; the repository then filters exact Haversine distance before returning.
- Joined menu rows are grouped by `branch_id` without duplicating a branch.
- Invalid JSON arrays map to `[]`, never fabricated defaults.
- Missing profile values stay `null`.
- Branch facts older than 90 days and menu facts older than 180 days use `effectiveVerificationStatus` and return `stale` without mutating stored history.
- Structured hour rows use `openingStatusAt`; absent structured rows return `unknown`.
- Detail evidence is ordered by `checked_at DESC`.

Export `mapBranchRows(rows)` as a pure function and add assertions for grouping two menu rows into one branch in `tests/shop-service.test.ts`.

- [ ] **Step 6: Make `db/index.ts` a compatibility re-export**

Keep existing verification functions temporarily, but import `getD1` and D1 types from `db/d1.ts`; do not leave a second binding implementation.

- [ ] **Step 7: Run service tests, type-check, and commit**

Run: `node --experimental-strip-types --test tests/shop-service.test.ts`

Run: `npx tsc --noEmit`

Expected: both commands exit 0.

```bash
git add db features/location features/shops tests/shop-service.test.ts
git commit -m "Add real shop repository service"
```

---

### Task 4: Menu-Level Intent Parsing and Recommendation Engine

**Files:**
- Create: `features/recommendation/config.ts`
- Create: `features/recommendation/intent-parser.ts`
- Create: `features/recommendation/scoring.ts`
- Create: `features/recommendation/recommend.ts`
- Create: `tests/recommendation-v2.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BranchSummary`, `MenuItem`, `TasteIntent`, `RecommendationRequest`, and `RecommendationResponse` from Task 1; `distanceKm` from Task 3.
- Produces: `parseTasteIntent(text, selections)`, `scoreMenu(input)`, and `recommend(branches, request)`.

- [ ] **Step 1: Write failing scenario tests for all approved invariants**

```ts
// tests/recommendation-v2.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseTasteIntent } from "../features/recommendation/intent-parser.ts";
import { recommend } from "../features/recommendation/recommend.ts";
import type { BranchSummary } from "../domain/ramen.ts";

test("spicy negation wins over stress inference", () => {
  const intent = parseTasteIntent("스트레스받았지만 매운 건 싫어", {});
  assert.equal(intent.wantsKarai, false);
  assert.equal(intent.avoidSpicy, true);
});

test("anti-rich language prefers chintan without excluding an explicit light paitan request", () => {
  assert.deepEqual(parseTasteIntent("느끼한 건 싫어", {}).brothStyles, ["chintan"]);
  assert.deepEqual(parseTasteIntent("느끼하지 않은 백탕", {}).brothStyles, ["paitan"]);
});

test("returns verified results separately from candidates", () => {
  const branches = makeScenarioBranches() as BranchSummary[];
  const response = recommend(branches, {
    origin: { lat: 37.39, lng: 126.96 }, mode: "balanced", quick: false,
    intent: parseTasteIntent("시오 청탕", {}),
  });
  assert.ok(response.verified.every((item) => item.branch.verificationStatus === "verified"));
  assert.ok(response.candidates.every((item) => item.branch.verificationStatus !== "verified"));
});

test("does not relax an avoid-spicy hard constraint", () => {
  const response = recommend(makeScenarioBranches(), {
    origin: { lat: 37.39, lng: 126.96 }, mode: "distance", quick: true,
    intent: parseTasteIntent("맵찔이라 안 매운 것", {}),
  });
  assert.ok([...response.verified, ...response.candidates].every((item) => {
    const menu = item.branch.menus.find((value) => value.id === item.menuId);
    return (menu?.spicinessLevel ?? 0) <= 1;
  }));
});
```

Define `makeScenarioBranches()` in the same test file with at least one verified chintan, one verified paitan, one candidate karai, and one branch outside 3km but inside 10km.

- [ ] **Step 2: Run the tests and verify missing recommendation modules**

Run: `node --experimental-strip-types --test tests/recommendation-v2.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement configuration and parser**

```ts
// features/recommendation/config.ts
export const modeWeights = {
  taste: { taste: 60, distance: 20, opening: 10, trust: 10 },
  balanced: { taste: 40, distance: 30, opening: 20, trust: 10 },
  distance: { taste: 15, distance: 55, opening: 20, trust: 10 },
} as const;
```

`parseTasteIntent` must start from an empty `TasteIntent`, merge button selections, then apply natural-language rules in this order: explicit exclusions, negation-safe positive terms, descriptive inference, mood inference. Preserve the existing Korean negation cases from `tests/recommendation.test.ts`.

Export `PreferenceSelections` with optional `ramenTypes`, `brothStyles`, `brothBases`, `bodyTarget`, and `spicinessTarget` fields. `parseTasteIntent(text: string, selections: PreferenceSelections)` is the only parser entry point used by the request layer.

- [ ] **Step 4: Implement menu scoring**

Normalize each component to `0..1`:

- taste: exact requested types/styles/bases plus body/spiciness proximity
- distance: `max(0, 1 - distanceKm / radiusKm)`
- opening: open `1`, unknown `0.45`, closed `0`
- trust: verified `1`, stale `0.55`, candidate `0.35`

Return integer score `0..100` and two deterministic Korean reason strings. A menu that violates `avoidSpicy` receives no score and is excluded.

- [ ] **Step 5: Implement recommendation grouping and radius selection**

`recommend` must:

1. Evaluate every available/unknown menu per public branch.
2. Pick the highest-scoring menu per branch.
3. Select the smallest radius in `[3,10,30]` containing at least three eligible branches, or `30` when fewer exist.
4. Sort verified items by score then distance.
5. Put stale/candidate items only in `candidates`.
6. Return at most three verified items and at most three candidate items.
7. Exclude currently closed branches when `request.quick` is true.

- [ ] **Step 6: Run old and new recommendation suites**

Run: `npm run test:logic`

Expected: old behavior tests and all V2 scenario tests PASS. Old tests may import legacy functions until Task 8 moves them to fixtures.

- [ ] **Step 7: Commit the deterministic engine**

```bash
git add features/recommendation tests/recommendation-v2.test.ts package.json
git commit -m "Add menu level recommendation engine"
```

---

### Task 5: Validated Public APIs

**Files:**
- Create: `features/recommendation/request.ts`
- Create: `features/analytics/events.ts`
- Create: `tests/request-validation.test.ts`
- Create: `tests/analytics-events.test.ts`
- Create: `app/api/v1/areas/route.ts`
- Create: `app/api/v1/events/route.ts`
- Create: `app/api/v1/recommendations/route.ts`
- Create: `app/api/v1/shops/[slug]/route.ts`
- Modify: `app/api/shops/route.ts`

**Interfaces:**
- Consumes: D1 repository/service from Task 3 and recommendation engine from Task 4.
- Produces: validated JSON APIs with no demo fallback and privacy-limited events for the 60-second decision metric.

- [ ] **Step 1: Write failing request-validation tests**

```ts
// tests/request-validation.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseRecommendationRequest } from "../features/recommendation/request.ts";

test("accepts an approved mode and finite Korean coordinates", () => {
  const value = parseRecommendationRequest({ origin: { lat: 37.39, lng: 126.96 }, mode: "balanced", quick: true, selections: {}, text: "청탕" });
  assert.equal(value.mode, "balanced");
  assert.equal(value.quick, true);
});

test("rejects invalid modes and out-of-range coordinates", () => {
  assert.throws(() => parseRecommendationRequest({ origin: { lat: 191, lng: 126.96 }, mode: "fast" }), /위치|추천/);
});
```

```ts
// tests/analytics-events.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseProductEvent } from "../features/analytics/events.ts";

test("accepts decision timing without accepting coordinates or free text", () => {
  const event = parseProductEvent({ sessionId: "b8a3f064-9462-4a3b-a7f4-c5f9e0e00a11", eventType: "directions_clicked", elapsedMs: 42000, areaId: "anyang", radiusKm: 3, verificationStatus: "verified" });
  assert.equal(event.elapsedMs, 42000);
  assert.equal("lat" in event, false);
  assert.throws(() => parseProductEvent({ ...event, eventType: "custom", lat: 37.3 }), /이벤트/);
});
```

- [ ] **Step 2: Run the test and verify the missing parser failure**

Run: `node --experimental-strip-types --test tests/request-validation.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict request parsing**

`parseRecommendationRequest` must validate object shape, latitude `-90..90`, longitude `-180..180`, one approved mode, boolean `quick`, text length at most 500, and selection arrays containing only runtime domain values. It returns a `RecommendationRequest` by calling `parseTasteIntent`.

`parseProductEvent` accepts only the four schema event types, a UUID session ID, nonnegative elapsed milliseconds, an approved radius, optional area ID, and a public verification status. Hash `sessionId` with SHA-256 before insert; never retain request coordinates, natural-language text, IP-derived location, or user agent.

- [ ] **Step 4: Implement API route handlers**

- `GET /api/v1/areas` returns `{ areas }` from `shopService.listAreas()`.
- `POST /api/v1/events` validates, hashes, and inserts one `product_events` row, then returns 204.
- `POST /api/v1/recommendations` parses JSON, gets branches at 30km once, runs `recommend`, and returns `{ result }` with `Cache-Control: no-store`.
- `GET /api/v1/shops/[slug]` returns `{ shop }` or a 404 `{ error: "매장을 찾지 못했습니다." }`.
- Validation errors return 400; missing D1 or query failure returns 503. No handler imports `RAMEN_SHOPS` or returns test fixtures.
- Existing `GET /api/shops` becomes a real-data compatibility response from the D1 repository and includes verified, candidate, and stale records explicitly.

- [ ] **Step 5: Run validation, type, and build checks**

Run: `node --experimental-strip-types --test tests/request-validation.test.ts tests/analytics-events.test.ts`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: all commands exit 0 and build output lists the three `/api/v1` routes.

- [ ] **Step 6: Commit the public API boundary**

```bash
git add app/api features/recommendation/request.ts features/analytics tests/request-validation.test.ts tests/analytics-events.test.ts
git commit -m "Add validated real data APIs"
```

---

### Task 6: Two-Mode Home and Nearby Fast Flow

**Files:**
- Replace: `app/page.tsx`
- Create: `app/nearby/page.tsx`
- Create: `components/mode-card.tsx`
- Create: `components/recommendation-card.tsx`
- Create: `components/verification-badge.tsx`
- Create: `features/location/radius-search.ts`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `/api/v1/recommendations`, browser geolocation helper, `RecommendationResponse`.
- Produces: simple home and 60-second nearby flow with no map dependency.

- [ ] **Step 1: Change SSR assertions first**

Update `tests/rendered-html.test.mjs` to require these home strings:

```js
assert.match(html, /배고파요/);
assert.match(html, /빨리 찾기/);
assert.match(html, /라멘 탐방/);
assert.doesNotMatch(html, /전국 17개 시·도|DEMO DATA|창작 데모/);
```

Add static assertions that `app/nearby/page.tsx` contains `3km`, `10km`, `30km`, `현재 위치`, `직선거리`, and all three mode labels.

- [ ] **Step 2: Run SSR tests and verify they fail against the old map-first home**

Run: `npm run test:ssr`

Expected: FAIL because the old home lacks the approved two-mode copy and still renders demo text.

- [ ] **Step 3: Replace the home with two primary mode cards**

`app/page.tsx` becomes a server-renderable page with no map SDK loader and no D1 fetch. Render two `ModeCard` links:

```tsx
<ModeCard href="/nearby" eyebrow="QUICK PICK" title="배고파요 · 빨리 찾기" description="현재 위치에서 지금 갈 만한 라멘집 3곳을 골라드려요." />
<ModeCard href="/explore" eyebrow="RAMEN TOUR" title="라멘 탐방" description="지역과 취향으로 새로운 한 그릇을 천천히 찾아보세요." />
```

- [ ] **Step 4: Implement the nearby client flow**

The page state machine is exactly:

```ts
type NearbyState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "choosing-area"; message: string }
  | { status: "loading" }
  | { status: "results"; result: RecommendationResponse }
  | { status: "error"; message: string };
```

On location success, POST `quick: true`, default mode `distance`, empty intent, and the coordinates. On permission denial/error, fetch `/api/v1/areas` and offer area buttons. Show exactly three verified result cards when present and a separately titled `검증 전 후보` list. Provide `다시 골라줘`, `취향 추가`, and an external map search link per result.

Generate one random session UUID in `sessionStorage` and emit `quick_started`, `recommendation_shown`, `shop_selected`, and `directions_clicked` to `/api/v1/events`. Send elapsed milliseconds from quick start, selected area ID, chosen radius, and selected result verification status; never send coordinates or free text to the event endpoint.

- [ ] **Step 5: Build accessible shared result components**

`RecommendationCard` must display shop name, matched menu, price when known, straight-line distance, up to two reasons, opening status, verification badge, last verified date, and detail link. `VerificationBadge` maps verified/candidate/stale to `검증 완료/검증 대기/재확인 필요`.

- [ ] **Step 6: Replace map-layout CSS with responsive two-mode styles**

Keep existing paper/red visual identity, but remove selectors used only by the old fake map, marker clusters, and chat overlay after their JSX is removed. At `max-width: 720px`, mode cards and result cards become one column; touch targets remain at least 44px tall.

- [ ] **Step 7: Run SSR, lint, and build checks**

Run: `npm run test:ssr`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0; `/` and `/nearby` appear in route output; no demo copy renders on `/`.

- [ ] **Step 8: Commit the fast consumer flow**

```bash
git add app/page.tsx app/nearby components features/location app/globals.css tests/rendered-html.test.mjs
git commit -m "Build nearby quick pick flow"
```

---

### Task 7: Ramen Exploration and Real Shop Detail

**Files:**
- Create: `app/explore/page.tsx`
- Create: `app/shops/[slug]/page.tsx`
- Create: `components/preference-controls.tsx`
- Create: `tests/exploration-contract.test.mjs`
- Modify: `app/globals.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: `/api/v1/areas`, `/api/v1/recommendations`, `/api/v1/shops/[slug]`, and domain runtime values.
- Produces: menu-level filter/chat combination, three recommendation modes, separate candidate section, and evidence-backed shop detail.

- [ ] **Step 1: Write failing exploration contract assertions**

```js
// tests/exploration-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exploration combines quick preferences, natural language, and ranking mode", async () => {
  const page = await readFile(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
  for (const copy of ["청탕", "백탕", "쇼유", "시오", "츠케멘", "마제소바", "취향 우선", "균형 추천", "가까운 곳 우선", "추가로 원하는 맛을 말해보세요"]) {
    assert.match(page, new RegExp(copy));
  }
  assert.match(page, /\/api\/v1\/recommendations/);
  assert.match(page, /검증 전 후보/);
});
```

- [ ] **Step 2: Run and verify the missing-page failure**

Run: `node --test tests/exploration-contract.test.mjs`

Expected: FAIL with `ENOENT` for `app/explore/page.tsx`.

- [ ] **Step 3: Implement `PreferenceControls`**

Expose controlled props for arrays of ramen types, broth styles, bases, body target, spiciness target, and natural-language text. Buttons are multi-select except body/spiciness. Keep labels Korean and serialize only domain-approved values.

- [ ] **Step 4: Implement exploration request and results**

Require an area before first search unless browser location is already available. Default to `balanced`. POST the merged selections and text, show verified results first, candidate results under `검증 전 후보`, and show the radius-expansion explanation when `result.expanded` is true.

- [ ] **Step 5: Implement server-rendered shop detail**

Resolve the slug via the D1 service, call `notFound()` when absent, and render all menus rather than one signature menu. Show source links, checked dates, verification badges, unknown-field copy, straight facts only, and an external map search link built from the address.

- [ ] **Step 6: Run exploration, SSR, type, and build checks**

Run: `node --test tests/exploration-contract.test.mjs`

Run: `npm run test:ssr`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: all commands exit 0 and routes `/explore` and `/shops/[slug]` appear.

- [ ] **Step 7: Commit exploration and detail**

```bash
git add app/explore app/shops components/preference-controls.tsx app/globals.css tests/exploration-contract.test.mjs package.json
git commit -m "Add ramen exploration and details"
```

---

### Task 8: Protected Normalized Admin Workflow

**Files:**
- Create: `features/admin/auth.ts`
- Create: `features/admin/admin-service.ts`
- Create: `tests/admin-auth.test.ts`
- Create: `app/admin/login/page.tsx`
- Replace: `app/admin/page.tsx`
- Create: `app/admin/branches/[id]/page.tsx`
- Create: `app/api/admin/session/route.ts`
- Create: `app/api/admin/branches/route.ts`
- Create: `app/api/admin/branches/[id]/route.ts`
- Delete: `app/api/verification/route.ts`
- Delete: `app/verification-types.ts`
- Modify: `db/index.ts`
- Replace: `app/verify/page.tsx` with a redirect to `/admin`
- Delete: `app/verify/verify.css`

**Interfaces:**
- Consumes: normalized D1 tables and domain status values.
- Produces: fail-closed HMAC admin session and audited branch/menu/evidence editing.

- [ ] **Step 1: Write failing authentication tests**

```ts
// tests/admin-auth.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, verifySessionToken } from "../features/admin/auth.ts";

test("round-trips a signed unexpired admin session", async () => {
  const token = await createSessionToken("secret-at-least-32-characters-long", 1_800_000_000);
  assert.equal(await verifySessionToken(token, "secret-at-least-32-characters-long", 1_799_999_000), true);
});

test("rejects tampering, expiry, and absent secrets", async () => {
  const token = await createSessionToken("secret-at-least-32-characters-long", 1000);
  assert.equal(await verifySessionToken(`${token}x`, "secret-at-least-32-characters-long", 999), false);
  assert.equal(await verifySessionToken(token, "secret-at-least-32-characters-long", 1001), false);
  await assert.rejects(() => createSessionToken("", 1000), /설정/);
});
```

- [ ] **Step 2: Run and verify the missing-auth failure**

Run: `node --experimental-strip-types --test tests/admin-auth.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement Web Crypto HMAC sessions**

Use `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` only on the server. The session payload is `{ role: "admin", exp: epochSeconds }`, encoded as base64url and signed with HMAC-SHA-256. The cookie is `ramen_admin`, `HttpOnly`, `Secure`, `SameSite=Strict`, path `/`, maximum age 8 hours. Missing env causes login and all writes to return 503/deny rather than bypassing auth.

- [ ] **Step 4: Implement the normalized admin service**

The service must list branches by verification/public state, load one branch with menus/evidence/history, update branch fields and structured weekly hours, create/update menu/profile, append evidence, and transition state. Every mutation runs inside a D1 batch containing the data update and an inserted `verification_events` record with actor `RAMEN MAP 운영자`.

- [ ] **Step 5: Implement login and protected route handlers**

`POST /api/admin/session` compares a SHA-256 hash of the submitted password with `ADMIN_PASSWORD_HASH` using a constant-time byte comparison, sets the signed cookie, and never returns the password/hash. Every `/api/admin/*` mutation calls `requireAdminSession` before reading its body.

Every `/admin` server page verifies the signed cookie before loading data and redirects an unauthenticated request to `/admin/login`. Delete the legacy flat verification API and its candidate type after the normalized admin routes pass their tests; remove the old candidate write exports from `db/index.ts`.

- [ ] **Step 6: Replace the flat verification screen**

The admin dashboard shows counts for verified/candidate/stale/rejected and active/hidden/closed/moved. The editor has separate panels for branch facts, structured weekly hours, each menu/profile, evidence, and event history. State transitions require a reviewer note. `/verify` performs a server redirect to `/admin`; no public header links to either path.

- [ ] **Step 7: Run auth, lint, type, build, and existing data tests**

Run: `node --experimental-strip-types --test tests/admin-auth.test.ts`

Run: `npm run lint`

Run: `npx tsc --noEmit`

Run: `npm test`

Expected: all commands exit 0; admin write tests prove unauthenticated rejection.

- [ ] **Step 8: Commit protected administration**

```bash
git add features/admin app/admin app/api/admin app/verify tests/admin-auth.test.ts
git commit -m "Protect normalized verification admin"
```

---

### Task 9: Production Demo Cutover, Documentation, and Complete Verification

**Files:**
- Move: `app/ramen-data.ts` → `tests/fixtures/demo-shops.ts`
- Delete: `app/recommendation.ts`
- Update: all legacy recommendation tests to import fixtures or V2 modules
- Create: `tests/public-cutover.test.mjs`
- Modify: `README.md`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `tests/verification-data.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: every prior task.
- Produces: a production build with no demo imports, one V2 recommendation path, updated docs, and a complete evidence-based verification record.

- [ ] **Step 1: Write the failing public-cutover test**

```js
// tests/public-cutover.test.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const value = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(value) : [value];
  }))).flat();
}

test("keeps demo records out of production application files", async () => {
  const files = (await walk(new URL("../app", import.meta.url).pathname))
    .filter((file) => /\.(ts|tsx)$/.test(file));
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /RAMEN_SHOPS|demo-seoul|창작 데모|DEMO DATA/);
});
```

- [ ] **Step 2: Run and verify it fails against legacy production files**

Run: `node --test tests/public-cutover.test.mjs`

Expected: FAIL because `app/ramen-data.ts` and legacy page/recommendation references still exist.

- [ ] **Step 3: Move fixtures and delete legacy application modules**

Move the 24 invented records under `tests/fixtures/demo-shops.ts` only if an old regression still needs them. Rewrite useful language-negation tests against `parseTasteIntent`; delete tests that assert invented shop IDs or ratings. Remove `app/ramen-data.ts`, `app/recommendation.ts`, all `RAMEN_SHOPS` imports, fake country markers, and Kakao SDK loader code from production.

- [ ] **Step 4: Update data and rendering tests to the normalized contract**

`tests/verification-data.test.mjs` must assert migration 0001, eight migrated rows, normalized tables, and `/admin` rather than the old flat `/verify` editor. `tests/rendered-html.test.mjs` must assert two-mode home copy and no demo fallback.

- [ ] **Step 5: Update README with the real V1 behavior**

Document the two modes, real-data statuses, 3/10/30km straight-line behavior, admin env names, D1 migrations, no-map operation, test commands, and Kakao as a deferred adapter. Remove claims that the current public UI is a nationwide demo map.

- [ ] **Step 6: Run the complete local evidence suite**

Run, in this order:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
git diff --check
sqlite3 /tmp/ramen-map-final.db ".read drizzle/0000_real_shop_verification.sql" ".read drizzle/0001_normalize_ramen_domain.sql" "PRAGMA integrity_check;" "PRAGMA foreign_key_check;" "SELECT count(*) FROM shops;" "SELECT count(*) FROM branches;" "SELECT count(*) FROM menu_items;"
```

Expected:

- all test files PASS with zero failures
- lint/type/build exit 0
- diff check prints nothing
- SQLite prints `ok`, no foreign-key rows, then `8`, `8`, `8`
- build route list includes `/`, `/nearby`, `/explore`, `/shops/[slug]`, `/admin`, and all `/api/v1` routes

- [ ] **Step 7: Commit final cutover**

```bash
git add app components domain features db drizzle tests README.md package.json
git commit -m "Cut over RAMEN MAP to real data V1"
```

- [ ] **Step 8: Perform a requirement-by-requirement completion audit**

Read `docs/superpowers/specs/2026-07-17-ramen-map-product-redesign-design.md` sections 3 and 17. For every included V1 item and completion condition, record the exact file, test, command output, or rendered route that proves it. Treat missing direct evidence as unfinished work and fix it before deployment.

- [ ] **Step 9: Publish only after the audit is complete**

Use the Sites build/hosting workflow because `.openai/hosting.json` exists: commit the exact validated source, push that commit to GitHub and the Sites source branch, package `dist` plus both migrations, save one site version, deploy privately, and verify production `/api/v1/areas`, one real shop detail, and a recommendation response. Do not make the site public until admin authentication environment variables are configured and an unauthenticated admin write is proven to return 401/403.
