# ko-epggrab 웹 UI 상세 설계서 (DESIGN_UI.md)

이 문서는 [`DESIGN.md`](DESIGN.md)에서 정의한 런타임 설정 웹 서버의 **프론트엔드 UI/UX, 화면 레이아웃, 컴포넌트 동작, 디자인 시스템, 상태 관리 구조**를 상세히 정의합니다.

> 구현 자산: `web/index.html`, `web/style.css`, `web/app.js` (`//go:embed`)

---

## 1. 디자인 방향성 및 프론트엔드 아키텍처

### 1.1 컨셉: "Broadcast Control Console"
- **목적 중심의 유틸리티 대시보드**: 마케팅형 랜딩이 아니라, **약 2,300개 채널 탐색·선택**, **Cron/옵션 설정**, **실행 상태·로그 확인**을 한 화면에서 빠르게 끝내는 방송 송출 제어 콘솔.
- **쓰기 좋음 우선**: 채널 선택 워크스페이스에 세로 공간을 최대로 확보하고(상태 카드 접기), 체크 시 전체 테이블을 다시 그리지 않으며, 단축키·일괄 선택·선택만 보기로 반복 작업을 줄인다.
- **보기 좋음**: Soft Structuralism + Data-Dense Dashboard — nested bezel(외곽 쉘 + 내부 코어), floating island topbar, 앰버 시그널 액센트, SVG 아이콘(이모지 금지), 커스텀 스위치/세그먼트 컨트롤.
- **타이포**:
  - UI/채널명: `Pretendard Variable` (+ `Apple SD Gothic Neo`, `Noto Sans KR`)
  - 데이터(`No`, `ServiceId`, Cron, 경로, 로그): `JetBrains Mono` + `tabular-nums`

### 1.2 Zero-Build 단일 바이너리
```text
web/
├── index.html
├── style.css
└── app.js
```
외부 번들러 없음. 폰트는 CDN, 아이콘은 인라인 SVG.

---

## 2. 디자인 토큰

서버 도구(Proxmox / Tailscale / Tvheadend) 옆에 두기 편한 **깊은 Zinc 다크** + **방송 시그널 앰버**.

| 역할 | CSS 변수 | 값 | 용도 |
| :--- | :--- | :--- | :--- |
| Base | `--bg-base` | `#070709` | 페이지·로그 터미널 |
| Raised | `--bg-raised` | `#0e0e12` | topbar / 테이블 쉘 |
| Surface | `--bg-surface` | `#141419` | 카드·패널 코어 |
| Elevated | `--bg-elevated` | `#1b1b22` | 입력·호버 |
| Ink | `--ink` | `#f4f4f5` | 본문·채널명 |
| Ink soft / mute / faint | `--ink-soft` … | `#c4c4cc` / `#8b8b96` / `#5c5c68` | 보조·라벨·메타 |
| Line | `--line` / `--line-strong` | `rgba(255,255,255,.06/.10)` | 구분 (톤 스텝 우선, 선은 약하게) |
| Accent | `--accent` | `#f5a524` | 활성 탭·선택·CTA |
| Accent ink | `--accent-ink` | `#140f05` | 앰버 위 글자 |
| OK / Busy / Err | `--ok` / `--busy` / `--err` | `#34d399` / `#60a5fa` / `#f87171` | 상태 |

모션 토큰: `--ease: cubic-bezier(0.32, 0.72, 0, 1)`, `--dur: 220ms`. `prefers-reduced-motion: reduce` 시 애니메이션 축소.

컴포넌트 기하: `--radius-shell: 22px`, `--radius-core: 16px`, `--radius-ctrl: 12px`, pill CTA. 터치 타깃 최소 **44×44px**. 포커스 링 `--focus` (앰버, 2px+offset).

---

## 3. 전체 레이아웃

