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
  assert.match(html, /전국 한 그릇 지도/);
  assert.match(html, /가게, 메뉴, 취향을 검색해보세요/);
  assert.match(html, /취향으로 추천받기/);
  assert.match(html, /DEMO DATA/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps map integration, filters, and demo data explicit", async () => {
  const [page, data, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ramen-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /dapi\.kakao\.com\/v2\/maps\/sdk\.js/);
  assert.match(page, /libraries=services,clusterer&autoload=false/);
  assert.match(page, /NEXT_PUBLIC_KAKAO_MAP_KEY/);
  assert.match(page, /RAMEN_TYPE_LABELS/);
  assert.match(page, /recommendShops/);
  assert.match(page, /navigator\.geolocation/);
  assert.match(page, /내 위치 기반 주변 추천 사용/);
  assert.match(page, /직선거리/);
  assert.match(data, /export const RAMEN_SHOPS/);
  assert.equal((data.match(/id: "demo-/g) ?? []).length, 24);
  assert.match(data, /실제 매장 아님/);
  assert.match(data, /카라이 돈코츠라멘/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
