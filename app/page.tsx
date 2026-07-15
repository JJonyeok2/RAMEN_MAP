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
import {
  analyzeRecommendationIntent,
  distanceBetweenKm,
  formatDistance,
  recommendShops,
  type Coordinates,
  type RecommendationResult,
} from "./recommendation";
import {
  LocationRequestError,
  requestCurrentCoordinates,
  type LocationFailureCode,
} from "./geolocation";

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
type LocationStatus = "idle" | "requesting" | "ready" | LocationFailureCode;
type ChatRecommendation = {
  shopId: string;
  reason: string;
  distanceKm: number | null;
};
type ChatMessage = {
  id: number;
  role: "bot" | "user";
  text: string;
  recommendations?: ChatRecommendation[];
};

const KAKAO_APP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";
const ALL_REGIONS = ["전국", ...REGIONS] as const;
const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 1,
    role: "bot",
    text: "반가워요! 오늘 기분과 당기는 맛을 알려주세요. 위치를 허용하면 가까운 곳부터 골라드릴게요.",
  },
];

const QUICK_REPLIES = [
  { label: "내 주변", prompt: "내 위치에서 가까운 라멘 추천해줘", useLocation: true },
  { label: "스트레스 날리기", prompt: "오늘 화가 나는데 스트레스 풀고 싶어" },
  { label: "맑고 담백하게", prompt: "맑고 담백한 국물 추천해줘" },
  { label: "진하고 묵직하게", prompt: "진하고 묵직한 라멘 추천해줘" },
  { label: "찍어 먹는 면", prompt: "츠케멘 추천해줘" },
  { label: "비벼 먹는 면", prompt: "마제소바 추천해줘" },
  { label: "얼큰하게", prompt: "매콤한 라멘 추천해줘" },
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

function markerPosition(point: Coordinates) {
  const left = ((point.lng - 125.4) / 4.7) * 100;
  const top = ((38.8 - point.lat) / 6.2) * 100;
  return {
    left: `${Math.min(92, Math.max(8, left))}%`,
    top: `${Math.min(92, Math.max(8, top))}%`,
  };
}

function isFallbackMapCoordinate(point: Coordinates) {
  return point.lng >= 125.4 && point.lng <= 130.1 && point.lat >= 32.6 && point.lat <= 38.8;
}

function locationStatusText(status: LocationStatus) {
  if (status === "requesting") return "현재 위치를 확인하고 있어요";
  if (status === "ready") return "내 위치 사용 중 · 직선거리 기준";
  if (status === "permission-denied") return "위치 권한이 꺼져 있어요";
  if (status === "unsupported") return "이 브라우저는 위치를 지원하지 않아요";
  if (status === "timeout") return "위치 확인 시간이 초과됐어요";
  if (status === "unavailable") return "현재 위치를 확인할 수 없어요";
  return "허용하면 가까운 곳부터 추천해요";
}

function buildBotReply(result: RecommendationResult, locationUnavailable: boolean) {
  const scope = result.nearbyUsed
    ? "현재 위치에서 가까운 순으로"
    : `${result.targetRegion === "전국" ? "전국" : result.targetRegion}에서`;
  const count = result.recommendations.length;

  if (!count) {
    return "조건에 맞는 매장을 찾지 못했어요. 지역이나 취향을 조금 넓혀 다시 말해 주세요.";
  }
  if (locationUnavailable) {
    return `위치를 확인하지 못해 ${scope} 조건에 가까운 ${count}곳을 골랐어요. 위치 권한을 허용하면 실제 가까운 순으로 다시 추천할게요.`;
  }
  if (result.intent.avoidSpicy) {
    return `${scope} 매운맛은 빼고 편안하게 즐길 ${count}곳을 골랐어요.`;
  }
  if (result.strategy === "karai") {
    return `${scope} 스트레스를 날릴 카라이 메뉴가 있는 ${count}곳을 골랐어요.`;
  }
  if (result.intent.wantsKarai && result.strategy === "spicy") {
    return `${scope} 카라이 메뉴가 없어 화끈한 매운맛 메뉴 ${count}곳을 대신 골랐어요.`;
  }
  if (result.intent.wantsKarai) {
    return `${scope} 카라이·고맵기 메뉴가 없어 현재 조건에 가까운 ${count}곳을 보여드려요.`;
  }
  return `${scope} 취향에 가까운 ${count}곳을 골랐어요. 추천 이유도 함께 확인해 보세요.`;
}

function RamenCard({
  shop,
  selected,
  distanceKm,
  onSelect,
}: {
  shop: RamenShop;
  selected: boolean;
  distanceKm: number | null;
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
      {distanceKm !== null ? (
        <span className="ramen-card-distance">⌖ 내 위치에서 직선 {formatDistance(distanceKm)}</span>
      ) : null}
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
  const [region, setRegion] = useState<(typeof ALL_REGIONS)[number]>("전국");
  const [selectedTypes, setSelectedTypes] = useState<RamenType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState<MapStatus>(
    KAKAO_APP_KEY ? "loading" : "missing",
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatBusy, setChatBusy] = useState(false);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");

  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const kakaoRef = useRef<KakaoNamespace | null>(null);
  const clustererRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const userLocationOverlayRef = useRef<{ setMap: (map: unknown | null) => void } | null>(null);
  const locationRequestRef = useRef<Promise<Coordinates | null> | null>(null);
  const pendingChatRef = useRef(false);
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

  const displayedShops = useMemo(() => {
    const shops = filteredShops.map((shop) => ({
      shop,
      distanceKm: userLocation
        ? distanceBetweenKm(userLocation, { lat: shop.lat, lng: shop.lng })
        : null,
    }));
    if (!userLocation) return shops;
    return shops.sort(
      (left, right) => (left.distanceKm ?? 0) - (right.distanceKm ?? 0),
    );
  }, [filteredShops, userLocation]);

  const selectedDistance = useMemo(
    () =>
      selectedShop && userLocation
        ? distanceBetweenKm(userLocation, {
            lat: selectedShop.lat,
            lng: selectedShop.lng,
          })
        : null,
    [selectedShop, userLocation],
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

  const requestUserLocation = useCallback(async () => {
    if (userLocation) return userLocation;
    if (locationRequestRef.current) return locationRequestRef.current;

    setLocationStatus("requesting");
    const request = requestCurrentCoordinates(
      typeof navigator === "undefined" ? undefined : navigator.geolocation,
    )
      .then((coordinates) => {
        setUserLocation(coordinates);
        setLocationStatus("ready");
        return coordinates;
      })
      .catch((error: unknown) => {
        setLocationStatus(
          error instanceof LocationRequestError ? error.code : "unavailable",
        );
        return null;
      })
      .finally(() => {
        locationRequestRef.current = null;
      });

    locationRequestRef.current = request;
    return request;
  }, [userLocation]);

  const focusUserLocation = useCallback((coordinates: Coordinates) => {
    if (!kakaoRef.current || !mapRef.current) return;
    const maps = kakaoRef.current.maps as unknown as {
      LatLng: new (lat: number, lng: number) => unknown;
    };
    const map = mapRef.current as {
      panTo: (position: unknown) => void;
      setLevel: (level: number) => void;
    };
    map.setLevel(7);
    map.panTo(new maps.LatLng(coordinates.lat, coordinates.lng));
  }, []);

  const locateMe = useCallback(async () => {
    const coordinates = await requestUserLocation();
    if (coordinates) focusUserLocation(coordinates);
  }, [focusUserLocation, requestUserLocation]);

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

  useEffect(() => {
    userLocationOverlayRef.current?.setMap(null);
    userLocationOverlayRef.current = null;
    if (!userLocation || mapStatus !== "ready" || !kakaoRef.current || !mapRef.current)
      return;

    const maps = kakaoRef.current.maps as unknown as {
      LatLng: new (lat: number, lng: number) => unknown;
      CustomOverlay: new (options: Record<string, unknown>) => {
        setMap: (map: unknown | null) => void;
      };
    };
    const content = document.createElement("div");
    const dot = document.createElement("span");
    const label = document.createElement("b");
    content.className = "current-location-marker";
    label.textContent = "내 위치";
    content.append(dot, label);

    const overlay = new maps.CustomOverlay({
      position: new maps.LatLng(userLocation.lat, userLocation.lng),
      content,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 10,
    });
    overlay.setMap(mapRef.current);
    userLocationOverlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
      if (userLocationOverlayRef.current === overlay) {
        userLocationOverlayRef.current = null;
      }
    };
  }, [mapStatus, userLocation]);

  const sendChat = async (prompt: string, forceLocation = false) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || pendingChatRef.current) return;

    pendingChatRef.current = true;
    setChatBusy(true);
    const userId = messageIdRef.current++;
    setChatMessages((current) => [
      ...current,
      { id: userId, role: "user", text: cleanPrompt },
    ]);
    setChatInput("");

    try {
      const intent = analyzeRecommendationIntent(cleanPrompt);
      let coordinates = userLocation;
      let locationUnavailable = false;
      if ((forceLocation || intent.nearby) && !coordinates) {
        coordinates = await requestUserLocation();
        locationUnavailable = !coordinates;
      }

      const result = recommendShops(cleanPrompt, region, coordinates);
      const botId = messageIdRef.current++;
      setChatMessages((current) => [
        ...current,
        {
          id: botId,
          role: "bot",
          text: buildBotReply(result, locationUnavailable),
          recommendations: result.recommendations.map((recommendation) => ({
            shopId: recommendation.shop.id,
            reason: recommendation.reason,
            distanceKm: recommendation.distanceKm,
          })),
        },
      ]);
    } finally {
      pendingChatRef.current = false;
      setChatBusy(false);
    }
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendChat(chatInput);
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
                    setRegion(event.target.value as (typeof ALL_REGIONS)[number]);
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
              displayedShops.map(({ shop, distanceKm }) => (
                <RamenCard
                  key={shop.id}
                  shop={shop}
                  selected={shop.id === selectedId}
                  distanceKm={distanceKm}
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
            <div className="map-toolbar-actions">
              <button
                className={`locate-button status-${locationStatus}`}
                type="button"
                onClick={() => void locateMe()}
                disabled={locationStatus === "requesting"}
                aria-label="내 위치를 사용해 가까운 라멘 찾기"
                data-testid="locate-button"
              >
                <span aria-hidden="true">◎</span>
                {locationStatus === "requesting"
                  ? "위치 확인 중"
                  : locationStatus === "ready"
                    ? "내 위치 사용 중"
                    : "내 위치"}
              </button>
              <button type="button" onClick={resetFilters}>
                <span aria-hidden="true">⌂</span>
                전국 보기
              </button>
            </div>
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
              {userLocation && isFallbackMapCoordinate(userLocation) ? (
                <div
                  className="fallback-user-marker"
                  style={markerPosition(userLocation)}
                  role="img"
                  aria-label="내 현재 위치"
                  data-testid="fallback-user-marker"
                >
                  <span />
                  <b>내 위치</b>
                </div>
              ) : null}
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
                  <small>
                    {selectedShop.region} · {selectedShop.district} · DEMO
                    {selectedDistance !== null
                      ? ` · 직선 ${formatDistance(selectedDistance)}`
                      : ""}
                  </small>
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
              <span><i /> {chatBusy ? "추천을 고르는 중" : "기분·취향 분석 준비"}</span>
            </div>
            <button type="button" onClick={() => setChatOpen(false)} aria-label="추천봇 닫기">×</button>
          </header>
          <div className="chat-body" aria-live="polite">
            {chatMessages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                <p>{message.text}</p>
                {message.recommendations?.map((recommendation) => {
                  const shop = RAMEN_SHOPS.find((item) => item.id === recommendation.shopId);
                  if (!shop) return null;
                  return (
                    <button
                      className="chat-recommendation"
                      type="button"
                      key={shop.id}
                      onClick={() => showRecommendedShop(shop)}
                      data-testid={`chat-recommendation-${shop.id}`}
                    >
                      <span>
                        <small>
                          {shop.region} · {RAMEN_TYPE_LABELS[shop.types[0]]}
                          {recommendation.distanceKm !== null
                            ? ` · 직선 ${formatDistance(recommendation.distanceKm)}`
                            : ""}
                        </small>
                        <strong>{shop.name}</strong>
                        <em>{recommendation.reason}</em>
                      </span>
                      <b>보기</b>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className={`chat-location status-${locationStatus}`} role="status">
            <button
              type="button"
              onClick={() => void requestUserLocation()}
              disabled={locationStatus === "requesting"}
              aria-label="내 위치 기반 주변 추천 사용"
            >
              <span aria-hidden="true">◎</span>
              <b>내 위치 기반 추천</b>
            </button>
            <span>{locationStatusText(locationStatus)}</span>
          </div>
          <div className="quick-replies" aria-label="빠른 취향 선택">
            {QUICK_REPLIES.map((reply) => (
              <button
                type="button"
                key={reply.label}
                onClick={() => void sendChat(reply.prompt, reply.useLocation)}
                disabled={chatBusy}
              >
                {reply.label}
              </button>
            ))}
          </div>
          <form className="chat-form" onSubmit={submitChat}>
            <label>
              <span className="sr-only">원하는 라멘 취향 입력</span>
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="예: 오늘 화가 나서 스트레스를 풀고 싶어"
                data-testid="chat-input"
                disabled={chatBusy}
              />
            </label>
            <button type="submit" aria-label="추천 요청 보내기" disabled={chatBusy}>↑</button>
          </form>
          <p className="chat-disclaimer">창작 데모 매장 기준 · 위치는 저장하지 않으며 거리는 직선거리예요.</p>
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
