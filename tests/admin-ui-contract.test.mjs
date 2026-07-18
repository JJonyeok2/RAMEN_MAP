import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("protected dashboard exposes the audited candidate creation workflow", async () => {
  const [dashboard, form] = await Promise.all([
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/candidate-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /CandidateForm/);
  assert.match(dashboard, /신규 후보/);
  assert.match(form, /fetch\("\/api\/admin\/branches"/);
  assert.match(form, /method: "POST"/);
  for (const field of ["shopId", "branchId", "slug", "shopName", "region", "district", "address", "lat", "lng", "sourceName", "sourceUrl", "checkedAt", "note"]) {
    assert.match(form, new RegExp(`name=["']${field}["']`), field);
  }
  assert.match(form, /window\.location\.assign/);
});
