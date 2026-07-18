"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { RecommendationCard } from "../../components/recommendation-card";
import type {
  Coordinates,
  RecommendationItem,
  RecommendationResponse,
} from "../../domain/recommendation";
import type {
  Area,
  BrothStyle,
  RamenType,
  RecommendationMode,
} from "../../domain/ramen";
import {
  locationFallbackMessage,
  requestRadiusSearchOrigin,
} from "../../features/location/radius-search";
import { createProductEventEmitter, type ProductEventDetails } from "../../features/analytics/client-events";
import { RequestCoordinator, type CoordinatedRequest } from "../../features/location/request-coordinator";
import {
  parseAreasResponse,
  parsePublicError,
  parseRecommendationResponse,
} from "../../features/recommendation/client-response";

type EventType = "quick_started" | "recommendation_shown" | "shop_selected" | "directions_clicked";

interface ResultContext {
  startedAt: number;
  selectedAreaId: string | null;
}

interface SearchContext extends ResultContext {
  origin: Coordinates;
  mode: RecommendationMode;
  selections: PreferenceSelections;
  text: string;
}

type NearbyState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "choosing-area"; message: string }
  | { status: "loading" }
  | { status: "results"; result: RecommendationResponse; context: ResultContext }
  | { status: "error"; message: string };

interface PreferenceSelections {
  ramenTypes?: RamenType[];
  brothStyles?: BrothStyle[];
  spicinessTarget?: number;
}

type QuickPreference = "clear" | "rich" | "spicy" | "tsukemen";

const radiusSteps = [
  { radius: 3, label: "3km" },
  { radius: 10, label: "10km" },
  { radius: 30, label: "30km" },
] as const;

const recommendationModes: Array<{
  value: RecommendationMode;
  label: string;
  description: string;
}> = [
  { value: "distance", label: "거리 우선", description: "가까운 곳부터" },
  { value: "balanced", label: "균형 추천", description: "거리와 취향을 함께" },
  { value: "taste", label: "취향 우선", description: "원하는 맛을 먼저" },
];

const quickPreferenceOptions: Array<{ value: QuickPreference; label: string }> = [
  { value: "clear", label: "맑고 담백" },
  { value: "rich", label: "진하고 묵직" },
  { value: "spicy", label: "매콤하게" },
  { value: "tsukemen", label: "츠케멘" },
];

const emptySelections: PreferenceSelections = {};

function monotonicNow() {
  return performance.now();
}

function buildSelections(preferences: QuickPreference[]): PreferenceSelections {
  const brothStyles: BrothStyle[] = [];
  if (preferences.includes("clear")) brothStyles.push("chintan");
  if (preferences.includes("rich")) brothStyles.push("paitan");
  return {
    ...(brothStyles.length ? { brothStyles } : {}),
    ...(preferences.includes("spicy") ? { spicinessTarget: 4 } : {}),
    ...(preferences.includes("tsukemen") ? { ramenTypes: ["tsukemen"] } : {}),
  };
}

