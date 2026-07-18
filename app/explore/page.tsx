"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  PreferenceControls,
  type BodyTarget,
  type SpicinessTarget,
} from "../../components/preference-controls";
import { RecommendationCard } from "../../components/recommendation-card";
import type { Coordinates, RecommendationItem, RecommendationResponse } from "../../domain/recommendation";
import type { Area, BrothBase, BrothStyle, RamenType, RecommendationMode } from "../../domain/ramen";
import { createProductEventEmitter, type ProductEventDetails } from "../../features/analytics/client-events";
import { locationFallbackMessage, requestRadiusSearchOrigin } from "../../features/location/radius-search";
import { RequestCoordinator } from "../../features/location/request-coordinator";
import { parseAreasResponse, parsePublicError, parseRecommendationResponse } from "../../features/recommendation/client-response";

const recommendationModes: Array<{
  value: RecommendationMode;
  label: string;
  description: string;
}> = [
  { value: "taste", label: "취향 우선", description: "선택한 맛과 메뉴를 먼저 봐요" },
  { value: "balanced", label: "균형 추천", description: "취향, 거리, 영업 정보를 함께 봐요" },
  { value: "distance", label: "가까운 곳 우선", description: "선택한 지역에서 가까운 순서를 중시해요" },
];

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
    status: "results";
    result: RecommendationResponse;
    context: { startedAt: number; areaId: string | null };
  };

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resultCount(result: RecommendationResponse) {
  return result.verified.length + result.candidates.length;
}

function monotonicNow() {
  return performance.now();
}

async function fetchAreas(signal: AbortSignal) {
  const response = await fetch("/api/v1/areas", { cache: "no-store", signal });
  const body = await readJson(response);
  if (!response.ok) throw new Error(parsePublicError(body, "지역을 불러오지 못했어요."));
  return parseAreasResponse(body);
}

