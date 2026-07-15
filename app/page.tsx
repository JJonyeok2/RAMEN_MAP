"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RAMEN_SHOPS,
  RAMEN_TYPE_LABELS,
  REGIONS,
  type RamenShop,
  type RamenType,
} from "./ramen-data";

type KakaoNamespace = {
  maps: Record<string, unknown> & {
    load: (callback: () => void) => void;
  };
};

declare global {
  interface Window {
    kakao?: KakaoNamespace;
    __ramenMapKakaoLoader?: Promise<KakaoNamespace>;
  }
}

type MapStatus = "loading" | "ready" | "missing" | "error";
type ChatMessage = {
  id: number;
  role: "bot" | "user";
  text: string;
  shopIds?: string[];
};

const KAKAO_APP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";
const ALL_REGIONS = ["전국", ...REGIONS] as const;
const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 1,
    role: "bot",
    text: "반가워요! 오늘 당기는 맛을 알려주면 전국 라멘 중 딱 맞는 세 그릇을 골라드릴게요.",
  },
];

const QUICK_REPLIES = [
  { label: "맑고 담백하게", prompt: "맑고 담백한 국물 추천해줘" },
  { label: "진하고 묵직하게", prompt: "진하고 묵직한 라멘 추천해줘" },
  { label: "찍어 먹는 면", prompt: "츠케멘 추천해줘" },
  { label: "비벼 먹는 면", prompt: "마제소바 추천해줘" },
  { label: "얼큰하고 매콤하게", prompt: "매콤한 라멘 추천해줘" },
];

const MAP_LABELS = [
  { name: "수도권", left: "35%", top: "21%" },
  { name: "강원", left: "62%", top: "25%" },
  { name: "충청", left: "43%", top: "42%" },
  { name: "경상", left: "65%", top: "59%" },
  { name: "전라", left: "34%", top: "64%" },
  { name: "제주", left: "22%", top: "88%" },
];