function resultCount(result: RecommendationResponse) {
  return result.verified.length + result.candidates.length;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function NearbyPage() {
  const [state, setState] = useState<NearbyState>({ status: "idle" });
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);
  const [areaError, setAreaError] = useState("");
  const [mode, setMode] = useState<RecommendationMode>("distance");
  const [quickPreferences, setQuickPreferences] = useState<QuickPreference[]>([]);
  const [desiredBowl, setDesiredBowl] = useState("");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const searchRef = useRef<SearchContext | null>(null);
  const coordinatorRef = useRef<RequestCoordinator | null>(null);
  const eventEmitterRef = useRef<ReturnType<typeof createProductEventEmitter> | null>(null);

  const coordinator = () => (coordinatorRef.current ??= new RequestCoordinator());

  useEffect(() => () => coordinatorRef.current?.dispose(), []);

  const emitEvent = (eventType: EventType, details: ProductEventDetails = {}) => {
    try {
      eventEmitterRef.current ??= createProductEventEmitter({
        storage: window.sessionStorage,
        crypto: window.crypto,
        fetch: window.fetch.bind(window),
      });
      eventEmitterRef.current(eventType, details);
    } catch {
      // Analytics setup is deliberately unable to interrupt the nearby flow.
    }
  };

  const elapsedMs = (startedAt: number) => Math.max(0, Math.round(monotonicNow() - startedAt));

  const beginSearch = (context: Omit<SearchContext, "startedAt">) => {
    const search = { ...context, startedAt: monotonicNow() };
    const request = coordinator().begin();
    emitEvent("quick_started", {
      elapsedMs: 0,
      ...(search.selectedAreaId ? { areaId: search.selectedAreaId } : {}),
    });
    return { request, search };
  };

  const fetchRecommendation = async (search: SearchContext, request: CoordinatedRequest) => {
    if (!coordinator().isCurrent(request.token)) return;
    searchRef.current = search;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/v1/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          origin: search.origin,
          mode: search.mode,
          quick: true,
          selections: search.selections,
          text: search.text,
        }),
      });
      const body = await readJson(response);
      if (!coordinator().isCurrent(request.token)) return;
      if (!response.ok) throw new Error(parsePublicError(body, "추천을 불러오지 못했어요."));
      const result = parseRecommendationResponse(body);
      if (!coordinator().isCurrent(request.token)) return;
      const context: ResultContext = { startedAt: search.startedAt, selectedAreaId: search.selectedAreaId };
      setState({ status: "results", result, context });
      emitEvent("recommendation_shown", {
        elapsedMs: elapsedMs(context.startedAt),
        ...(context.selectedAreaId ? { areaId: context.selectedAreaId } : {}),
        radiusKm: result.radiusKm,
      });
    } catch (error) {
      if (!coordinator().isCurrent(request.token)) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "추천을 불러오지 못했어요.",
      });
    }
  };

  const loadAreas = async (message: string, pendingRequest?: CoordinatedRequest) => {
    const request = pendingRequest ?? coordinator().begin();
    if (!coordinator().isCurrent(request.token)) return;
    setState({ status: "choosing-area", message });
    setAreasLoading(true);
    setAreaError("");
    try {
      const response = await fetch("/api/v1/areas", { cache: "no-store", signal: request.signal });
      const body = await readJson(response);
      if (!coordinator().isCurrent(request.token)) return;
      if (!response.ok) throw new Error(parsePublicError(body, "지역을 불러오지 못했어요."));
      setAreas(parseAreasResponse(body));
    } catch (error) {
      if (!coordinator().isCurrent(request.token)) return;
      setAreaError(error instanceof Error ? error.message : "지역을 불러오지 못했어요.");
    } finally {
      if (coordinator().isCurrent(request.token)) setAreasLoading(false);
    }
  };

  const startWithCurrentLocation = async () => {
    const { request, search } = beginSearch({
      origin: { lat: 0, lng: 0 }, mode: "distance", selections: emptySelections, text: "", selectedAreaId: null,
    });
    setState({ status: "locating" });
    try {
      const origin = await requestRadiusSearchOrigin(navigator.geolocation);
      if (!coordinator().isCurrent(request.token)) return;
      setMode("distance");
      setQuickPreferences([]);
      setDesiredBowl("");
      await fetchRecommendation({ ...search, origin }, request);
    } catch (error) {
      if (!coordinator().isCurrent(request.token)) return;
      await loadAreas(locationFallbackMessage(error), request);
    }
  };

  const chooseArea = (area: Area) => {
    const { request, search } = beginSearch({
      origin: { lat: area.lat, lng: area.lng }, mode: "distance", selections: emptySelections, text: "", selectedAreaId: area.id,
    });
    setMode("distance");
    setQuickPreferences([]);
    setDesiredBowl("");
    void fetchRecommendation(search, request);
  };

  const retryRecommendation = () => {
    if (!searchRef.current) {
      void startWithCurrentLocation();
      return;
    }
    const { request, search } = beginSearch({
      origin: searchRef.current.origin,
      mode,
      selections: buildSelections(quickPreferences),
      text: desiredBowl,
      selectedAreaId: searchRef.current.selectedAreaId,
    });
    void fetchRecommendation(search, request);
  };

  const submitPreferences = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searchRef.current) return;
    const { request, search } = beginSearch({
      origin: searchRef.current.origin,
      mode,
      selections: buildSelections(quickPreferences),
      text: desiredBowl,
      selectedAreaId: searchRef.current.selectedAreaId,
    });
    void fetchRecommendation(search, request);
  };

  const togglePreference = (preference: QuickPreference) => {
    setQuickPreferences((current) => current.includes(preference)
      ? current.filter((item) => item !== preference)
      : [...current, preference]);
  };

  const resultEventDetails = (item: RecommendationItem, result: RecommendationResponse, context: ResultContext) => ({
    elapsedMs: elapsedMs(context.startedAt),
    ...(context.selectedAreaId ? { areaId: context.selectedAreaId } : {}),
    radiusKm: result.radiusKm,
    verificationStatus: item.branch.verificationStatus,
  });

  const onDetail = (item: RecommendationItem, result: RecommendationResponse, context: ResultContext) => {
    emitEvent("shop_selected", resultEventDetails(item, result, context));
  };

  const onDirections = (item: RecommendationItem, result: RecommendationResponse, context: ResultContext) => {
    emitEvent("directions_clicked", resultEventDetails(item, result, context));
  };

  const showPreferenceForm = preferencesOpen && state.status === "results";

  return (
    <main className="nearby-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAMEN MAP 홈">
          <span className="brand-bowl" aria-hidden="true">ら</span>
          <span><strong>RAMEN MAP</strong><small>빠른 한 그릇</small></span>
        </Link>
        <Link className="header-back" href="/">모드 다시 고르기</Link>
      </header>

      <section className="nearby-hero" aria-labelledby="nearby-title">
        <p className="nearby-eyebrow">QUICK PICK · 60 SECONDS</p>
        <h1 id="nearby-title">배고파요 · 빨리 찾기</h1>
        <p>현재 위치를 한 번만 확인해 직선거리 기준으로 갈 만한 세 곳을 골라드려요.</p>
        <div className="radius-steps" aria-label="추천 검색 반경">
          {radiusSteps.map((step, index) => (
            <span key={step.radius}>
              {step.label}{index < radiusSteps.length - 1 ? "부터" : "까지"}
            </span>
          ))}
          <small>결과가 부족하면 자동으로 넓혀요.</small>
        </div>
      </section>

      <section className="nearby-flow" aria-live="polite">
        {state.status === "idle" ? (
          <div className="start-panel">
            <span className="step-number" aria-hidden="true">01</span>
            <div>
              <h2>현재 위치에서 시작</h2>
              <p>좌표는 추천 요청에만 사용하고 브라우저나 분석 이벤트에 저장하지 않아요.</p>
            </div>
            <button className="primary-button" type="button" onClick={() => void startWithCurrentLocation()}>
              현재 위치로 3곳 찾기
            </button>
          </div>
        ) : null}

        {state.status === "locating" ? (
          <div className="flow-state" role="status">
            <span className="loading-mark" aria-hidden="true" />
            <h2>현재 위치를 확인하고 있어요</h2>
            <p>잠시만 기다려 주세요.</p>
          </div>
        ) : null}

        {state.status === "choosing-area" ? (
          <div className="area-panel">
            <h2>지역으로 계속 찾기</h2>
            <p>{state.message}</p>
            {areasLoading ? <p role="status">지역을 불러오는 중…</p> : null}
            {areaError ? (
              <div className="inline-error" role="alert">
                <p>{areaError}</p>
                <button className="secondary-button" type="button" onClick={() => void loadAreas(state.message)}>지역 다시 불러오기</button>
              </div>
            ) : null}
            {!areasLoading && !areaError && areas.length ? (
              <div className="area-buttons" aria-label="추천 지역 선택">
                {areas.map((area) => (
                  <button type="button" key={area.id} onClick={() => chooseArea(area)}>
                    <strong>{area.name}</strong>
                    <span>{area.kind === "station" ? "역 주변" : area.kind === "neighborhood" ? "동네" : "지역"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {!areasLoading && !areaError && areas.length === 0 ? (
              <div className="empty-message">
                <p>선택할 수 있는 지역이 아직 없어요. 잠시 뒤 다시 시도해 주세요.</p>
                <button className="secondary-button" type="button" onClick={() => void loadAreas(state.message)}>지역 다시 불러오기</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.status === "loading" ? (
          <div className="flow-state" role="status">
            <span className="loading-mark" aria-hidden="true" />
            <h2>지금 갈 만한 곳을 고르는 중</h2>
            <p>검증 상태, 영업 여부, 거리와 취향을 함께 보고 있어요.</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="flow-state error-state" role="alert">
            <h2>추천을 불러오지 못했어요</h2>
            <p>{state.message}</p>
            <button className="primary-button" type="button" onClick={retryRecommendation}>다시 시도</button>
          </div>
        ) : null}

        {state.status === "results" ? (
          <div className="result-tools">
            <div className="result-actions">
              <button className="primary-button" type="button" onClick={retryRecommendation}>
                다시 골라줘
              </button>
              <button
                className="secondary-button"
                type="button"
                aria-expanded={preferencesOpen}
                aria-controls="preference-form"
                onClick={() => setPreferencesOpen((open) => !open)}
              >
                취향 추가
              </button>
            </div>

            {showPreferenceForm ? (
              <form className="preference-form" id="preference-form" onSubmit={submitPreferences}>
                <fieldset>
                  <legend>추천 순서</legend>
                  <div className="ranking-options">
                    {recommendationModes.map((option) => (
                      <label key={option.value}>
                        <input
                          type="radio"
                          name="recommendation-mode"
                          value={option.value}
                          checked={mode === option.value}
                          onChange={() => setMode(option.value)}
                        />
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend>빠른 취향</legend>
                  <div className="quick-preferences">
                    {quickPreferenceOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        aria-pressed={quickPreferences.includes(option.value)}
                        onClick={() => togglePreference(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="desired-bowl-label" htmlFor="desired-bowl">
                  원하는 한 그릇을 말해 주세요
                  <textarea
                    id="desired-bowl"
                    maxLength={500}
                    value={desiredBowl}
                    onChange={(event) => setDesiredBowl(event.target.value)}
                    placeholder="예: 오늘은 맑고 감칠맛 나는 쇼유 라멘이 먹고 싶어요"
                  />
                </label>
                <p className="privacy-note">입력한 문장은 추천에만 사용하며 분석 이벤트로 보내지 않아요.</p>
                <button className="primary-button" type="submit">이 취향으로 다시 찾기</button>
              </form>
            ) : null}
          </div>
        ) : null}

        {state.status === "results" ? (
          <div className="result-groups">
            <div className="results-summary" role="status">
              <strong>{resultCount(state.result)}곳을 찾았어요</strong>
              <span>검색 반경 {state.result.radiusKm}km · 모든 거리는 직선거리</span>
            </div>

            <section className="verified-results" aria-labelledby="verified-results-title">
              <div className="section-heading">
                <div>
                  <p>PUBLIC · VERIFIED</p>
                  <h2 id="verified-results-title">검증 완료 추천</h2>
                </div>
                <span>{state.result.verified.length}곳</span>
              </div>
              {state.result.verified.length ? (
                <div className="recommendation-grid">
                  {state.result.verified.slice(0, 3).map((item) => (
                    <RecommendationCard
                      key={item.branch.id}
                      item={item}
                      onDetail={(item) => onDetail(item, state.result, state.context)}
                      onDirections={(item) => onDirections(item, state.result, state.context)}
                    />
                  ))}
                </div>
              ) : (
                <p className="empty-message">이 반경에는 검증 완료 매장이 없어요.</p>
              )}
            </section>

            {state.result.candidates.length ? (
              <section className="candidate-results" aria-labelledby="candidate-results-title">
                <div className="section-heading">
                  <div>
                    <p>CHECK BEFORE VISIT</p>
                    <h2 id="candidate-results-title">검증 전 후보</h2>
                  </div>
                  <span>{state.result.candidates.length}곳</span>
                </div>
                <p className="candidate-notice">정보가 바뀌었을 수 있어 방문 전에 외부 지도에서 확인해 주세요.</p>
                <div className="recommendation-grid candidate-grid">
                  {state.result.candidates.map((item) => (
                    <RecommendationCard
                      key={item.branch.id}
                      item={item}
                      onDetail={(item) => onDetail(item, state.result, state.context)}
                      onDirections={(item) => onDirections(item, state.result, state.context)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {resultCount(state.result) === 0 ? (
              <div className="flow-state">
                <h2>아직 보여드릴 매장이 없어요</h2>
                <p>취향을 넓히거나 잠시 뒤 다시 찾아 주세요.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
