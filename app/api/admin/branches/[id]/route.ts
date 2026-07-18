import { getD1, type D1DatabaseLike } from "../../../../../db/d1.ts";
import { createAdminService } from "../../../../../features/admin/admin-service.ts";
import { requireAdminSession, type AdminAuthorization } from "../../../../../features/admin/auth.ts";

export const dynamic = "force-dynamic";

type Authorize = (request: Request) => Promise<AdminAuthorization>;
type LoadDatabase = () => Promise<D1DatabaseLike>;
type RouteContext = { params: Promise<{ id: string }> };

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

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "요청 형식을 확인해 주세요." }, 400);
    }
    if (!input || typeof input !== "object") return json({ error: "요청 형식을 확인해 주세요." }, 400);

    try {
      const body = input as Record<string, unknown>;
      const { id } = await context.params;
      if (body.action === "appendEvidence") {
        const evidence = body.evidence as Record<string, unknown>;
        if (evidence.entityType === "branch" && evidence.entityId !== undefined && evidence.entityId !== id) {
          return json({ error: "지점 근거 대상이 요청 경로와 일치하지 않습니다." }, 400);
        }
      }
      const service = createAdminService(await loadDatabase());
      if (body.action === "updateBranch") {
        await service.updateBranch(id, body.branch as Parameters<typeof service.updateBranch>[1], String(body.note ?? ""));
      } else if (body.action === "createMenu") {
        const menu = { ...(body.menu as Record<string, unknown>) };
        delete menu.id;
        await service.createMenu(id, menu as Parameters<typeof service.createMenu>[1], String(body.note ?? ""));
      } else if (body.action === "updateMenu") {
        const menu = { ...(body.menu as Record<string, unknown>) };
        delete menu.id;
        await service.updateMenu(id, String(body.menuId ?? ""), menu as Parameters<typeof service.updateMenu>[2], String(body.note ?? ""));
      } else if (body.action === "appendEvidence") {
        const evidence = body.evidence as Record<string, unknown>;
        await service.appendEvidence(id, {
          ...evidence,
          entityId: evidence.entityType === "branch" ? id : evidence.entityId,
        } as Parameters<typeof service.appendEvidence>[1], String(body.note ?? ""));
      } else if (body.action === "transitionState") {
        const transition = body.transition as Omit<Parameters<typeof service.transitionState>[0], "entityId">;
        await service.transitionState({ ...transition, entityId: id });
      } else {
        return json({ error: "지원하지 않는 관리자 작업입니다." }, 400);
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
