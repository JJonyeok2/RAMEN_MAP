import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getD1 } from "../../db/d1";
import { createAdminService } from "../../features/admin/admin-service";
import {
  ADMIN_COOKIE_NAME,
  loadAdminEnvironment,
  verifySessionToken,
} from "../../features/admin/auth";
import { CandidateForm } from "./candidate-form";

export const dynamic = "force-dynamic";

const verificationLabels = { verified: "검증 완료", candidate: "검증 후보", stale: "재검증 필요", rejected: "제외" };
const publicLabels = { active: "공개", hidden: "숨김", closed: "폐점", moved: "이전" };

async function requireOperator() {
  const environment = await loadAdminEnvironment();
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!environment || !token || !await verifySessionToken(token, environment.ADMIN_SESSION_SECRET)) {
    redirect("/admin/login");
  }
}

export default async function AdminDashboardPage() {
  await requireOperator();
  const service = createAdminService(await getD1());
  const [counts, branches] = await Promise.all([service.getDashboardCounts(), service.listBranches()]);

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="admin-eyebrow">NORMALIZED DATA CONTROL</p><h1>검증 운영 대시보드</h1></div>
        <span>RAMEN MAP 운영자 전용</span>
      </header>

      <section className="admin-stat-group" aria-label="검증 상태 집계">
        {Object.entries(counts.verification).map(([status, count]) => (
          <article className="admin-stat" key={status}><span>{verificationLabels[status as keyof typeof verificationLabels]}</span><strong>{count}</strong></article>
        ))}
      </section>
      <section className="admin-stat-group compact" aria-label="공개 상태 집계">
        {Object.entries(counts.public).map(([status, count]) => (
          <article className="admin-stat" key={status}><span>{publicLabels[status as keyof typeof publicLabels]}</span><strong>{count}</strong></article>
        ))}
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading">
          <div><h2>신규 후보 수집</h2><p>정규화된 매장·지점과 첫 출처를 한 번에 등록합니다. 새 후보는 검토 전까지 숨김 상태입니다.</p></div>
        </div>
        <CandidateForm />
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>지점 목록</h2><p>후보와 재검증 대상을 먼저 표시합니다.</p></div><span>{branches.length}개 지점</span></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>매장</th><th>지역</th><th>검증</th><th>공개</th><th>메뉴</th><th>근거</th><th /></tr></thead>
            <tbody>{branches.map((branch) => (
              <tr key={branch.id}>
                <td><strong>{branch.shop_name}</strong>{branch.branch_name ? <small>{branch.branch_name}</small> : null}</td>
                <td>{branch.district}</td>
                <td><span className={`admin-status status-${branch.verification_status}`}>{verificationLabels[branch.verification_status]}</span></td>
                <td>{publicLabels[branch.public_status]}</td>
                <td>{branch.menu_count}</td><td>{branch.evidence_count}</td>
                <td><Link href={`/admin/branches/${encodeURIComponent(branch.id)}`}>편집</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
