import type { PublicVerificationStatus } from "../domain/ramen";

const verificationLabels: Record<PublicVerificationStatus, string> = {
  verified: "검증 완료",
  candidate: "검증 대기",
  stale: "재확인 필요",
};

export function VerificationBadge({ status }: { status: PublicVerificationStatus }) {
  return (
    <span className={`verification-badge status-${status}`}>
      {verificationLabels[status]}
    </span>
  );
}