function loadKakaoSdk(appKey: string): Promise<KakaoNamespace> {
  if (window.kakao?.maps) {
    return new Promise((resolve) => {
      window.kakao?.maps.load(() => resolve(window.kakao as KakaoNamespace));
    });
  }

  if (window.__ramenMapKakaoLoader) return window.__ramenMapKakaoLoader;

  window.__ramenMapKakaoLoader = new Promise((resolve, reject) => {
    const scriptId = "kakao-map-sdk";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    const finish = () => {
      if (!window.kakao?.maps) {
        reject(new Error("Kakao Maps SDK is unavailable."));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao as KakaoNamespace));
    };

    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Kakao Maps SDK failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&libraries=services,clusterer&autoload=false`;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Kakao Maps SDK failed to load.")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return window.__ramenMapKakaoLoader;
}

function formatPrice(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function markerPosition(shop: RamenShop) {
  const left = ((shop.lng - 125.4) / 4.7) * 100;
  const top = ((38.8 - shop.lat) / 6.2) * 100;
  return {
    left: `${Math.min(92, Math.max(8, left))}%`,
    top: `${Math.min(92, Math.max(8, top))}%`,
  };
}

function getRecommendationReason(shop: RamenShop, prompt: string) {
  const input = normalized(prompt);
  const reasons: string[] = [];
  if (/맑|담백|깔끔|시오|소금/.test(input) && shop.body <= 3)
    reasons.push("가벼운 국물");
  if (/진|묵직|꾸덕|농후|돈코츠/.test(input) && shop.body >= 4)
    reasons.push("농도 높은 육수");
  if (/매콤|매운|얼큰/.test(input) && shop.spiciness >= 3)
    reasons.push("기분 좋은 매운맛");
  if (/츠케|찍어/.test(input) && shop.types.includes("tsukemen"))
    reasons.push("쫄깃한 츠케멘");
  if (/마제|비벼/.test(input) && shop.types.includes("mazesoba"))
    reasons.push("감칠맛 나는 비빔면");
  if (/채식|비건/.test(input) && shop.vegetarian)
    reasons.push("채식 옵션");
  if (/돼지.*(빼|제외|없이)|돈육.*(빼|제외|없이)/.test(input) && !shop.containsPork)
    reasons.push("돈육 없이 즐기는 메뉴");
  return reasons.length ? reasons.slice(0, 2).join(" · ") : shop.tags.slice(0, 2).join(" · ");
}

function recommendShops(prompt: string, activeRegion: string) {
  const input = normalized(prompt);
  const mentionedRegion = REGIONS.find(
    (item) => input.includes(normalized(item)),
  );
  const targetRegion = mentionedRegion ?? activeRegion;

  return RAMEN_SHOPS.map((shop) => {
    let score = shop.rating;
    if (targetRegion !== "전국" && shop.region === targetRegion) score += 9;
    if (/맑|담백|깔끔|시오|소금/.test(input)) {
      if (shop.body <= 3) score += 8;
      if (shop.types.some((type) => type === "shio" || type === "shoyu")) score += 8;
    }
    if (/진|묵직|꾸덕|농후|돈코츠/.test(input)) {
      if (shop.body >= 4) score += 9;
      if (shop.types.some((type) => type === "tonkotsu" || type === "miso")) score += 7;
    }
    if (/매콤|매운|얼큰/.test(input) && shop.spiciness >= 3) score += 14;
    if (/츠케|찍어/.test(input) && shop.types.includes("tsukemen")) score += 18;
    if (/마제|비벼/.test(input) && shop.types.includes("mazesoba")) score += 18;
    if (/쇼유|간장/.test(input) && shop.types.includes("shoyu")) score += 15;
    if (/미소|된장/.test(input) && shop.types.includes("miso")) score += 15;
    if (/채식|비건/.test(input)) score += shop.vegetarian ? 18 : -20;
    if (/돼지.*(빼|제외|없이)|돈육.*(빼|제외|없이)/.test(input))
      score += shop.containsPork ? -30 : 18;
    if (shop.tags.some((tag) => input.includes(normalized(tag)))) score += 8;
    return { shop, score };
  })
    .filter(({ shop }) => targetRegion === "전국" || shop.region === targetRegion)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ shop }) => shop);
}

function RamenCard({
  shop,
  selected,
  onSelect,
}: {
  shop: RamenShop;
  selected: boolean;
  onSelect: (shop: RamenShop) => void;
}) {
  return (
    <button
      className={`ramen-card${selected ? " is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(shop)}
      aria-pressed={selected}
      data-testid={`shop-${shop.id}`}
    >
      <span className="ramen-card-topline">
        <span className="demo-kicker">DEMO</span>
        <span className="rating">★ {shop.rating.toFixed(1)}</span>
      </span>
      <span className="ramen-card-title">{shop.name}</span>
      <span className="ramen-card-menu">
        {shop.signature}
        <strong>{formatPrice(shop.price)}</strong>
      </span>
      <span className="ramen-card-meta">
        {shop.region} {shop.district}
        <i aria-hidden="true" />
        {shop.tags.slice(0, 2).join(" · ")}
      </span>
      <span className="type-dots" aria-label={`종류: ${shop.types.map((type) => RAMEN_TYPE_LABELS[type]).join(", ")}`}>
        {shop.types.map((type) => (
          <span className={`type-dot type-${type}`} key={type}>
            {RAMEN_TYPE_LABELS[type]}
          </span>
        ))}
      </span>
    </button>
  );
}

export default function Home() {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("전국");
  const [selectedTypes, setSelectedTypes] = useState<RamenType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>(
    KAKAO_APP_KEY ? "loading" : "missing",
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [mobileListOpen, setMobileListOpen] = useState(true);

  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const kakaoRef = useRef<KakaoNamespace | null>(null);
  const clustererRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const messageIdRef = useRef(2);

  const filteredShops = useMemo(() => {
    const query = normalized(search);
    return RAMEN_SHOPS.filter((shop) => {
      const haystack = normalized(
        [
          shop.name,
          shop.signature,
          shop.region,
          shop.district,
          shop.tags.join(" "),
          shop.types.map((type) => RAMEN_TYPE_LABELS[type]).join(" "),
        ].join(" "),
      );
      const matchesQuery = !query || haystack.includes(query);
      const matchesRegion = region === "전국" || shop.region === region;
      const matchesType =
        selectedTypes.length === 0 ||
        selectedTypes.some((type) => shop.types.includes(type));
      return matchesQuery && matchesRegion && matchesType;
    });
  }, [region, search, selectedTypes]);

  const selectedShop = useMemo(
    () => RAMEN_SHOPS.find((shop) => shop.id === selectedId) ?? null,
    [selectedId],
  );

  const toggleType = (type: RamenType) => {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    );
    setSelectedId(null);
  };

  const resetFilters = () => {
    setSearch("");
    setRegion("전국");
    setSelectedTypes([]);
    setSelectedId(null);
  };

  const selectShop = useCallback((shop: RamenShop) => {
    setSelectedId(shop.id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!KAKAO_APP_KEY || !mapElementRef.current) {
      setMapStatus("missing");
      return;
    }

    setMapStatus("loading");
    loadKakaoSdk(KAKAO_APP_KEY)
      .then((kakao) => {
        if (cancelled || !mapElementRef.current) return;
        const maps = kakao.maps as unknown as {
          Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
          LatLng: new (lat: number, lng: number) => unknown;
          MarkerClusterer: new (options: Record<string, unknown>) => unknown;
        };
        kakaoRef.current = kakao;
        mapRef.current = new maps.Map(mapElementRef.current, {
          center: new maps.LatLng(36.35, 127.85),
          level: 13,
        });
        clustererRef.current = new maps.MarkerClusterer({
          map: mapRef.current,
          averageCenter: true,
          minLevel: 7,
          minClusterSize: 2,
          calculator: [2, 5, 10],
          styles: [
            {
              width: "42px",
              height: "42px",
              background: "#e54820",
              border: "4px solid rgba(255,255,255,.9)",
              borderRadius: "50%",
              color: "#fff",
              textAlign: "center",
              fontWeight: "800",
              lineHeight: "34px",
              boxShadow: "0 6px 18px rgba(92,28,10,.22)",
            },
            {
              width: "48px",
              height: "48px",
              background: "#1d211c",
              border: "4px solid rgba(255,255,255,.9)",
              borderRadius: "50%",
              color: "#fff",
              textAlign: "center",
              fontWeight: "800",
              lineHeight: "40px",
              boxShadow: "0 6px 18px rgba(0,0,0,.2)",
            },
            {
              width: "54px",
              height: "54px",
              background: "#f2ad35",
              border: "4px solid rgba(255,255,255,.9)",
              borderRadius: "50%",
              color: "#1d211c",
              textAlign: "center",
              fontWeight: "900",
              lineHeight: "46px",
              boxShadow: "0 6px 18px rgba(92,28,10,.22)",
            },
          ],
        });
        setMapStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setMapStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapStatus !== "ready" || !kakaoRef.current || !mapRef.current) return;

    const maps = kakaoRef.current.maps as unknown as {
      LatLng: new (lat: number, lng: number) => unknown;
      LatLngBounds: new () => {
        extend: (position: unknown) => void;
      };
      Marker: new (options: Record<string, unknown>) => {
        setMap: (map: unknown | null) => void;
      };
      event: {
        addListener: (target: unknown, event: string, callback: () => void) => void;
      };
    };
    const clusterer = clustererRef.current as {
      clear: () => void;
      addMarkers: (markers: unknown[]) => void;
    };
    const map = mapRef.current as {
      setBounds: (bounds: unknown, padding?: number) => void;
    };

    clusterer.clear();
    markersRef.current.forEach((marker) =>
      (marker as { setMap: (map: null) => void }).setMap(null),
    );

    const bounds = new maps.LatLngBounds();
    const markers = filteredShops.map((shop) => {
      const position = new maps.LatLng(shop.lat, shop.lng);
      const marker = new maps.Marker({ position, title: shop.name });
      bounds.extend(position);
      maps.event.addListener(marker, "click", () => selectShop(shop));
      return marker;
    });

    markersRef.current = markers;
    clusterer.addMarkers(markers);
    if (markers.length) map.setBounds(bounds, 64);
  }, [filteredShops, mapStatus, selectShop]);

  useEffect(() => {
    if (!selectedShop || mapStatus !== "ready" || !kakaoRef.current || !mapRef.current)
      return;
    const maps = kakaoRef.current.maps as unknown as {
      LatLng: new (lat: number, lng: number) => unknown;
    };
    (mapRef.current as { panTo: (position: unknown) => void }).panTo(
      new maps.LatLng(selectedShop.lat, selectedShop.lng),
    );
  }, [mapStatus, selectedShop]);

  const sendChat = (prompt: string) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;
    const results = recommendShops(cleanPrompt, region);
    const userId = messageIdRef.current++;
    const botId = messageIdRef.current++;
    setChatMessages((current) => [
      ...current,
      { id: userId, role: "user", text: cleanPrompt },
      {
        id: botId,
        role: "bot",
        text: results.length
          ? `${region === "전국" ? "전국" : region}에서 취향에 가까운 세 그릇을 찾았어요. 추천 이유도 함께 볼까요?`
          : "조건에 맞는 매장을 찾지 못했어요. 지역이나 취향을 조금 넓혀 다시 말해 주세요.",
        shopIds: results.map((shop) => shop.id),
      },
    ]);
    setChatInput("");
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendChat(chatInput);
  };

  const showRecommendedShop = (shop: RamenShop) => {
    setSearch("");
    setRegion("전국");
    setSelectedTypes([]);
    setSelectedId(shop.id);
    setMobileListOpen(false);
  };

  const mapStatusLabel =
    mapStatus === "ready"
      ? "카카오맵 연결됨"
      : mapStatus === "loading"
        ? "지도를 불러오는 중"
        : mapStatus === "error"
          ? "지도 연결 확인 필요"
          : "데모 지도";

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="라멘맵 홈">
          <span className="brand-bowl" aria-hidden="true">ら</span>
          <span>
            <strong>RAMEN MAP</strong>
            <small>전국 한 그릇 지도</small>
          </span>
        </a>
        <div className="header-center" aria-label="서비스 안내">
          <span className="live-dot" />
          전국 17개 시·도 · {RAMEN_SHOPS.length}개 데모 스폿
        </div>
        <button className="recommend-header" type="button" onClick={() => setChatOpen(true)}>
          <span aria-hidden="true">✦</span>
          취향으로 추천받기
        </button>
      </header>

      <div className="workspace" id="top">
        <aside className={`sidebar${mobileListOpen ? " mobile-open" : ""}`} aria-label="라멘 검색과 결과">
          <button
            className="mobile-sheet-handle"
            type="button"
            aria-label={mobileListOpen ? "목록 접기" : "목록 펼치기"}
            onClick={() => setMobileListOpen((open) => !open)}
          >
            <span />
          </button>

          <div className="search-section">
            <label className="search-box">
              <span className="search-icon" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="가게, 메뉴, 취향을 검색해보세요"
                type="search"
                aria-label="라멘 가게 검색"
                data-testid="shop-search"
              />
              {search ? (
                <button type="button" onClick={() => setSearch("")} aria-label="검색어 지우기">×</button>
              ) : null}
            </label>

            <div className="filter-row">
              <label className="region-select-wrap">
                <span aria-hidden="true">⌖</span>
                <select
                  value={region}
                  onChange={(event) => {
                    setRegion(event.target.value);
                    setSelectedId(null);
                  }}
                  aria-label="지역 선택"
                  data-testid="region-filter"
                >
                  {ALL_REGIONS.map((item) => (
                    <option value={item} key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <button className="reset-button" type="button" onClick={resetFilters}>
                초기화
              </button>
            </div>

            <div className="filter-heading">
              <span>메뉴로 골라보기</span>
              <small>여러 개 선택 가능</small>
            </div>
            <div className="type-filters" aria-label="라멘 종류 필터">
              {(Object.keys(RAMEN_TYPE_LABELS) as RamenType[]).map((type) => {
                const active = selectedTypes.includes(type);
                return (
                  <button
                    type="button"
                    key={type}
                    className={`type-filter type-${type}${active ? " active" : ""}`}
                    aria-pressed={active}
                    onClick={() => toggleType(type)}
                    data-testid={`type-${type}`}
                  >
                    <span aria-hidden="true" />
                    {RAMEN_TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="results-heading">
            <div>
              <strong>{region === "전국" ? "전국" : region} 라멘</strong>
              <span>{filteredShops.length}곳</span>
            </div>
            <span className="demo-badge">DEMO DATA</span>
          </div>

          <div className="results-list" data-testid="shop-list">
            {filteredShops.length ? (
              filteredShops.map((shop) => (
                <RamenCard
                  key={shop.id}
                  shop={shop}
                  selected={shop.id === selectedId}
                  onSelect={selectShop}
                />
              ))
            ) : (
              <div className="empty-state">
                <span aria-hidden="true">∿</span>
                <strong>조건에 맞는 한 그릇이 없어요</strong>
                <p>지역이나 메뉴 필터를 조금 넓혀보세요.</p>
                <button type="button" onClick={resetFilters}>전체 라멘 보기</button>
              </div>
            )}
          </div>
        </aside>

        <section className="map-panel" aria-label="전국 라멘 지도">
          <div className="map-toolbar">
            <span className={`map-status status-${mapStatus}`}>
              <i aria-hidden="true" />
              {mapStatusLabel}
            </span>
            <button type="button" onClick={resetFilters}>
              <span aria-hidden="true">⌂</span>
              전국 보기
            </button>
          </div>

          <div className="kakao-map" ref={mapElementRef} aria-hidden={mapStatus !== "ready"} />

          {mapStatus !== "ready" ? (
            <div className="fallback-map" data-testid="fallback-map">
              <div className="map-grid" />
              <div className="land-shape land-main" />
              <div className="land-shape land-south" />
              <div className="land-shape land-jeju" />
              {MAP_LABELS.map((label) => (
                <span className="fallback-label" style={{ left: label.left, top: label.top }} key={label.name}>
                  {label.name}
                </span>
              ))}
              {filteredShops.map((shop) => (
                <button
                  type="button"
                  className={`fallback-marker${selectedId === shop.id ? " selected" : ""}`}
                  style={markerPosition(shop)}
                  aria-label={`${shop.name}, ${shop.signature}`}
                  onClick={() => selectShop(shop)}
                  key={shop.id}
                >
                  <span>{RAMEN_TYPE_LABELS[shop.types[0]].slice(0, 1)}</span>
                </button>
              ))}
              <div className="map-credit">KAKAO MAP READY · API KEY REQUIRED</div>
            </div>
          ) : null}

          {mapStatus !== "ready" ? (
            <div className="map-notice" role="status">
              <span className="notice-icon" aria-hidden="true">K</span>
              <div>
                <strong>{mapStatus === "error" ? "카카오맵 연결을 확인해 주세요" : "지금은 데모 지도로 보고 있어요"}</strong>
                <p>JavaScript 키와 현재 도메인을 연결하면 실제 카카오맵으로 자동 전환됩니다.</p>
              </div>
              <a href="https://developers.kakao.com/docs/latest/ko/kakaomap/common" target="_blank" rel="noreferrer">
                연결 안내
              </a>
            </div>
          ) : null}

          {selectedShop ? (
            <article className="selected-shop-panel" aria-live="polite">
              <button className="panel-close" type="button" onClick={() => setSelectedId(null)} aria-label="매장 상세 닫기">×</button>
              <div className="selected-shop-head">
                <span className="shop-number">#{String(RAMEN_SHOPS.indexOf(selectedShop) + 1).padStart(2, "0")}</span>
                <div>
                  <small>{selectedShop.region} · {selectedShop.district} · DEMO</small>
                  <h2>{selectedShop.name}</h2>
                </div>
              </div>
              <div className="signature-box">
                <span>대표 한 그릇</span>
                <strong>{selectedShop.signature}</strong>
                <b>{formatPrice(selectedShop.price)}</b>
              </div>
              <div className="taste-meter" aria-label={`국물 농도 ${selectedShop.body}점, 매운맛 ${selectedShop.spiciness}점`}>
                <div>
                  <span>국물 농도</span>
                  <i>{Array.from({ length: 5 }).map((_, index) => <em className={index < selectedShop.body ? "filled" : ""} key={index} />)}</i>
                </div>
                <div>
                  <span>매운맛</span>
                  <i>{Array.from({ length: 5 }).map((_, index) => <em className={index < selectedShop.spiciness ? "filled spicy" : ""} key={index} />)}</i>
                </div>
              </div>
              <p className="shop-address">{selectedShop.address}</p>
              <div className="shop-actions">
                <span>{selectedShop.hours} · {selectedShop.closed}</span>
                <a
                  href={`https://map.kakao.com/link/map/${encodeURIComponent(selectedShop.name)},${selectedShop.lat},${selectedShop.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  카카오맵에서 보기 ↗
                </a>
              </div>
            </article>
          ) : null}

          <button
            className="mobile-list-toggle"
            type="button"
            onClick={() => setMobileListOpen(true)}
          >
            라멘 목록 {filteredShops.length}곳
          </button>
        </section>
      </div>

      {chatOpen ? (
        <section className="chat-panel" aria-label="라멘 취향 추천봇" data-testid="chat-panel">
          <header>
            <div className="bot-avatar" aria-hidden="true">ら</div>
            <div>
              <strong>한그릇 추천봇</strong>
              <span><i /> 취향 분석 중</span>
            </div>
            <button type="button" onClick={() => setChatOpen(false)} aria-label="추천봇 닫기">×</button>
          </header>
          <div className="chat-body" aria-live="polite">
            {chatMessages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                <p>{message.text}</p>
                {message.shopIds?.map((shopId) => {
                  const shop = RAMEN_SHOPS.find((item) => item.id === shopId);
                  if (!shop) return null;
                  return (
                    <button className="chat-recommendation" type="button" key={shop.id} onClick={() => showRecommendedShop(shop)}>
                      <span>
                        <small>{shop.region} · {RAMEN_TYPE_LABELS[shop.types[0]]}</small>
                        <strong>{shop.name}</strong>
                        <em>{getRecommendationReason(shop, chatMessages.find((item) => item.id === message.id - 1)?.text ?? "")}</em>
                      </span>
                      <b>보기</b>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="quick-replies" aria-label="빠른 취향 선택">
            {QUICK_REPLIES.map((reply) => (
              <button type="button" key={reply.label} onClick={() => sendChat(reply.prompt)}>{reply.label}</button>
            ))}
          </div>
          <form className="chat-form" onSubmit={submitChat}>
            <label>
              <span className="sr-only">원하는 라멘 취향 입력</span>
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="예: 서울에서 돼지고기 없이 담백하게"
                data-testid="chat-input"
              />
            </label>
            <button type="submit" aria-label="추천 요청 보내기">↑</button>
          </form>
          <p className="chat-disclaimer">데모 매장 데이터 안에서만 추천해요.</p>
        </section>
      ) : (
        <div className="chat-launch-wrap">
          <span className="chat-nudge">오늘 뭐 먹을지 고민이라면?</span>
          <button className="chat-launch" type="button" onClick={() => setChatOpen(true)} aria-label="라멘 취향 추천봇 열기">
            <span aria-hidden="true">✦</span>
            <b>취향 추천</b>
          </button>
        </div>
      )}
    </main>
  );
}
