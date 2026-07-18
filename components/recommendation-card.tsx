import Link from "next/link";
import type { RecommendationItem } from "../domain/recommendation";
import { VerificationBadge } from "./verification-badge";

const openingLabels = {
  open: "영업 중",
  closed: "영업 종료",
  unknown: "영업 여부 미확인",
} as const;

function formatPrice(price: number) {
  return `${price.toLocaleString("ko-KR")}원`;
}

function formatVerifiedDate(value: string | null) {
  if (!value) return "최근 검증일 미등록";
  return `최근 검증 ${new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))}`;
}

interface RecommendationCardProps {
  item: RecommendationItem;
  onDetail: (item: RecommendationItem) => void;
  onDirections: (item: RecommendationItem) => void;
}

export function RecommendationCard({ item, onDetail, onDirections }: RecommendationCardProps) {
  const { branch } = item;
  const menu = branch.menus.find((candidate) => candidate.id === item.menuId);
  const mapQuery = `${branch.shopName} ${branch.address}`;

  return (
    <article className="recommendation-card">
      <div className="recommendation-card-head">
        <div>
          <VerificationBadge status={branch.verificationStatus} />
          <h3>{branch.shopName}{branch.branchName ? ` ${branch.branchName}` : ""}</h3>
        </div>
        <span className={`opening-status status-${branch.openingStatus}`}>
          {openingLabels[branch.openingStatus]}
        </span>
      </div>

      <p className="matched-menu">
        <span>추천 메뉴</span>
        <strong>{menu?.name ?? "대표 메뉴 확인 필요"}</strong>
        {menu?.price != null ? <b>{formatPrice(menu.price)}</b> : <b>가격 미확인</b>}
      </p>
      <p className="straight-distance">직선거리 {item.distanceKm.toFixed(1)}km</p>
      <ul className="recommendation-reasons" aria-label="추천 이유">
        {item.reasons.slice(0, 2).map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <p className="verification-date">{formatVerifiedDate(branch.lastVerifiedAt)}</p>

      <div className="recommendation-actions">
        <Link
          href={`/shops/${branch.slug}`}
          aria-label={`${branch.shopName}${branch.branchName ? ` ${branch.branchName}` : ""} 상세 보기`}
          onClick={() => onDetail(item)}
        >
          상세 보기
        </Link>
        <a
          href={`https://map.naver.com/p/search/${encodeURIComponent(mapQuery)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${branch.shopName}${branch.branchName ? ` ${branch.branchName}` : ""} 외부 지도에서 찾기`}
          onClick={() => onDirections(item)}
        >
          외부 지도에서 찾기 ↗
        </a>
      </div>
    </article>
  );
}
