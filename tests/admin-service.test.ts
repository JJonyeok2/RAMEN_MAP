import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import type { D1DatabaseLike, D1Statement } from "../db/d1.ts";
import { createAdminService } from "../features/admin/admin-service.ts";

type CapturedStatement = D1Statement & { sql: string; bindings: unknown[] };

function capturedDatabase(
  firstResult?: (statement: CapturedStatement) => unknown,
  allResult?: (statement: CapturedStatement) => unknown[],
) {
  const batches: CapturedStatement[][] = [];
  const db: D1DatabaseLike = {
    prepare(sql) {
      const statement: CapturedStatement = {
        sql,
        bindings: [],
        bind(...values) {
          statement.bindings = values;
          return statement;
        },
        async all<T>() { return { results: (allResult?.(statement) ?? []) as T[] }; },
        async first<T>() { return (firstResult?.(statement) ?? null) as T | null; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements as CapturedStatement[]);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db, batches };
}

function concurrentDatabase(beforeBatch: (database: DatabaseSync) => void) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE branches (
      id TEXT PRIMARY KEY, branch_name TEXT, region TEXT NOT NULL, district TEXT NOT NULL,
      address TEXT NOT NULL, lat REAL, lng REAL, phone TEXT, hours_text TEXT,
      verification_status TEXT NOT NULL, public_status TEXT NOT NULL,
      last_verified_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE opening_hours (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, weekday INTEGER NOT NULL,
      opens_at TEXT, closes_at TEXT, break_starts_at TEXT, break_ends_at TEXT,
      last_order_at TEXT, is_closed INTEGER NOT NULL
    );
    CREATE TABLE menu_items (
      id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, name TEXT NOT NULL, price INTEGER,
      availability_status TEXT NOT NULL, verification_status TEXT NOT NULL,
      last_verified_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE menu_profiles (
      menu_item_id TEXT PRIMARY KEY, ramen_types TEXT NOT NULL, broth_style TEXT,
      body_level INTEGER, spiciness_level INTEGER, broth_bases TEXT NOT NULL, tags TEXT NOT NULL
    );
    CREATE TABLE verification_events (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, previous_value TEXT, next_value TEXT, note TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO branches VALUES (
      'branch:1', '본점', '서울', '마포구', '기존 주소', 37.5, 126.9, NULL, NULL,
      'candidate', 'hidden', NULL, '2026-07-17T00:00:00.000Z'
    );
    INSERT INTO opening_hours VALUES (
      'hours:old', 'branch:1', 1, '11:00', '20:00', NULL, NULL, '19:30', 0
    );
    INSERT INTO menu_items VALUES (
      'menu:1', 'branch:1', '기존 시오', 10000, 'seasonal', 'candidate', NULL,
      '2026-07-17T00:00:00.000Z'
    );
    INSERT INTO menu_profiles VALUES (
      'menu:1', '["shio"]', 'chintan', 2, 0, '["닭"]', '["기존"]'
    );
  `);

  let didInterleave = false;
  const db: D1DatabaseLike = {
    prepare(sql) {
      const statement: CapturedStatement = {
        sql,
        bindings: [],
        bind(...values) {
          statement.bindings = values;
          return statement;
        },
        async all<T>() {
          return { results: database.prepare(sql).all(...statement.bindings as SQLInputValue[]) as T[] };
        },
        async first<T>() {
          return (database.prepare(sql).get(...statement.bindings as SQLInputValue[]) ?? null) as T | null;
        },
        async run() {
          const result = database.prepare(sql).run(...statement.bindings as SQLInputValue[]);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      if (!didInterleave) {
        beforeBatch(database);
        didInterleave = true;
      }
      database.exec("BEGIN");
      try {
        const results = (statements as CapturedStatement[]).map((statement) => {
          const result = database.prepare(statement.sql).run(...statement.bindings as SQLInputValue[]);
          return { meta: { changes: Number(result.changes) } };
        });
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, db };
}

const branchPreimage = {
  branch_name: "구 본점",
  region: "서울",
  district: "마포구",
  address: "구 주소",
  lat: 37.5,
  lng: 126.9,
  phone: "02-111-1111",
  hours_text: "11:00-20:00",
  updated_at: "2026-07-17T00:00:00.000Z",
};

test("updates branch facts and weekly hours with an audit event in one D1 batch", async () => {
  const { db, batches } = capturedDatabase((statement) => (
    /FROM branches WHERE id/.test(statement.sql) ? branchPreimage : null
  ));
  const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");

  await service.updateBranch("branch:1", {
    branchName: "본점",
    region: "서울",
    district: "마포구",
    address: "서울 마포구 월드컵로",
    lat: 37.55,
    lng: 126.91,
    phone: "02-000-0000",
    hoursText: "매일 11:00-21:00",
    weeklyHours: [{
      weekday: 1,
      opensAt: "11:00",
      closesAt: "21:00",
      breakStartsAt: null,
      breakEndsAt: null,
      lastOrderAt: "20:30",
      isClosed: false,
    }],
  }, "공식 채널 재확인");

  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  const audit = batches[0].at(-1)!;
  assert.match(audit.sql, /INSERT INTO verification_events/);
  assert.ok(audit.bindings.includes("RAMEN MAP 운영자"));
  assert.ok(audit.bindings.includes("공식 채널 재확인"));
});

test("rejects a nonexistent branch update before batching", async () => {
  const { db, batches } = capturedDatabase(() => null);
  const service = createAdminService(db);
  await assert.rejects(() => service.updateBranch("branch:missing", {
    branchName: null,
    region: "서울",
    district: "마포구",
    address: "서울 마포구 테스트로 1",
    lat: 37.55,
    lng: 126.91,
    phone: null,
    hoursText: null,
    weeklyHours: [],
  }, "공식 정보 확인"), /찾지 못했습니다/);
  assert.equal(batches.length, 0);
});

test("audits exact canonical before and after branch snapshots", async () => {
  const existingHours = [{
    id: "hours:old",
    branch_id: "branch:1",
    weekday: 1,
    opens_at: "11:00",
    closes_at: "20:00",
    break_starts_at: null,
    break_ends_at: null,
    last_order_at: "19:30",
    is_closed: 0,
  }];
  const { db, batches } = capturedDatabase(
    (statement) => /FROM branches WHERE id/.test(statement.sql) ? branchPreimage : null,
    (statement) => /FROM opening_hours/.test(statement.sql) ? existingHours : [],
  );
  const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");

  await service.updateBranch("branch:1", {
    branchName: "  새 본점  ",
    region: " 서울 ",
    district: " 마포구 ",
    address: " 새 주소 ",
    lat: 37.55,
    lng: 126.91,
    phone: " 02-222-2222 ",
    hoursText: " 12:00-21:00 ",
    weeklyHours: [{
      weekday: 2,
      opensAt: "12:00",
      closesAt: "21:00",
      breakStartsAt: null,
      breakEndsAt: null,
      lastOrderAt: "20:30",
      isClosed: false,
    }],
  }, "공식 채널 재확인");

  const audit = batches[0].at(-1)!;
  assert.deepEqual(JSON.parse(String(audit.bindings[4])), {
    branchName: "구 본점",
    region: "서울",
    district: "마포구",
    address: "구 주소",
    lat: 37.5,
    lng: 126.9,
    phone: "02-111-1111",
    hoursText: "11:00-20:00",
    weeklyHours: [{
      weekday: 1,
      opensAt: "11:00",
      closesAt: "20:00",
      breakStartsAt: null,
      breakEndsAt: null,
      lastOrderAt: "19:30",
      isClosed: false,
    }],
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(String(audit.bindings[5])), {
    branchName: "새 본점",
    region: "서울",
    district: "마포구",
    address: "새 주소",
    lat: 37.55,
    lng: 126.91,
    phone: "02-222-2222",
    hoursText: "12:00-21:00",
    weeklyHours: [{
      weekday: 2,
      opensAt: "12:00",
      closesAt: "21:00",
      breakStartsAt: null,
      breakEndsAt: null,
      lastOrderAt: "20:30",
      isClosed: false,
    }],
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
});

test("state transitions require a reviewer note before touching D1", async () => {
  const { db, batches } = capturedDatabase();
  const service = createAdminService(db);
  await assert.rejects(
    () => service.transitionState("branch:1", { entityType: "branch", verificationStatus: "verified", note: "" }),
    /검토 메모/,
  );
  assert.equal(batches.length, 0);
});

test("rejects nonexistent and cross-branch state transition targets before batching", async () => {
  const { db, batches } = capturedDatabase(() => null);
  const service = createAdminService(db);
  await assert.rejects(
    () => service.transitionState("branch:missing", { entityType: "branch", verificationStatus: "verified", note: "승인" }),
    /찾지 못했습니다/,
  );
  await assert.rejects(
    () => service.transitionState("branch:a", { entityType: "menu", entityId: "menu:branch-b", verificationStatus: "verified", note: "승인" }),
    /소속|찾지 못했습니다/,
  );
  assert.equal(batches.length, 0);
});

test("audits exact canonical before and after state snapshots", async () => {
  const { db, batches } = capturedDatabase((statement) => (
    /FROM branches/.test(statement.sql)
      ? { verification_status: "candidate", public_status: "hidden", last_verified_at: null, updated_at: "2026-07-17T00:00:00.000Z" }
      : null
  ));
  const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");
  await service.transitionState("branch:1", {
    entityType: "branch",
    verificationStatus: "verified",
    publicStatus: "active",
    note: "승인",
  });

  const audit = batches[0].at(-1)!;
  assert.deepEqual(JSON.parse(String(audit.bindings[4])), {
    verificationStatus: "candidate",
    publicStatus: "hidden",
    lastVerifiedAt: null,
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(String(audit.bindings[5])), {
    verificationStatus: "verified",
    publicStatus: "active",
    lastVerifiedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  });
});

test("rejects evidence outside the normalized branch and menu entity types", async () => {
  const { db, batches } = capturedDatabase();
  const service = createAdminService(db);
  await assert.rejects(() => service.appendEvidence("branch:1", {
    entityType: "shop" as "branch",
    entityId: "shop:1",
    fieldName: "general",
    sourceName: "공식 사이트",
    sourceUrl: "https://example.com",
    checkedAt: "2026-07-18",
    note: "",
  }, "출처 확인"), /근거 대상/);
  assert.equal(batches.length, 0);
});

test("rejects unsafe evidence URL schemes before batching", async () => {
  const { db, batches } = capturedDatabase(() => ({ id: "branch:1" }));
  const service = createAdminService(db);
  await assert.rejects(() => service.appendEvidence("branch:1", {
    entityType: "branch",
    entityId: "branch:1",
    fieldName: "general",
    sourceName: "공식 사이트",
    sourceUrl: "javascript:alert(1)",
    checkedAt: "2026-07-18",
    note: "",
  }, "출처 확인"), /URL/);
  assert.equal(batches.length, 0);
});

const menuUpdate = {
  name: "시오 라멘",
  price: 12_000,
  availabilityStatus: "available" as const,
  verificationStatus: "verified" as const,
  ramenTypes: ["shio"],
  brothStyle: "chintan",
  bodyLevel: 2,
  spicinessLevel: 0,
  brothBases: ["닭"],
  tags: ["깔끔"],
};

test("rejects updating a menu that does not belong to the route branch before batching", async () => {
  const { db, batches } = capturedDatabase(() => null);
  const service = createAdminService(db);
  await assert.rejects(
    () => service.updateMenu("branch:a", "menu:branch-b", menuUpdate, "메뉴 재확인"),
    /소속/,
  );
  assert.equal(batches.length, 0);
});

test("audits exact canonical before and after menu snapshots", async () => {
  const previous = {
    name: "기존 시오",
    price: 10_000,
    availability_status: "seasonal",
    verification_status: "candidate",
    last_verified_at: null,
    updated_at: "2026-07-17T00:00:00.000Z",
    ramen_types: '["shio"]',
    broth_style: "chintan",
    body_level: 2,
    spiciness_level: 0,
    broth_bases: '["닭"]',
    tags: '["기존"]',
  };
  const { db, batches } = capturedDatabase((statement) => (
    /FROM menu_items/.test(statement.sql) ? previous : null
  ));
  const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");

  await service.updateMenu("branch:1", "menu:1", { ...menuUpdate, name: "  새 시오  " }, "메뉴 재확인");

  const [menuMutation, , audit] = batches[0];
  assert.match(menuMutation.sql, /WHERE id = \? AND branch_id = \? AND updated_at = \?/);
  assert.deepEqual(JSON.parse(String(audit.bindings[4])), {
    name: "기존 시오",
    price: 10_000,
    availabilityStatus: "seasonal",
    verificationStatus: "candidate",
    lastVerifiedAt: null,
    updatedAt: "2026-07-17T00:00:00.000Z",
    profile: {
      ramenTypes: ["shio"],
      brothStyle: "chintan",
      bodyLevel: 2,
      spicinessLevel: 0,
      brothBases: ["닭"],
      tags: ["기존"],
    },
  });
  assert.deepEqual(JSON.parse(String(audit.bindings[5])), {
    name: "새 시오",
    price: 12_000,
    availabilityStatus: "available",
    verificationStatus: "verified",
    lastVerifiedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    profile: {
      ramenTypes: ["shio"],
      brothStyle: "chintan",
      bodyLevel: 2,
      spicinessLevel: 0,
      brothBases: ["닭"],
      tags: ["깔끔"],
    },
  });
});

test("stale revisions reject branch, menu, and state writes without misleading audits", async (context) => {
  await context.test("branch facts", async () => {
    const { database, db } = concurrentDatabase((sqlite) => {
      sqlite.prepare("UPDATE branches SET address = ?, updated_at = ? WHERE id = ?")
        .run("동시 변경 주소", "2026-07-17T12:00:00.000Z", "branch:1");
    });
    const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");
    await assert.rejects(() => service.updateBranch("branch:1", {
      branchName: "본점",
      region: "서울",
      district: "마포구",
      address: "내 변경 주소",
      lat: 37.5,
      lng: 126.9,
      phone: null,
      hoursText: null,
      weeklyHours: [],
    }, "지점 재확인"), /충돌|다시/);
    assert.equal(database.prepare("SELECT address FROM branches WHERE id = ?").get("branch:1")?.address, "동시 변경 주소");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM opening_hours").get()?.count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM verification_events").get()?.count, 0);
  });

  await context.test("menu facts", async () => {
    const { database, db } = concurrentDatabase((sqlite) => {
      sqlite.prepare("UPDATE menu_items SET name = ?, updated_at = ? WHERE id = ?")
        .run("동시 변경 메뉴", "2026-07-17T12:00:00.000Z", "menu:1");
    });
    const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");
    await assert.rejects(
      () => service.updateMenu("branch:1", "menu:1", menuUpdate, "메뉴 재확인"),
      /충돌|다시/,
    );
    assert.equal(database.prepare("SELECT name FROM menu_items WHERE id = ?").get("menu:1")?.name, "동시 변경 메뉴");
    assert.equal(database.prepare("SELECT tags FROM menu_profiles WHERE menu_item_id = ?").get("menu:1")?.tags, '["기존"]');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM verification_events").get()?.count, 0);
  });

  await context.test("state transition", async () => {
    const { database, db } = concurrentDatabase((sqlite) => {
      sqlite.prepare("UPDATE branches SET verification_status = ?, updated_at = ? WHERE id = ?")
        .run("rejected", "2026-07-17T12:00:00.000Z", "branch:1");
    });
    const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => "fixed-id");
    await assert.rejects(() => service.transitionState("branch:1", {
      entityType: "branch",
      verificationStatus: "verified",
      publicStatus: "active",
      note: "승인",
    }), /충돌|다시/);
    assert.equal(database.prepare("SELECT verification_status FROM branches WHERE id = ?").get("branch:1")?.verification_status, "rejected");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM verification_events").get()?.count, 0);
  });
});

test("rejects menu evidence that does not belong to the route branch before batching", async () => {
  const { db, batches } = capturedDatabase(() => null);
  const service = createAdminService(db);
  await assert.rejects(() => service.appendEvidence("branch:a", {
    entityType: "menu",
    entityId: "menu:branch-b",
    fieldName: "price",
    sourceName: "공식 사이트",
    sourceUrl: "https://example.com",
    checkedAt: "2026-07-18",
    note: "가격 확인",
  }, "출처 확인"), /소속/);
  assert.equal(batches.length, 0);
});

const candidate = {
  shopId: "shop:new-ramen",
  branchId: "branch:new-ramen",
  slug: "new-ramen",
  shopName: "  새 라멘  ",
  branchName: null,
  region: " 서울 ",
  district: " 마포구 ",
  address: " 서울 마포구 테스트로 2 ",
  lat: 37.55,
  lng: 126.91,
  phone: null,
  sourceName: " 공식 사이트 ",
  sourceUrl: "https://example.com/new-ramen",
  checkedAt: "2026-07-18",
  evidenceNote: " 주소 확인 ",
};

test("rejects duplicate candidate identifiers before batching", async () => {
  const { db, batches } = capturedDatabase(() => ({ shop_id_exists: 1, branch_id_exists: 0, slug_exists: 0 }));
  const service = createAdminService(db);
  await assert.rejects(() => service.createCandidate(candidate, "신규 후보 수집"), /이미 사용 중/);
  assert.equal(batches.length, 0);
});

test("creates a normalized hidden candidate with evidence and audit atomically", async () => {
  const ids = ["evidence-id", "event-id"];
  const { db, batches } = capturedDatabase(() => ({ shop_id_exists: 0, branch_id_exists: 0, slug_exists: 0 }));
  const service = createAdminService(db, () => "2026-07-18T00:00:00.000Z", () => ids.shift() ?? "unexpected");

  assert.equal(await service.createCandidate(candidate, " 신규 후보 수집 "), "branch:new-ramen");
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
  const [shop, branch, evidence, audit] = batches[0];
  assert.match(shop.sql, /INSERT INTO shops/);
  assert.deepEqual(shop.bindings.slice(0, 3), ["shop:new-ramen", "새 라멘", "새라멘"]);
  assert.match(branch.sql, /INSERT INTO branches/);
  assert.ok(branch.bindings.includes("hidden"));
  assert.ok(branch.bindings.includes("candidate"));
  assert.match(evidence.sql, /INSERT INTO source_evidence/);
  assert.ok(evidence.bindings.includes("branch:new-ramen"));
  assert.match(audit.sql, /INSERT INTO verification_events/);
  assert.equal(audit.bindings[3], "create_candidate");
  assert.equal(audit.bindings[4], null);
  const next = JSON.parse(String(audit.bindings[5]));
  assert.equal(next.shop.name, "새 라멘");
  assert.equal(next.shop.normalizedName, "새라멘");
  assert.equal(next.branch.publicStatus, "hidden");
  assert.equal(next.branch.verificationStatus, "candidate");
  assert.equal(next.evidence.sourceName, "공식 사이트");
  assert.equal(next.evidence.note, "주소 확인");
});
