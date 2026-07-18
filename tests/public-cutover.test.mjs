import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const value = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(value) : [value];
      }),
    )
  ).flat();
}

test("keeps demo records out of production application files", async () => {
  const files = (await walk(new URL("../app", import.meta.url).pathname)).filter(
    (file) => /\.(ts|tsx)$/.test(file),
  );
  const source = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  assert.doesNotMatch(
    source,
    /RAMEN_SHOPS|demo-seoul|창작 데모|DEMO DATA|전국 한 그릇 지도/,
  );
});

test("runs the production cutover contract in the complete test suite", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(packageJson.scripts["test:ssr"], /public-cutover\.test\.mjs/);
});
