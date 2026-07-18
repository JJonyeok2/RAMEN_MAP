import Link from "next/link";
import { notFound } from "next/navigation";
import { VerificationBadge } from "../../../components/verification-badge";
import { getD1 } from "../../../db/d1";
import { createD1ShopRepository } from "../../../db/repositories/d1-shop-repository";
import type { PublicMenuItem } from "../../../domain/ramen";
import { createShopService } from "../../../features/shops/shop-service";

export const dynamic = "force-dynamic";

const ramenTypeLabels = {
  shoyu: "쇼유",
  shio: "시오",
  miso: "미소",
  tonkotsu: "돈코츠",
  tsukemen: "츠케멘",
  mazesoba: "마제소바",
} as const;

const brothStyleLabels = {
  chintan: "청탕",
  paitan: "백탕",
  dry: "국물 없음",
  dipping: "찍어 먹는 국물",
} as const;

const availabilityLabels: Record<PublicMenuItem["availabilityStatus"], string> = {
  available: "판매 확인",
  seasonal: "시즌 메뉴",
  sold_out: "품절",
  unknown: "판매 여부 미확인",
};

const openingLabels = {
  open: "영업 중",
  closed: "영업 종료",
  unknown: "영업 여부 미확인",
} as const;

function formatDate(value: string | null, unknownCopy = "확인일 미등록") {
  if (!value) return unknownCopy;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return unknownCopy;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function formatPrice(value: number | null) {
  return value === null ? "가격 미확인" : `${value.toLocaleString("ko-KR")}원`;
}

export default async function ShopDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = createShopService(createD1ShopRepository(await getD1()));
  const shop = await service.getDetail(slug);
  if (!shop) notFound();

  const shopName = `${shop.shopName}${shop.branchName ? ` ${shop.branchName}` : ""}`;
  const mapUrl = `https://map.naver.com/p/search/${encodeURIComponent(shop.address)}`;

  return (
    <main className="shop-detail-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAMEN MAP 홈">
          <span className="brand-bowl" aria-hidden="true">ら</span>
          <span><strong>RAMEN MAP</strong><small>매장 상세</small></span>
        </Link>
        <Link className="header-back" href="/explore">탐방으로 돌아가기</Link>
      </header>

      <section className="shop-detail-hero">
        <VerificationBadge status={shop.verificationStatus} />
        <h1>{shopName}</h1>
        <p>{shop.region} · {shop.district}</p>
        <dl className="shop-facts">
          <div><dt>주소</dt><dd>{shop.address}</dd></div>
          <div><dt>전화</dt><dd>{shop.phone ?? "전화번호 미확인"}</dd></div>
          <div><dt>영업 상태</dt><dd>{openingLabels[shop.openingStatus]}</dd></div>
          <div><dt>영업시간</dt><dd>{shop.hoursText ?? "영업시간 미확인"}</dd></div>
          <div><dt>매장 최근 검증</dt><dd>{formatDate(shop.lastVerifiedAt, "최근 검증일 미등록")}</dd></div>
        </dl>
        <a className="external-map-link" href={mapUrl} target="_blank" rel="noreferrer">
          주소로 외부 지도에서 찾기 ↗
        </a>
      </section>

      <section className="shop-detail-section" aria-labelledby="all-menus-title">
        <div className="section-heading">
          <div><p>ALL PUBLIC MENUS</p><h2 id="all-menus-title">등록된 전체 메뉴</h2></div>
          <span>{shop.menus.length}개</span>
        </div>
        {shop.menus.length ? (
          <div className="menu-detail-grid">
            {shop.menus.map((menu) => (
              <article className="menu-detail-card" key={menu.id}>
                <div className="menu-detail-heading">
                  <div><VerificationBadge status={menu.verificationStatus} /><h3>{menu.name}</h3></div>
                  <strong>{formatPrice(menu.price)}</strong>
                </div>
                <dl>
                  <div><dt>라멘 종류</dt><dd>{menu.ramenTypes.length ? menu.ramenTypes.map((type) => ramenTypeLabels[type]).join(" · ") : "라멘 종류 미확인"}</dd></div>
                  <div><dt>국물 스타일</dt><dd>{menu.brothStyle ? brothStyleLabels[menu.brothStyle] : "국물 스타일 미확인"}</dd></div>
                  <div><dt>육수 베이스</dt><dd>{menu.brothBases.length ? menu.brothBases.join(" · ") : "육수 베이스 미확인"}</dd></div>
                  <div><dt>진한 정도</dt><dd>{menu.bodyLevel === null ? "진한 정도 미확인" : `${menu.bodyLevel}/5`}</dd></div>
                  <div><dt>매운 정도</dt><dd>{menu.spicinessLevel === null ? "매운 정도 미확인" : `${menu.spicinessLevel}/5`}</dd></div>
                  <div><dt>판매 상태</dt><dd>{availabilityLabels[menu.availabilityStatus]}</dd></div>
                  <div><dt>맛 태그</dt><dd>{menu.tags.length ? menu.tags.join(" · ") : "맛 태그 미확인"}</dd></div>
                  <div><dt>메뉴 최근 검증</dt><dd>{formatDate(menu.lastVerifiedAt, "최근 검증일 미등록")}</dd></div>
                </dl>
                <div className="menu-evidence">
                  <h4>메뉴 출처</h4>
                  {menu.evidence.length ? (
                    <ul className="evidence-list">
                      {menu.evidence.map((evidence) => (
                        <li key={evidence.id}>
                          <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceName} ↗</a>
                          <span>확인일 {formatDate(evidence.checkedAt)}</span>
                          {evidence.note ? <p>{evidence.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p>메뉴별 공개 출처가 아직 없어요.</p>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="empty-message">공개된 메뉴 정보가 아직 없어요.</p>}
      </section>

      <section className="shop-detail-section evidence-section" aria-labelledby="evidence-title">
        <div className="section-heading">
          <div><p>SOURCE EVIDENCE</p><h2 id="evidence-title">확인한 출처</h2></div>
          <span>{shop.evidence.length}건</span>
        </div>
        {shop.evidence.length ? (
          <ul className="evidence-list">
            {shop.evidence.map((evidence) => (
              <li key={evidence.id}>
                <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceName} ↗</a>
                <span>확인일 {formatDate(evidence.checkedAt)}</span>
                {evidence.note ? <p>{evidence.note}</p> : <p>출처 메모 미등록</p>}
              </li>
            ))}
          </ul>
        ) : <p className="empty-message">공개된 출처 링크가 아직 없어요.</p>}
      </section>
    </main>
  );
}
