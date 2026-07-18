import assert from "node:assert/strict";
import test from "node:test";
import type { D1DatabaseLike, D1Statement } from "../db/d1.ts";
import { createBranchMutationHandler } from "../app/api/admin/branches/[id]/route.ts";
import { createBranchCandidateHandler, createBranchesHandler } from "../app/api/admin/branches/route.ts";
import { createSessionHandler } from "../app/api/admin/session/route.ts";

test("rejects an unauthenticated admin write before body parsing or D1 access", async () => {
  let bodyReads = 0;
  let databaseReads = 0;
  const request = {
    async json() {
      bodyReads += 1;
      return {};
    },
  } as Request;
  const handler = createBranchMutationHandler(
    async () => ({ ok: false as const, status: 401 as const }),
    async () => {
      databaseReads += 1;
      throw new Error("D1 must not load");
    },
  );

  const response = await handler(request, { params: Promise.resolve({ id: "branch:1" }) });
  assert.equal(response.status, 401);
  assert.equal(bodyReads, 0);
  assert.equal(databaseReads, 0);
});

test("fails closed with 503 before body parsing when admin secrets are absent", async () => {
  let bodyReads = 0;
  const request = { async json() { bodyReads += 1; return {}; } } as Request;
  const handler = createBranchMutationHandler(
    async () => ({ ok: false as const, status: 503 as const }),
    async () => { throw new Error("D1 must not load"); },
  );
  const response = await handler(request, { params: Promise.resolve({ id: "branch:1" }) });
  assert.equal(response.status, 503);
  assert.equal(bodyReads, 0);
});

test("rejects malformed authenticated branch payloads before D1 access", async () => {
  let databaseReads = 0;
  const handler = createBranchMutationHandler(
    async () => ({ ok: true as const, environment: { ADMIN_PASSWORD_HASH: "hash", ADMIN_SESSION_SECRET: "secret" } }),
    async () => {
      databaseReads += 1;
      throw new Error("D1 must not load");
    },
  );

  for (const body of [
    { action: "updateBranch", note: "검토", branch: null },
    {
      action: "appendEvidence",
      note: "출처 확인",
      evidence: {
        entityType: "branch",
        fieldName: "address",
        sourceName: "공식 사이트",
        sourceUrl: "javascript:alert(1)",
        checkedAt: "2026-07-18",
        note: "",
      },
    },
  ]) {
    const response = await handler(new Request("http://local/api/admin/branches/branch:a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "branch:a" }) });
    assert.equal(response.status, 400);
  }
  assert.equal(databaseReads, 0);
});

test("login fails closed before parsing when its server environment is incomplete", async () => {
  let bodyReads = 0;
  const request = { async json() { bodyReads += 1; return { password: "secret" }; } } as Request;
  const handler = createSessionHandler(async () => null);
  const response = await handler(request);
  assert.equal(response.status, 503);
  assert.equal(bodyReads, 0);
  assert.doesNotMatch(JSON.stringify(await response.json()), /secret|hash/i);
});

test("successful login sets only the signed strict admin cookie", async () => {
  const handler = createSessionHandler(async () => ({
    ADMIN_PASSWORD_HASH: "d8472e7f4f470b142075ada25acd85415ae9c7dfab273b21c696461e12b772d8",
    ADMIN_SESSION_SECRET: "secret-at-least-32-characters-long",
  }), () => 1_800_000_000);
  const response = await handler(new Request("http://local/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "ramen" }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /^ramen_admin=.+HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800$/);
  const body = JSON.stringify(await response.json());
  assert.equal(body, '{"ok":true}');
  assert.doesNotMatch(body, /ramen|d847|secret/i);
});

test("admin branch reads are protected as well as writes", async () => {
  let databaseReads = 0;
  const handler = createBranchesHandler(
    async () => ({ ok: false as const, status: 401 as const }),
    async () => {
      databaseReads += 1;
      throw new Error("D1 must not load");
    },
  );
  const response = await handler(new Request("http://local/api/admin/branches"));
  assert.equal(response.status, 401);
  assert.equal(databaseReads, 0);
});

test("rejects unauthenticated candidate creation before body parsing or D1 access", async () => {
  let bodyReads = 0;
  let databaseReads = 0;
  const request = { async json() { bodyReads += 1; return {}; } } as Request;
  const handler = createBranchCandidateHandler(
    async () => ({ ok: false as const, status: 401 as const }),
    async () => {
      databaseReads += 1;
      throw new Error("D1 must not load");
    },
  );
  const response = await handler(request);
  assert.equal(response.status, 401);
  assert.equal(bodyReads, 0);
  assert.equal(databaseReads, 0);
});

test("creates an authenticated candidate through the collection endpoint", async () => {
  type Statement = D1Statement & { sql: string; bindings: unknown[] };
  const batches: Statement[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      const statement: Statement = {
        sql,
        bindings: [],
        bind(...values) { statement.bindings = values; return statement; },
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return { shop_id_exists: 0, branch_id_exists: 0, slug_exists: 0 } as T; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) { batches.push(statements as Statement[]); return []; },
  };
  const handler = createBranchCandidateHandler(
    async () => ({ ok: true as const, environment: { ADMIN_PASSWORD_HASH: "hash", ADMIN_SESSION_SECRET: "secret" } }),
    async () => database,
  );
  const response = await handler(new Request("http://local/api/admin/branches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      note: "신규 후보 수집",
      candidate: {
        shopId: "shop:new-ramen",
        branchId: "branch:new-ramen",
        slug: "new-ramen",
        shopName: "새 라멘",
        branchName: null,
        region: "서울",
        district: "마포구",
        address: "서울 마포구 테스트로 2",
        lat: 37.55,
        lng: 126.91,
        phone: null,
        sourceName: "공식 사이트",
        sourceUrl: "https://example.com/new-ramen",
        checkedAt: "2026-07-18",
        evidenceNote: "주소 확인",
      },
    }),
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, branchId: "branch:new-ramen" });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 4);
});

test("rejects a spoofed branch evidence ID before service batching", async () => {
  type Statement = D1Statement & { sql: string; bindings: unknown[] };
  const batches: Statement[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      const statement: Statement = {
        sql,
        bindings: [],
        bind(...values) { statement.bindings = values; return statement; },
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return { id: "branch:a" } as T; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) { batches.push(statements as Statement[]); return []; },
  };
  const handler = createBranchMutationHandler(
    async () => ({ ok: true as const, environment: { ADMIN_PASSWORD_HASH: "hash", ADMIN_SESSION_SECRET: "secret" } }),
    async () => database,
  );
  const response = await handler(new Request("http://local/api/admin/branches/branch:a", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "appendEvidence",
      note: "지점 출처 확인",
      evidence: {
        entityType: "branch",
        entityId: "branch:b",
        fieldName: "address",
        sourceName: "공식 사이트",
        sourceUrl: "https://example.com",
        checkedAt: "2026-07-18",
        note: "주소 확인",
      },
    }),
  }), { params: Promise.resolve({ id: "branch:a" }) });

  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
});

