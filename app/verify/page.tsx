import { redirect } from "next/navigation";

export default function LegacyVerifyRedirect() {
  redirect("/admin");
}