export default function ExplorePage() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [areaError, setAreaError] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [locationOrigin, setLocationOrigin] = useState<Coordinates | null>(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [mode, setMode] = useState<RecommendationMode>("balanced");
  const [ramenTypes, setRamenTypes] = useState<RamenType[]>([]);
  const [brothStyles, setBrothStyles] = useState<BrothStyle[]>([]);
  const [brothBases, setBrothBases] = useState<BrothBase[]>([]);
  const [bodyTarget, setBodyTarget] = useState<BodyTarget | null>(null);
  const [spicinessTarget, setSpicinessTarget] = useState<SpicinessTarget | null>(null);
  const [preferenceText, setPreferenceText] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const areaCoordinatorRef = useRef<RequestCoordinator | null>(null);
  const locationCoordinatorRef = useRef<RequestCoordinator | null>(null);
  const recommendationCoordinatorRef = useRef<RequestCoordinator | null>(null);
  const eventEmitterRef = useRef<ReturnType<typeof createProductEventEmitter> | null>(null);

  const areaCoordinator = () => (areaCoordinatorRef.current ??= new RequestCoordinator());
  const locationCoordinator = () => (locationCoordinatorRef.current ??= new RequestCoordinator());
  const recommendationCoordinator = () => (recommendationCoordinatorRef.current ??= new RequestCoordinator());

  const emitEvent = (
    eventType: "recommendation_shown" | "shop_selected" | "directions_clicked",
    details: ProductEventDetails,
  ) => {
    try {
      eventEmitterRef.current ??= createProductEventEmitter({
        storage: window.sessionStorage,
        crypto: window.crypto,
        fetch: window.fetch.bind(window),
      });
      eventEmitterRef.current(eventType, details);
    } catch {
      // Analytics setup is deliberately unable to interrupt exploration.
    }
  };

  const loadAreas = async () => {
    const request = areaCoordinator().begin();
    setAreasLoading(true);
    setAreaError("");
    try {
      const loadedAreas = await fetchAreas(request.signal);
      if (!areaCoordinator().isCurrent(request.token)) return;
      setAreas(loadedAreas);
    } catch (error) {
      if (!areaCoordinator().isCurrent(request.token)) return;
      setAreaError(error instanceof Error ? error.message : "지역을 불러오지 못했어요.");
    } finally {
      if (areaCoordinator().isCurrent(request.token)) setAreasLoading(false);
    }
  };

  useEffect(() => {
    const mountedAreaCoordinator = areaCoordinator();
    const request = mountedAreaCoordinator.begin();
    fetchAreas(request.signal)
      .then((loadedAreas) => {
        if (mountedAreaCoordinator.isCurrent(request.token)) setAreas(loadedAreas);
      })
      .catch((error: unknown) => {
        if (mountedAreaCoordinator.isCurrent(request.token)) {
          setAreaError(error instanceof Error ? error.message : "지역을 불러오지 못했어요.");
        }
      })
      .finally(() => {
        if (mountedAreaCoordinator.isCurrent(request.token)) setAreasLoading(false);
      });
    return () => {
      mountedAreaCoordinator.dispose();
      locationCoordinatorRef.current?.dispose();
      recommendationCoordinatorRef.current?.dispose();
      if (areaCoordinatorRef.current === mountedAreaCoordinator) areaCoordinatorRef.current = null;
      locationCoordinatorRef.current = null;
      recommendationCoordinatorRef.current = null;
    };
  }, []);

  const supersedeRecommendation = () => {
    recommendationCoordinator().begin();
    setState({ status: "idle" });
  };

  const selectAreaOrigin = (areaId: string) => {
    locationCoordinator().begin();
    setLocating(false);
    setSelectedAreaId(areaId);
    setLocationOrigin(null);
    setLocationMessage("");
    setSelectionError("");
    supersedeRecommendation();
  };

  const chooseCurrentLocation = async () => {
    const request = locationCoordinator().begin();
    supersedeRecommendation();
    setLocating(true);
    setLocationMessage("");
    setSelectionError("");
    try {
      const origin = await requestRadiusSearchOrigin(navigator.geolocation);
      if (!locationCoordinator().isCurrent(request.token)) return;
      setLocationOrigin(origin);
      setSelectedAreaId("");
      setLocationMessage("현재 위치를 추천 기준으로 사용할게요.");
    } catch (error) {
      if (!locationCoordinator().isCurrent(request.token)) return;
      setLocationOrigin(null);
      setLocationMessage(locationFallbackMessage(error));
    } finally {
      if (locationCoordinator().isCurrent(request.token)) setLocating(false);
    }
  };

  const runSearch = async () => {
    const selectedArea = areas.find((area) => area.id === selectedAreaId);
    const origin = selectedArea
      ? { lat: selectedArea.lat, lng: selectedArea.lng }
      : locationOrigin;
    if (!origin) {
      setSelectionError("먼저 지역을 고르거나 현재 위치를 사용해 주세요.");
      return;
    }

    const areaId = selectedArea?.id ?? null;
    const startedAt = monotonicNow();
    const request = recommendationCoordinator().begin();
    setSelectionError("");
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/v1/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          origin,
          mode,
          quick: false,
          selections: {
            ramenTypes,
            brothStyles,
            brothBases,
            bodyTarget,
            spicinessTarget,
          },
          text: preferenceText,
        }),
      });
      const body = await readJson(response);
      if (!recommendationCoordinator().isCurrent(request.token)) return;
      if (!response.ok) throw new Error(parsePublicError(body, "추천을 불러오지 못했어요."));
      const result = parseRecommendationResponse(body);
      if (!recommendationCoordinator().isCurrent(request.token)) return;
      const context = { startedAt, areaId };
      setState({ status: "results", result, context });
      emitEvent("recommendation_shown", {
        elapsedMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
        ...(areaId ? { areaId } : {}),
        radiusKm: result.radiusKm,
      });
    } catch (error) {
      if (!recommendationCoordinator().isCurrent(request.token)) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "추천을 불러오지 못했어요.",
      });
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch();
  };

  const resultEventDetails = (
    item: RecommendationItem,
    result: RecommendationResponse,
    context: { startedAt: number; areaId: string | null },
  ): ProductEventDetails => ({
    elapsedMs: Math.max(0, Math.round(monotonicNow() - context.startedAt)),
    ...(context.areaId ? { areaId: context.areaId } : {}),
    radiusKm: result.radiusKm,
    verificationStatus: item.branch.verificationStatus,
  });

  return (
    <main className="explore-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAMEN MAP 홈">
          <span className="brand-bowl" aria-hidden="true">ら</span>
          <span><strong>RAMEN MAP</strong><small>취향으로 탐방</small></span>
        </Link>
        <Link className="header-back" href="/">모드 다시 고르기</Link>
      </header>

      <section className="explore-hero" aria-labelledby="explore-title">
        <p className="explore-eyebrow">RAMEN TOUR · YOUR TASTE</p>
        <h1 id="explore-title">라멘 탐방</h1>
        <p>청탕과 백탕부터 쇼유, 시오, 츠케멘, 마제소바까지 원하는 기준을 함께 골라보세요.</p>
      </section>

      <form className="explore-form" onSubmit={submit}>
        <section className="explore-panel origin-panel" aria-labelledby="origin-title">
          <div className="explore-section-heading">
            <span>01</span>
            <div><h2 id="origin-title">탐방할 지역</h2><p>지역을 고르거나 현재 위치를 한 번만 사용해 시작하세요.</p></div>
          </div>
          <div className="origin-actions">
            <label htmlFor="explore-area">
              지역 선택
              <select
                id="explore-area"
                value={selectedAreaId}
                disabled={areasLoading || Boolean(areaError)}
                onChange={(event) => selectAreaOrigin(event.target.value)}
              >
                <option value="">{areasLoading ? "지역 불러오는 중…" : "지역을 골라 주세요"}</option>
                {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>
            <span>또는</span>
            <button className="secondary-button" type="button" disabled={locating} onClick={() => void chooseCurrentLocation()}>
              {locating ? "현재 위치 확인 중…" : "현재 위치 사용"}
            </button>
          </div>
          {areaError ? (
            <div className="inline-error" role="alert">
              <p>{areaError}</p>
              <button type="button" onClick={() => void loadAreas()}>지역 다시 불러오기</button>
            </div>
          ) : null}
          {!areasLoading && !areaError && areas.length === 0 ? (
            <div className="empty-message">
              <p>선택할 수 있는 지역이 아직 없어요. 잠시 뒤 다시 시도해 주세요.</p>
              <button className="secondary-button" type="button" onClick={() => void loadAreas()}>지역 다시 불러오기</button>
            </div>
          ) : null}
          {locationMessage ? <p className="location-message" role="status">{locationMessage}</p> : null}
          {selectionError ? <p className="selection-error" role="alert">{selectionError}</p> : null}
        </section>

        <section className="explore-panel" aria-labelledby="mode-title">
          <div className="explore-section-heading">
            <span>02</span>
            <div><h2 id="mode-title">추천 순서</h2><p>기본은 균형 추천이에요.</p></div>
          </div>
          <div className="ranking-options explore-ranking">
            {recommendationModes.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="explore-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="explore-panel" aria-labelledby="taste-title">
          <div className="explore-section-heading">
            <span>03</span>
            <div><h2 id="taste-title">빠른 취향과 한마디</h2><p>버튼 선택과 “추가로 원하는 맛을 말해보세요”의 내용을 합쳐 추천해요.</p></div>
          </div>
          <PreferenceControls
            ramenTypes={ramenTypes}
            onRamenTypesChange={setRamenTypes}
            brothStyles={brothStyles}
            onBrothStylesChange={setBrothStyles}
            brothBases={brothBases}
            onBrothBasesChange={setBrothBases}
            bodyTarget={bodyTarget}
            onBodyTargetChange={setBodyTarget}
            spicinessTarget={spicinessTarget}
            onSpicinessTargetChange={setSpicinessTarget}
            text={preferenceText}
            onTextChange={setPreferenceText}
          />
        </section>

        <button className="primary-button explore-submit" type="submit" disabled={state.status === "loading"}>
          {state.status === "loading" ? "추천을 고르는 중…" : "이 취향으로 탐방 시작"}
        </button>
      </form>

      <section className="explore-results" aria-live="polite">
        {state.status === "error" ? (
          <div className="flow-state error-state" role="alert">
            <h2>추천을 불러오지 못했어요</h2>
            <p>{state.message}</p>
            <button className="primary-button" type="button" onClick={() => void runSearch()}>다시 시도</button>
          </div>
        ) : null}

        {state.status === "results" ? (
          <div className="result-groups">
            <div className="results-summary" role="status">
              <strong>{resultCount(state.result)}곳을 찾았어요</strong>
              <span>검색 반경 {state.result.radiusKm}km · 모든 거리는 직선거리</span>
            </div>
            {state.result.expanded ? (
              <p className="radius-expanded">3km에서 결과가 부족해 검색 반경을 {state.result.radiusKm}km까지 넓혔어요.</p>
            ) : null}

            <section className="verified-results" aria-labelledby="explore-verified-title">
              <div className="section-heading">
                <div><p>PUBLIC · VERIFIED</p><h2 id="explore-verified-title">검증 완료 추천</h2></div>
                <span>{state.result.verified.length}곳</span>
              </div>
              {state.result.verified.length ? (
                <div className="recommendation-grid">
                  {state.result.verified.map((item) => (
                    <RecommendationCard
                      key={item.branch.id}
                      item={item}
                      onDetail={(selected) => emitEvent("shop_selected", resultEventDetails(selected, state.result, state.context))}
                      onDirections={(selected) => emitEvent("directions_clicked", resultEventDetails(selected, state.result, state.context))}
                    />
                  ))}
                </div>
              ) : <p className="empty-message">검증 완료 매장이 없어요.</p>}
            </section>

            <section className="candidate-results" aria-labelledby="explore-candidate-title">
              <div className="section-heading">
                <div><p>CHECK BEFORE VISIT</p><h2 id="explore-candidate-title">검증 전 후보</h2></div>
                <span>{state.result.candidates.length}곳</span>
              </div>
              <p className="candidate-notice">정보가 바뀌었을 수 있어 방문 전에 출처와 외부 지도를 확인해 주세요.</p>
              {state.result.candidates.length ? (
                <div className="recommendation-grid candidate-grid">
                  {state.result.candidates.map((item) => (
                    <RecommendationCard
                      key={item.branch.id}
                      item={item}
                      onDetail={(selected) => emitEvent("shop_selected", resultEventDetails(selected, state.result, state.context))}
                      onDirections={(selected) => emitEvent("directions_clicked", resultEventDetails(selected, state.result, state.context))}
                    />
                  ))}
                </div>
              ) : <p className="empty-message">현재 조건에 맞는 검증 전 후보가 없어요.</p>}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