```text
+----------------------------------------------------------------------------------+
|  (floating island topbar)                                                        |
|  [TV] ko-epggrab  Broadcast Control  [● 대기 중]                                 |
|       ( 채널 선택 [18] | 스케줄 · 설정 | 실행 로그 )   [채널 DB 갱신] [XMLTV 생성] |
+----------------------------------------------------------------------------------+
|  KPI strip (접기/펼치기)                                                          |
|  [ DB 11·2264 ] [ 선택 18 · NAVER 6 KT 12 ] [ XMLTV 1.4MB ] [ 소켓 ON·연결 ]     |
|                                                         [요약 접기 ▴]             |
+----------------------------------------------------------------------------------+
|  [채널 워크스페이스 — 필터 sticky / 테이블 스크롤]                                  |
|  +----------------+ +----------------------------------------------------------+ |
|  | 프로바이더      | | 🔍 검색  (/)          [선택만 보기 ○]                      | |
|  | 전체  18/2264  | | 카테고리 chips (개수 포함)                                 | |
|  | NAVER  6/472 ● | | 표시 N · 이 목록 n개 선택됨   [전체선택] [해제]            | |
|  | KT    12/309 ● | +----------------------------------------------------------+ |
|  | …              | | [☑] 아이콘 | 채널명 | 번호 | 제공사 | 카테고리 | ServiceId | |
|  +----------------+ +----------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
|  (dirty bar, 변경 시에만)  14 → 18개   [되돌리기] [설정만 저장] [저장 후 즉시 생성] |
+----------------------------------------------------------------------------------+
```

---

## 4. 화면별 명세

### 4.1 Topbar & KPI

**Topbar (sticky floating island)**
- 브랜드 마크(SVG TV) + `ko-epggrab` + 서브라벨 `Broadcast Control`
- Status badge (`role="status"` `aria-live="polite"`):
  - `idle` → OK 톤 + `대기 중`
  - `fetching_channels` → Busy + `채널 DB 갱신 중...`
  - `generating_xmltv` → Busy/Accent + `XMLTV 생성 및 전송 중...`
- 탭 레일: 활성 탭은 **앰버 fill** (글자는 accent-ink). 채널 탭에 선택 수 배지.
- 액션: 보조 `채널 DB 갱신`, 주 CTA `XMLTV 생성` (아이콘+라벨). busy 시 disabled + 로딩 스피너.

**KPI strip (4카드, nested bezel)**
- 좌측 tone strip: DB=blue, 선택=amber, XMLTV=violet, 소켓=green
- **선택된 채널** 카드: 클릭/Enter/Space → 채널 탭 + `선택만 보기` ON
- XMLTV: 용량·상대시각 + 다운로드 / URL 복사
- 소켓: ON/OFF · 파일 존재 · 마지막 전송 결과
- **요약 접기**: 채널 작업 공간 확보. 접힘 상태는 `localStorage`에 유지. 접힌 동안 topbar status badge와 선택 수 배지로 최소 상태 유지.

### 4.2 채널 선택

**(1) 프로바이더 네비**
- 고정 순서: 전체 → KT LG SK DAUM NAVER TVING WAVVE SPOTV KBS MBC SBS (+ 미등록 제공사)
- 배지 `선택/전체`. 선택>0이면 accent. 활성 항목 accent soft 배경.
- 기본 활성: **선택 채널이 있는 첫 제공사**, 없으면 목록 첫 제공사 (`전체` 아님 — 초기 DOM 부담 완화).

**(2) 필터 바 (채널 패널 상단 sticky)**
- 검색: Name / No / ServiceId, 150ms debounce. `/` 포커스, `Esc` 초기화.
- `선택만 보기` 커스텀 스위치 + 선택 수.
- 카테고리 칩: `전체` + 고유 Category. 빈 Category → `미분류`. 칩에 **해당 필터 채널 수** 표시. `aria-pressed`.
- 일괄: **현재 목록 전체 선택** / **전체 해제**. 헤더 체크박스는 현재 필터 결과에 대해 checked / indeterminate / unchecked.