test("branch evidence may omit its ID and persists the route branch in data and audit", async () => {
  type Statement = D1Statement & { sql: string; bindings: unknown[] };
  const batches: Statement[][] = [];
  const database: D1DatabaseLike = {
    prepare(sql) {
      const statement: Statement = {
        sql,
        bindings: [],
        bind(...values) { statement.bindings = values; return statement; },
        async all<T>() { return { results: [] as T[] }; },
        async first<T>() { return { id: "branch:a" } as T; },
        async run() { return {}; },
      };
      return statement;
    },
    async batch(statements) { batches.push(statements as Statement[]); return []; },
  };
  const handler = createBranchMutationHandler(
    async () => ({ ok: true as const, environment: { ADMIN_PASSWORD_HASH: "hash", ADMIN_SESSION_SECRET: "secret" } }),
    async () => database,
  );
  const response = await handler(new Request("http://local/api/admin/branches/branch:a", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "appendEvidence",
      note: "지점 출처 확인",
      evidence: {
        entityType: "branch",
        fieldName: "address",
        sourceName: "공식 사이트",
        sourceUrl: "https://example.com",
        checkedAt: "2026-07-18",
        note: "주소 확인",
      },
    }),
  }), { params: Promise.resolve({ id: "branch:a" }) });

  assert.equal(response.status, 200);
  assert.equal(batches.length, 1);
  const evidence = batches[0].find((statement) => /INSERT INTO source_evidence/.test(statement.sql))!;
  const audit = batches[0].find((statement) => /INSERT INTO verification_events/.test(statement.sql))!;
  assert.ok(evidence.bindings.includes("branch:a"));
  assert.ok(audit.bindings.includes("branch:a"));
});
