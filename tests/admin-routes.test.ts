import assert from "node:assert/strict";
import test from "node:test";
import { createBranchMutationHandler } from "../app/api/admin/branches/[id]/route.ts";
import { createBranchesHandler } from "../app/api/admin/branches/route.ts";
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
