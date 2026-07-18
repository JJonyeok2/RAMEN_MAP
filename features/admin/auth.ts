const encoder = new TextEncoder();

export const ADMIN_COOKIE_NAME = "ramen_admin";
export const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60;

export type AdminEnvironment = {
  ADMIN_PASSWORD_HASH: string;
  ADMIN_SESSION_SECRET: string;
};

export type AdminAuthorization =
  | { ok: true; environment: AdminEnvironment }
  | { ok: false; status: 401 | 503 };

function requireSecret(secret: string) {
  if (!secret) throw new Error("관리자 세션 비밀키 설정이 필요합니다.");
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(secret: string, exp: number) {
  requireSecret(secret);
  const payload = encodeBase64Url(JSON.stringify({ role: "admin", exp }));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!secret) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  try {
    const decoded = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const session = JSON.parse(decoded) as { role?: unknown; exp?: unknown };
    if (session.role !== "admin" || typeof session.exp !== "number" || session.exp <= now) return false;

    const encoded = signature.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return crypto.subtle.verify("HMAC", await signingKey(secret), bytes, encoder.encode(payload));
  } catch {
    return false;
  }
}

function decodeHex(value: string) {
  if (!/^[\da-f]{64}$/iu.test(value)) return null;
  return Uint8Array.from(value.match(/[\da-f]{2}/giu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyPassword(password: string, expectedHash: string) {
  const expected = decodeHex(expectedHash);
  if (!expected) return false;
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(password)));
  return constantTimeEqual(actual, expected);
}

export function createSessionCookie(token: string) {
  return `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE}`;
}

export function readCookie(cookieHeader: string | null, name: string) {
  for (const item of (cookieHeader ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}

export async function loadAdminEnvironment(): Promise<AdminEnvironment | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const values = env as unknown as Partial<AdminEnvironment>;
    if (!values.ADMIN_PASSWORD_HASH || !values.ADMIN_SESSION_SECRET) return null;
    return {
      ADMIN_PASSWORD_HASH: values.ADMIN_PASSWORD_HASH,
      ADMIN_SESSION_SECRET: values.ADMIN_SESSION_SECRET,
    };
  } catch {
    return null;
  }
}

export async function requireAdminSession(request: Request): Promise<AdminAuthorization> {
  const environment = await loadAdminEnvironment();
  if (!environment) return { ok: false, status: 503 };
  const token = readCookie(request.headers.get("cookie"), ADMIN_COOKIE_NAME);
  if (!token || !await verifySessionToken(token, environment.ADMIN_SESSION_SECRET)) {
    return { ok: false, status: 401 };
  }
  return { ok: true, environment };
}
