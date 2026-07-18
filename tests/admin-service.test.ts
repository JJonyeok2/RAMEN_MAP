import assert from "node:assert/strict";
import test from "node:test";
import type { D1DatabaseLike, D1Statement } from "../db/d1.ts";
import { createAdminService } from "../features/admin/admin-service.ts";

type CapturedStatement = D1Statement & { sql: string; bindings: unknown[] };

function capturedDatabase() {
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
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return null as T | null; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements as CapturedStatement[]);
      return [];
    },
  };
  return { db, batches };
}

test("updates branch facts and weekly hours with an audit event in one D1 batch", async () => {
  const { db, batches } = capturedDatabase();
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

test("state transitions require a reviewer note before touching D1", async () => {
  const { db, batches } = capturedDatabase();
  const service = createAdminService(db);
  await assert.rejects(
    () => service.transitionState({ entityType: "branch", entityId: "branch:1", verificationStatus: "verified", note: "" }),
    /검토 메모/,
  );
  assert.equal(batches.length, 0);
});

test("rejects evidence outside the normalized branch and menu entity types", async () => {
  const { db, batches } = capturedDatabase();
  const service = createAdminService(db);
  await assert.rejects(() => service.appendEvidence({
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
