import { getD1, type D1DatabaseLike } from "../../../../db/d1.ts";
import type { PublicStatus, VerificationStatus } from "../../../../domain/ramen.ts";
import { createAdminService } from "../../../../features/admin/admin-service.ts";
import { requireAdminSession, type AdminAuthorization } from "../../../../features/admin/auth.ts";

export const dynamic = "force-dynamic";

type Authorize = (request: Request) => Promise<AdminAuthorization>;
type LoadDatabase = () => Promise<D1DatabaseLike>;

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export function createBranchesHandler(authorize: Authorize = requireAdminSession, loadDatabase: LoadDatabase = getD1) {
  return async function GET(request: Request) {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      return json({ error: authorization.status === 503 ? "관리자 인증 설정이 필요합니다." : "관리자 인증이 필요합니다." }, authorization.status);
    }
    try {
      const url = new URL(request.url);
      const verificationStatus = url.searchParams.get("verificationStatus") || undefined;
      const publicStatus = url.searchParams.get("publicStatus") || undefined;
      const service = createAdminService(await loadDatabase());
      const branches = await service.listBranches({
        verificationStatus: verificationStatus as VerificationStatus | undefined,
        publicStatus: publicStatus as PublicStatus | undefined,
      });
      return json({ branches });
    } catch (error) {
      console.error("Failed to list admin branches", error);
      return json({ error: error instanceof Error ? error.message : "관리자 목록을 불러오지 못했습니다." }, 400);
    }
  };
}

export const GET = createBranchesHandler();
