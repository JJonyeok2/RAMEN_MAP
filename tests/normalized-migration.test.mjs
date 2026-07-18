import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("normalizes all eight seed candidates without losing their signature menu or source", async () => {
  const sql = await readFile(new URL("../drizzle/0001_normalize_ramen_domain.sql", import.meta.url), "utf8");
  for (const table of ["shops", "branches", "menu_items", "menu_profiles", "opening_hours", "opening_exceptions", "source_evidence", "verification_events", "areas", "product_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /INSERT OR IGNORE INTO shops[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO branches[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO menu_items[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO source_evidence[\s\S]+FROM shop_candidates/);
  assert.match(sql, /INSERT OR IGNORE INTO verification_events[\s\S]+FROM shop_candidates/);
  assert.equal((sql.match(/INSERT OR IGNORE INTO areas/g) ?? []).length, 1);
});

test("executes the normalized migration without data loss or extra product-event fields", async () => {
  const [seedSql, normalizedSql] = await Promise.all([
    readFile(new URL("../drizzle/0000_real_shop_verification.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_normalize_ramen_domain.sql", import.meta.url), "utf8"),
  ]);
  const database = new DatabaseSync(":memory:");

  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(seedSql);
    database.exec(`
      UPDATE shop_candidates SET
        status = 'verified', reviewer_note = '주소와 메뉴 승인', verified_by = 'reviewer-a',
        verified_at = '2026-07-01T00:00:00.000Z'
      WHERE id = 'menkyudan';
      UPDATE shop_candidates SET
        status = 'hold', reviewer_note = '주소 충돌 보류', verified_by = 'reviewer-b',
        verified_at = '2026-07-02T00:00:00.000Z'
      WHERE id = 'shinmen';
    `);
    database.exec(normalizedSql);
    database.exec(normalizedSql);

    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    const requiredTables = [
      "shops",
      "branches",
      "menu_items",
      "menu_profiles",
      "opening_hours",
      "opening_exceptions",
      "source_evidence",
      "verification_events",
      "areas",
      "product_events",
    ];
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const table of requiredTables) assert.ok(tables.includes(table));

    const counts = Object.fromEntries([
      "shop_candidates",
      ...requiredTables,
    ].map((table) => [table, database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
    assert.deepEqual(counts, {
      shop_candidates: 8,
      shops: 8,
      branches: 8,
      menu_items: 8,
      menu_profiles: 8,
      opening_hours: 0,
      opening_exceptions: 0,
      source_evidence: 14,
      verification_events: 8,
      areas: 8,
      product_events: 0,
    });

    const shopNames = database.prepare("SELECT name FROM shops").all().map((row) => row.name).sort();
    assert.deepEqual(shopNames, ["멘큐단", "신멘", "라멘 구락부", "멘지 망원점", "지로우 라멘", "오레노라멘 본점", "담택", "멘야준"].sort());

    assert.deepEqual(database.prepare(`
      SELECT id, entity_id, action, previous_value, next_value, note, actor, created_at
      FROM verification_events WHERE entity_id IN ('branch:menkyudan', 'branch:shinmen') ORDER BY entity_id
    `).all().map((row) => ({ ...row, next_value: JSON.parse(row.next_value) })), [
      {
        id: "event:migration:menkyudan:legacy-verification",
        entity_id: "branch:menkyudan",
        action: "migrate_legacy_verification",
        previous_value: null,
        next_value: { legacyStatus: "verified", normalizedVerificationStatus: "verified" },
        note: "주소와 메뉴 승인",
        actor: "reviewer-a",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "event:migration:shinmen:legacy-verification",
        entity_id: "branch:shinmen",
        action: "migrate_legacy_verification",
        previous_value: null,
        next_value: { legacyStatus: "hold", normalizedVerificationStatus: "candidate" },
        note: "주소 충돌 보류",
        actor: "reviewer-b",
        created_at: "2026-07-02T00:00:00.000Z",
      },
    ]);
    assert.deepEqual(database.prepare(`
      SELECT id, verification_status FROM branches WHERE id IN ('branch:menkyudan', 'branch:shinmen') ORDER BY id
    `).all().map((row) => ({ ...row })), [
      { id: "branch:menkyudan", verification_status: "verified" },
      { id: "branch:shinmen", verification_status: "candidate" },
    ]);

    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
    for (const index of [
      "branches_public_verification_idx",
      "branches_coordinates_idx",
      "menu_items_branch_idx",
      "evidence_entity_idx",
      "product_events_type_created_idx",
    ]) assert.ok(indexes.includes(index));

    const productEventColumns = database.prepare("PRAGMA table_info(product_events)").all().map((row) => row.name);
    assert.deepEqual(productEventColumns, [
      "id",
      "session_hash",
      "event_type",
      "elapsed_ms",
      "area_id",
      "radius_km",
      "verification_status",
      "created_at",
    ]);
    for (const [id, eventType, elapsedMs, radiusKm, verificationStatus] of [
      ["invalid-event", "custom", null, null, null],
      ["invalid-elapsed", "quick_started", -1, null, null],
      ["invalid-radius", "quick_started", null, 5, null],
      ["invalid-status", "quick_started", null, null, "rejected"],
    ]) {
      assert.throws(() => database.prepare(
        "INSERT INTO product_events (id, session_hash, event_type, elapsed_ms, radius_km, verification_status) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, "privacy-safe-session-hash", eventType, elapsedMs, radiusKm, verificationStatus));
    }
  } finally {
    database.close();
  }
});
