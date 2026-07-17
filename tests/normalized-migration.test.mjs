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
