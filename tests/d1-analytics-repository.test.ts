import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import type { D1DatabaseLike, D1Statement } from "../db/d1.ts";
import { createD1AnalyticsRepository } from "../db/repositories/d1-analytics-repository.ts";

const event = {
  sessionId: "b8a3f064-9462-4a3b-a7f4-c5f9e0e00a11",
  eventType: "directions_clicked" as const,
  elapsedMs: 42_000,
  areaId: "anyang",
  radiusKm: 3 as const,
  verificationStatus: "verified" as const,
};

function statement(result: unknown, capture: { sql?: string; bindings?: unknown[]; runs?: number }): D1DatabaseLike {
  return {
    prepare(sql) {
      capture.sql = sql;
      return {
        bind(...values) { capture.bindings = values; return this; },
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return null as T | null; },
        async run() { capture.runs = (capture.runs ?? 0) + 1; return result; },
      } satisfies D1Statement;
    },
  };
}

test("persists a known canonical area through one privacy-limited insert-select", async () => {
  const capture: { sql?: string; bindings?: unknown[]; runs?: number } = {};
  const repository = createD1AnalyticsRepository(statement({ meta: { changes: 1 } }, capture));
  assert.equal(await repository.record(event), true);
  assert.equal(capture.runs, 1);
  assert.match(capture.sql ?? "", /INSERT INTO product_events/);
  assert.match(capture.sql ?? "", /JOIN areas/);
  assert.match(capture.sql ?? "", /event_values\.area_id = areas\.id/);
  assert.doesNotMatch(capture.sql ?? "", /\b(?:lat|lng|text|user_agent|ip)\b/i);
  assert.equal(capture.bindings?.filter((value) => value === event.areaId).length, 1);
  assert.equal(capture.bindings?.includes(event.sessionId), false);
  assert.match(capture.bindings?.[1] as string, /^[a-f0-9]{64}$/);
});

test("reports an unknown canonical area when D1 changes are zero", async () => {
  const capture: { sql?: string; bindings?: unknown[]; runs?: number } = {};
  const repository = createD1AnalyticsRepository(statement({ meta: { changes: 0 } }, capture));
  assert.equal(await repository.record({ ...event, areaId: "unknown" }), false);
  assert.equal(capture.runs, 1);
});

test("records an omitted area with one insert and no area binding", async () => {
  const capture: { sql?: string; bindings?: unknown[]; runs?: number } = {};
  const repository = createD1AnalyticsRepository(statement({ meta: { changes: 1 } }, capture));
  assert.equal(await repository.record({ ...event, areaId: null }), true);
  assert.equal(capture.runs, 1);
  assert.doesNotMatch(capture.sql ?? "", /JOIN areas/);
  assert.equal(capture.bindings?.includes(null), true);
});

test("inserts only a canonical ID backed by a normalized area row", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE areas (id TEXT PRIMARY KEY);
    CREATE TABLE product_events (
      id TEXT PRIMARY KEY, session_hash TEXT NOT NULL, event_type TEXT NOT NULL,
      elapsed_ms INTEGER, area_id TEXT, radius_km INTEGER, verification_status TEXT
    );
    INSERT INTO areas (id) VALUES ('anyang');
  `);
  const db: D1DatabaseLike = {
    prepare(sql) {
      let bindings: unknown[] = [];
      return {
        bind(...values) { bindings = values; return this; },
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return null as T | null; },
        async run() {
          const result = sqlite.prepare(sql).run(...bindings as SQLInputValue[]);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };

  try {
    const repository = createD1AnalyticsRepository(db);
    assert.equal(await repository.record(event), true);
    assert.equal(await repository.record({ ...event, areaId: "unknown" }), false);
    assert.deepEqual(
      sqlite.prepare("SELECT area_id FROM product_events").all().map((row) => row.area_id),
      ["anyang"],
    );
  } finally {
    sqlite.close();
  }
});
