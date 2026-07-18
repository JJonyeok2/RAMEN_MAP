import {
  ADMIN_SESSION_MAX_AGE,
  createSessionCookie,
  createSessionToken,
  loadAdminEnvironment,
  verifyPassword,
  type AdminEnvironment,
} from "../../../../features/admin/auth.ts";

export const dynamic = "force-dynamic";

type LoadEnvironment = () => Promise<AdminEnvironment | null>;

function response(body: unknown, status: number, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function passwordFrom(request: Request) {
  if (request.headers.get("content-type")?.includes("application/json")) {
    const value = await request.json() as { password?: unknown };
    return typeof value.password === "string" ? value.password : "";
  }
  const value = await request.formData();
  const password = value.get("password");
  return typeof password === "string" ? password : "";
}

export function createSessionHandler(
  loadEnvironment: LoadEnvironment = loadAdminEnvironment,
  epochSeconds: () => number = () => Math.floor(Date.now() / 1000),
) {
  return async function POST(request: Request) {
    const environment = await loadEnvironment();
    if (!environment) return response({ error: "관리자 인증 설정이 필요합니다." }, 503);

    let password: string;
    try {
      password = await passwordFrom(request);
    } catch {
      return response({ error: "요청 형식을 확인해 주세요." }, 400);
    }
    if (!await verifyPassword(password, environment.ADMIN_PASSWORD_HASH)) {
      return response({ error: "비밀번호를 확인해 주세요." }, 401);
    }

    const token = await createSessionToken(
      environment.ADMIN_SESSION_SECRET,
      epochSeconds() + ADMIN_SESSION_MAX_AGE,
    );
    const cookie = createSessionCookie(token);
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/admin", "Set-Cookie": cookie, "Cache-Control": "no-store" },
      });
    }
    return response({ ok: true }, 200, { "Set-Cookie": cookie });
  };
}

export const POST = createSessionHandler();
