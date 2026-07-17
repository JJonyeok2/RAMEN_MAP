import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the RAMEN MAP product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko"/i);
  assert.match(html, /RAMEN MAP/);
  assert.match(html, /배고파요/);
  assert.match(html, /빨리 찾기/);
  assert.match(html, /라멘 탐방/);
  assert.doesNotMatch(html, /전국 17개 시·도|DEMO DATA|창작 데모/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the quick flow list-first and explicit about its choices", async () => {
  const [page, nearby, modeCard, styles, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/nearby/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/mode-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /배고파요 · 빨리 찾기/);
  assert.match(page, /라멘 탐방/);
  assert.doesNotMatch(page, /dapi\.kakao\.com|ramen-data|recommendShops/);
  assert.match(nearby, /3km/);
  assert.match(nearby, /10km/);
  assert.match(nearby, /30km/);
  assert.match(nearby, /현재 위치/);
  assert.match(nearby, /직선거리/);
  assert.match(nearby, /taste/);
  assert.match(nearby, /balanced/);
  assert.match(nearby, /distance/);
  assert.doesNotMatch(nearby, /dapi\.kakao\.com|ramen-data|recommendShops/);
  assert.match(modeCard, /<h2>\{title\}<\/h2>/);
  assert.match(styles, /mode-card/);
  assert.match(styles, /recommendation-card/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