**(3) 테이블**
- 행 클릭 토글, `Shift+클릭` 범위 선택.
- 아이콘 28×28 lazy + onerror fallback(제공사 약자).
- 데스크톱 컬럼: 체크 · 아이콘 · 채널명 · 번호 · 제공사 · 카테고리 · ServiceId
- 모바일: ServiceId/카테고리/제공사 → 채널명 하단 메타 한 줄.
- **부분 갱신**: 단일/범위 토글 시 해당 `tr`의 `.is-selected`·checkbox만 갱신하고, 프로바이더 배지·dirty bar·KPI 선택 요약만 다시 그림. 필터 변경 시에만 테이블 full render.

**(4) Dirty bar**
- `isDirty`일 때만 slide-up. `되돌리기` / `설정만 저장` / `저장 후 즉시 생성` (`?trigger=generate`).

### 4.3 스케줄 · 설정
- 2열(모바일 1열): 스케줄·UDS | epg2xml GLOBAL
- Cron 입력 + 프리셋 칩 + **다음 실행** 시각(서버 status)
- UDS 전송: 커스텀 스위치 + 경로 힌트(읽기 전용)
- FETCH_LIMIT 세그먼트, ID_FORMAT(+기본값), HTTP_PROXY, 메타데이터 옵션 그리드
- 하단 인프라 경로 박스 + `설정 저장` / `저장 후 생성`

### 4.4 실행 로그
- 메타: 작업 종류 · 시작 · 소요 · 성공/실패
- Follow 스위치 · 복사 · 새로고침
- 터미널 뷰: mono, 에러 패턴 하이라이트 (`[ERROR]`, `fail`, `Traceback` …)
- 토스트 문구는 이모지 없이 plain text

---

## 5. 인터랙션 · 성능 · a11y

### 5.1 Channel key
`${provider}::${String(serviceId)}`

### 5.2 성능
1. 기본 제공사 스코프로 행 수 제한
2. 검색 150ms debounce
3. 선택 토글 부분 DOM 갱신
4. `전체` + 검색 없음일 때도 DocumentFragment 일괄 삽입; 필요 시 향후 가상 스크롤 여지

### 5.3 폴링
- idle: `/api/status` 10s
- busy / 수동 실행 직후: status+logs 1.5s
- idle 복귀 시: fetch면 channels 재로드, 토스트, 폴링 10s 복귀

### 5.4 단축키
| 키 | 동작 |
| :--- | :--- |
| `/` | 검색 포커스 (입력 중 제외) |
| `Esc` | 검색어 지우기 / 블러 |
| `1` `2` `3` | 채널 / 설정 / 로그 탭 (입력 중 제외) |

### 5.5 로컬 UI 상태 (`localStorage`)
- `kpi-collapsed`, `selected-only`, (선택) 마지막 활성 제공사 — **서버 설정과 무관한 뷰 선호만** 저장

### 5.6 Empty / 가드
- 채널 DB 없음 → 안내 패널 + 갱신 유도 (이모지 없는 카피)
- 선택 0개에서 XMLTV 생성 → 토스트로 차단
- dirty 상태에서 생성 버튼 → 저장 유도

### 5.7 반응형
| 구간 | 동작 |
| :--- | :--- |
| ≥ 1100px | KPI 4열, 제공사 240px + 테이블 |
| < 1100px | KPI 2열, 제공사 가로 스크롤, 테이블 컬럼 축약 |
| < 560px | KPI 2열 컴팩트(액션 링크 숨김), topbar 스택 |
| < 380px | KPI 1열 |

---

## 6. 구현 체크리스트 (쓰기·보기)

- [x] Floating island topbar + SVG 액션
- [x] Nested bezel KPI / 패널
- [x] 커스텀 스위치 · 세그먼트 · accent 탭
- [x] KPI 접기/펼치기 + localStorage
- [x] 테이블 헤더 전체선택(indeterminate)
- [x] 선택 토글 부분 DOM 갱신
- [x] 카테고리 칩 채널 수
- [x] 필터 바 sticky
- [x] 탭 단축키 1/2/3
- [x] 토스트/빈상태 이모지 제거 문구 정리
