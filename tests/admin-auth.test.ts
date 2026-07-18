import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_COOKIE_NAME,
  createSessionCookie,
  createSessionToken,
  verifyPassword,
  verifySessionToken,
} from "../features/admin/auth.ts";

test("round-trips a signed unexpired admin session", async () => {
  const token = await createSessionToken("secret-at-least-32-characters-long", 1_800_000_000);
  assert.equal(await verifySessionToken(token, "secret-at-least-32-characters-long", 1_799_999_000), true);
});

test("rejects tampering, expiry, and absent secrets", async () => {
  const token = await createSessionToken("secret-at-least-32-characters-long", 1000);
  assert.equal(await verifySessionToken(`${token}x`, "secret-at-least-32-characters-long", 999), false);
  assert.equal(await verifySessionToken(token, "secret-at-least-32-characters-long", 1000), false);
  assert.equal(await verifySessionToken(token, "secret-at-least-32-characters-long", 1001), false);
  await assert.rejects(() => createSessionToken("", 1000), /설정/);
});

test("compares SHA-256 password hashes without returning secret material", async () => {
  assert.equal(
    await verifyPassword("ramen", "d8472e7f4f470b142075ada25acd85415ae9c7dfab273b21c696461e12b772d8"),
    true,
  );
  assert.equal(
    await verifyPassword("wrong", "d8472e7f4f470b142075ada25acd85415ae9c7dfab273b21c696461e12b772d8"),
    false,
  );
  assert.equal(await verifyPassword("ramen", ""), false);
});

test("creates a strict secure eight-hour admin cookie", () => {
  const cookie = createSessionCookie("signed-token");
  assert.match(cookie, new RegExp(`^${ADMIN_COOKIE_NAME}=signed-token;`));
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=28800"]) {
    assert.match(cookie, new RegExp(attribute));
  }
});
