import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getD1 } from "../../../../db/d1";
import { createAdminService } from "../../../../features/admin/admin-service";
import {
  ADMIN_COOKIE_NAME,
  loadAdminEnvironment,
  verifySessionToken,
} from "../../../../features/admin/auth";
import { AdminBranchEditor } from "./editor";

export const dynamic = "force-dynamic";

async function requireOperator() {
  const environment = await loadAdminEnvironment();
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!environment || !token || !await verifySessionToken(token, environment.ADMIN_SESSION_SECRET)) {
    redirect("/admin/login");
  }
}

export default async function AdminBranchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperator();
  const { id } = await params;
  const branch = await createAdminService(await getD1()).loadBranch(id);
  if (!branch) notFound();

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="admin-eyebrow">BRANCH EDITOR</p><h1>{branch.shop_name}{branch.branch_name ? ` · ${branch.branch_name}` : ""}</h1></div>
        <Link href="/admin">대시보드로</Link>
      </header>
      <AdminBranchEditor branch={branch} />
    </main>
  );
}
