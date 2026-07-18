import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE_NAME,
  loadAdminEnvironment,
  verifySessionToken,
} from "../../../features/admin/auth";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const environment = await loadAdminEnvironment();
  if (environment) {
    const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
    if (token && await verifySessionToken(token, environment.ADMIN_SESSION_SECRET)) redirect("/admin");
  }

  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-panel admin-login-panel">
        <p className="admin-eyebrow">PRIVATE OPERATOR ACCESS</p>
        <h1>RAMEN MAP 운영자</h1>
        <p>정규화된 지점·메뉴 검증 데이터를 관리하는 비공개 화면입니다.</p>
        {!environment && <p className="admin-error">서버의 관리자 인증 설정이 필요합니다.</p>}
        <form action="/api/admin/session" method="post" className="admin-form">
          <label>
            운영자 비밀번호
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit" className="primary-button">로그인</button>
        </form>
      </section>
    </main>
  );
}
