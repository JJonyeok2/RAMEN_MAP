import { getD1, type D1DatabaseLike } from "../../../../../db/d1.ts";
import { createAdminService } from "../../../../../features/admin/admin-service.ts";
import { requireAdminSession, type AdminAuthorization } from "../../../../../features/admin/auth.ts";
import { parseAdminBranchMutation } from "../../../../../features/admin/request.ts";
import { JsonBodyError, readBoundedJson } from "../../../v1/json-body.ts";

export const dynamic = "force-dynamic";

type Authorize = (request: Request) => Promise<AdminAuthorization>;
type LoadDatabase = () => Promise<D1DatabaseLike>;
type RouteContext = { params: Promise<{ id: string }> };
const bodyLimitBytes = 32_768;

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

function message(error: unknown) {
  return error instanceof Error ? error.message : "관리자 변경 요청을 처리하지 못했습니다.";
}

export function createBranchMutationHandler(authorize: Authorize = requireAdminSession, loadDatabase: LoadDatabase = getD1) {
  return async function PATCH(request: Request, context: RouteContext) {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      return json({ error: authorization.status === 503 ? "관리자 인증 설정이 필요합니다." : "관리자 인증이 필요합니다." }, authorization.status);
    }

    let id: string;
    let body: ReturnType<typeof parseAdminBranchMutation>;
    try {
      ({ id } = await context.params);
      body = parseAdminBranchMutation(await readBoundedJson(request, bodyLimitBytes), id);
    } catch (error) {
      if (error instanceof JsonBodyError) return json({ error: error.message }, error.status);
      return json({ error: "요청 형식을 확인해 주세요." }, 400);
    }

    try {
      const service = createAdminService(await loadDatabase());
      if (body.action === "updateBranch") {
        await service.updateBranch(id, body.branch, body.note);
      } else if (body.action === "createMenu") {
        await service.createMenu(id, body.menu, body.note);
      } else if (body.action === "updateMenu") {
        await service.updateMenu(id, body.menuId, body.menu, body.note);
      } else if (body.action === "appendEvidence") {
        await service.appendEvidence(id, body.evidence, body.note);
      } else if (body.action === "transitionState") {
        await service.transitionState(id, body.transition);
      }
      return json({ ok: true });
    } catch (error) {
      console.error("Failed to mutate admin branch", error);
      return json({ error: message(error) }, 400);
    }
  };
}

export const PATCH = createBranchMutationHandler();
export const POST = PATCH;

export function createBranchReadHandler(authorize: Authorize = requireAdminSession, loadDatabase: LoadDatabase = getD1) {
  return async function GET(request: Request, context: RouteContext) {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      return json({ error: authorization.status === 503 ? "관리자 인증 설정이 필요합니다." : "관리자 인증이 필요합니다." }, authorization.status);
    }
    try {
      const { id } = await context.params;
      const branch = await createAdminService(await loadDatabase()).loadBranch(id);
      return branch ? json({ branch }) : json({ error: "지점을 찾지 못했습니다." }, 404);
    } catch (error) {
      console.error("Failed to load admin branch", error);
      return json({ error: "관리자 지점 정보를 불러오지 못했습니다." }, 503);
    }
  };
}

export const GET = createBranchReadHandler();
