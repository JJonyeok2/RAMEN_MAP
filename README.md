# RAMEN MAP

검증 상태와 출처 근거를 함께 보여 주는 실데이터 라멘 탐색 웹앱입니다. 공개 화면은 정규화된 D1 데이터만 사용하며, 창작 매장이나 데모 fallback을 제공하지 않습니다.

## 두 가지 탐색 모드

- **배고파요 · 빨리 찾기 (`/nearby`)**: 현재 위치 또는 선택한 지역을 기준으로 3km, 10km, 30km 반경을 차례로 넓혀 지금 고를 세 곳을 찾습니다.
- **라멘 탐방 (`/explore`)**: 지역, 라멘 유형, 국물 스타일·베이스, 농도, 맵기, 자유 입력과 `취향 우선`·`균형 추천`·`가까운 곳 우선` 가중치를 조합합니다.

거리와 반경은 도로 경로나 이동 시간이 아닌 위·경도 사이의 직선거리입니다. 현재 위치는 사용자가 직접 요청할 때만 브라우저에서 읽으며 저장하지 않습니다. 위치 권한이 없거나 위치를 가져오지 못해도 지역을 선택해 계속할 수 있습니다.

현재 V1은 목록 중심으로 동작합니다. 지도 SDK나 지도 키 없이 공개 탐색, 추천, 상세 페이지를 사용할 수 있습니다. Kakao 지도는 향후 목록 결과를 보조할 어댑터로 연동할 예정이며, 현재 빌드에는 SDK 로더, 지도 fallback, 가짜 마커가 없습니다.

## 실데이터와 공개 상태

`drizzle/0000_real_shop_verification.sql`은 출처가 기록된 8개 수집 후보를 만들고, `drizzle/0001_normalize_ramen_domain.sql`은 이를 `shops`, `branches`, `menu_items`, `menu_profiles`, 영업시간, 출처 근거, 검증 이벤트, 지역, 제품 이벤트 테이블로 정규화합니다.

지점과 메뉴의 검증 상태는 다음과 같습니다.

- `verified`: 검증 완료
- `candidate`: 검증 후보
- `stale`: 재검증 필요
- `rejected`: 제외되며 공개 API에 노출되지 않음

지점 공개 상태는 `active`, `hidden`, `closed`, `moved`입니다. 공개 탐색에는 좌표가 있는 `active` 지점만 포함되고 `rejected` 지점·메뉴는 제외됩니다. 상세 화면은 저장된 출처와 확인일을 표시합니다. 검증 완료 상태는 지점 90일, 메뉴 180일이 지나면 응답에서 `stale`로 계산됩니다.

## 로컬 실행과 D1

Node.js 22.13 이상과 SQLite 3가 필요합니다.

```bash
npm install
npm run dev
```

Cloudflare 환경에는 D1 바인딩 이름 `DB`가 필요합니다. 새 데이터베이스에는 아래 순서로 두 마이그레이션을 적용합니다.

```bash
sqlite3 ramen-map.db ".read drizzle/0000_real_shop_verification.sql" ".read drizzle/0001_normalize_ramen_domain.sql"
```

공개 API는 `/api/v1/areas`, `/api/v1/recommendations`, `/api/v1/shops/[slug]`, `/api/v1/events`이며, 화면 경로는 `/`, `/nearby`, `/explore`, `/shops/[slug]`, `/admin`입니다.

## 비공개 관리자

`/admin`은 정규화된 지점·메뉴, 영업시간, 출처 근거와 검증 이력을 관리합니다. `/verify`는 편집기가 아니라 `/admin`으로 이동하는 호환 경로입니다. 서버 환경에 다음 값을 설정해야 로그인할 수 있습니다.

- `ADMIN_PASSWORD_HASH`: 운영자 비밀번호 UTF-8 값의 SHA-256 64자리 hex digest
- `ADMIN_SESSION_SECRET`: 관리자 세션 HMAC 서명용 비밀값

두 값이 없으면 관리자 인증은 닫힌 상태로 동작하며 관리자 API는 `503`을 반환합니다. 값이 있어도 유효한 HttpOnly 세션 쿠키가 없는 관리자 요청은 `401`입니다. 비밀값은 저장소나 `NEXT_PUBLIC_*` 변수에 넣지 마세요.

## 검증 명령

```bash
npm test          # 로직 테스트, 배포 빌드, SSR·마이그레이션·cutover 계약
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript 검사
npm run build     # Cloudflare/Vinext 배포 빌드
git diff --check  # 공백 오류 검사
```
