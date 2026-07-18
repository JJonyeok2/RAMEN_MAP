import { ModeCard } from "../components/mode-card";

export default function Home() {
  return (
    <main className="home-page">
      <header className="site-header">
        <a className="brand" href="#main" aria-label="RAMEN MAP 홈">
          <span className="brand-bowl" aria-hidden="true">ら</span>
          <span>
            <strong>RAMEN MAP</strong>
            <small>오늘의 한 그릇 찾기</small>
          </span>
        </a>
        <span className="header-note">로그인 없이 바로 시작</span>
      </header>

      <section className="home-hero" id="main" aria-labelledby="home-title">
        <p className="home-eyebrow">CHOOSE YOUR RAMEN MOMENT</p>
        <h1 id="home-title">오늘은 어떻게 찾을까요?</h1>
        <p className="home-intro">
          가까운 세 곳을 빠르게 고르거나, 지역과 취향을 따라 천천히 탐방해 보세요.
        </p>

        <div className="mode-grid">
          <ModeCard
            href="/nearby"
            eyebrow="QUICK PICK"
            title="배고파요 · 빨리 찾기"
            description="현재 위치에서 지금 갈 만한 라멘집 3곳을 골라드려요."
          />
          <ModeCard
            href="/explore"
            eyebrow="RAMEN TOUR"
            title="라멘 탐방"
            description="지역과 취향으로 새로운 한 그릇을 천천히 찾아보세요."
          />
        </div>
      </section>
    </main>
  );
}
