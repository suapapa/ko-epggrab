# AGENTS.md

이 문서는 AI 코딩 에이전트가 `ko-epggrab` 저장소에서 코드를 탐색, 수정, 검증할 때 참고해야 할 프로젝트 컨텍스트와 규칙을 정의합니다.

## 1. 프로젝트 개요

`ko-epggrab`은 한국의 다양한 EPG 제공사(NAVER, DAUM, KT, LG, SK, TVING, WAVVE, SPOTV, KBS, MBC, SBS)로부터 방송 편성표를 수집하는 Python 도구인 [`epg2xml`](https://github.com/epg2xml/epg2xml)을 래핑(Wrapping)한 Go 기반 자동화 데몬입니다.

- **핵심 역할**:
  1. `epg2xml`의 전체 채널 목록(`epg2xml_channels.json`) 주기적 갱신
  2. 사용자가 선택한 채널 목록을 바탕으로 `epg2xml.json` 설정 파일 생성
  3. 주기적으로 `epg2xml run`을 호출하여 `xmltv.xml` 생성
  4. 생성된 `xmltv.xml`을 Tvheadend의 XMLTV Unix Domain Socket(`xmltv.sock`)으로 전송
- **향후 개편 방향 ([`DESIGN.md`](file:///Users/suapapa/ws_suapapa/ko-epggrab/DESIGN.md) 참고)**:
  - 기존의 CLI 플래그(`-fc`, `-lc`, `-pc`, `-nf`, `-ss`, `-d`) 설정 방식을 폐기하고, 내장 웹 서버 및 웹 UI(`//go:embed`)를 통해 런타임에 채널 선택, 스케줄, 옵션을 변경하고 수동 실행/모니터링할 수 있는 구조로 전환합니다.

---

## 2. 기술 스택 및 환경

- **언어**: Go (`go.mod` 기준 Go 1.27)
- **런타임 외부 의존성**: Python 3.11+ 및 `epg2xml` CLI (`PATH`에 `epg2xml` 실행 파일이 존재해야 함)
- **주요 패키지**:
  - `github.com/robfig/cron/v3`: 채널 목록 갱신 및 XMLTV 생성 주기 스케줄링
  - `github.com/pkg/errors`: 에러 래핑
  - `gopkg.in/yaml.v3`: YAML 직렬화
- **컨테이너 & CI/CD**:
  - [`Dockerfile`](file:///Users/suapapa/ws_suapapa/ko-epggrab/Dockerfile): `golang:alpine`에서 정적 바이너리를 빌드한 뒤 `python:3.11-alpine`(+ `epg2xml`, `Asia/Seoul` 타임존) 이미지로 복사하는 멀티스테이지 빌드
  - [`.github/workflows/docker-image.yml`](file:///Users/suapapa/ws_suapapa/ko-epggrab/.github/workflows/docker-image.yml): `v*.*.*` 태그 푸시 시 `linux/amd64`, `linux/arm64` 멀티 아키텍처 이미지를 빌드하여 `ghcr.io/suapapa/ko-epggrab`에 배포

---

## 3. 디렉터리 및 파일 구조

- [`main.go`](file:///Users/suapapa/ws_suapapa/ko-epggrab/main.go): 애플리케이션 엔트리포인트, Cron 스케줄러 등록, Unix Domain Socket(`sendXMLTV2Socket`) 전송 로직
- [`envconf.go`](file:///Users/suapapa/ws_suapapa/ko-epggrab/envconf.go): 환경 변수(`EPG2XML_CHANNEL_CONF`, `EPG2XML_PROGRAM_CONF`, `XMLTV_XML_PATH`, `XMLTV_SOCK_PATH`, `CRON_CHANNEL_FETCH`, `CRON_GENERATE_XMLTV`) 로드 및 기본값 정의
- [`epg2xml.go`](file:///Users/suapapa/ws_suapapa/ko-epggrab/epg2xml.go): `epg2xml.json` 및 `epg2xml_channels.json` 데이터 모델(`EPG2XMLGlobalConfig`, `ChannelSearchResult`, `Channel`) 정의, JSON 읽기/쓰기, `epg2xml` CLI 실행(`runEPG2XML`)
- [`fileter.go`](file:///Users/suapapa/ws_suapapa/ko-epggrab/fileter.go): 쉼표 구분 채널 이름 필터 헬퍼 (웹 UI 전환 시 폐기 예정)
- [`list_by_category.go`](file:///Users/suapapa/ws_suapapa/ko-epggrab/list_by_category.go): 프로바이더 및 카테고리별 채널 목록 YAML 출력 헬퍼 (웹 UI 전환 시 폐기 예정)
- [`DESIGN.md`](file:///Users/suapapa/ws_suapapa/ko-epggrab/DESIGN.md): 런타임 웹 설정 UI 개편 기획 및 백엔드/시스템 상세 설계서
- [`DESIGN_UI.md`](file:///Users/suapapa/ws_suapapa/ko-epggrab/DESIGN_UI.md): 웹 UI 디자인 시스템, 레이아웃 와이어프레임, 컴포넌트 및 프론트엔드 인터랙션 상세 설계서
- [`example_docker-compose.yml`](file:///Users/suapapa/ws_suapapa/ko-epggrab/example_docker-compose.yml): Tvheadend와 Docker Named Volume(`epggrab_data`)을 통해 `xmltv.sock`을 공유하는 배포 예제

---

## 4. 빌드, 실행 및 검증 방법

### 로컬 개발 환경 설정
`epg2xml` 실행이 필요한 통합 테스트 시 Python 가상환경을 구성합니다:
```sh
python3 -m venv .venv
source .venv/bin/activate
pip install git+https://github.com/epg2xml/epg2xml.git
```

### Go 빌드 및 정적 검사
코드를 수정한 후에는 항상 아래 명령어로 컴파일 및 정적 검사를 수행하세요:
```sh
go vet ./...
go test ./...
go build -o ko-epggrab
```

### Docker 이미지 빌드 테스트
```sh
docker build -t ko-epggrab:local .
```

---

## 5. 핵심 도메인 규칙 및 개발 시 주의사항 (Gotchas)

1. **`epg2xml` CLI 동작 특성**:
   - **채널 목록 갱신(`update_channels`)**: `epg2xml update_channels`는 `--channelfile`(`epg2xml_channels.json`)이 이미 존재하면 갱신하지 않고 종료합니다. 따라서 갱신 전 반드시 기존 채널 파일을 삭제(`os.Remove`)해야 합니다.
   - **설정 파일 재포맷**: `epg2xml`은 `epg2xml.json`을 읽을 때 자체 스키마에 맞지 않는 임의의 키를 제거하거나 재포맷할 수 있습니다. 따라서 `ko-epggrab` 고유 설정(Cron 주기, 소켓 전송 여부 등)은 별도 설정 파일(`ko-epggrab.json`)에 저장하고, `epg2xml.json`은 실행 직전에 생성하는 산출물로 다루어야 합니다.
2. **채널 데이터 스키마 (`epg2xml_channels.json`)**:
   - `ServiceId` 필드는 프로바이더에 따라 문자열(`"814574"`, `"C00551"`)일 수도 있고 정수(`9`)일 수도 있으므로 `any` 타입을 유지해야 합니다.
   - `WAVVE`, `SPOTV` 등 일부 프로바이더의 채널은 `Category` 필드가 아예 없거나 빈 문자열(`""`)일 수 있으므로, 빈 카테고리도 UI 및 필터 로직에서 정상 처리(`미분류` 등)되어야 합니다.
   - `TVING`, `WAVVE`, `SPOTV`, `KBS` 등의 채널에는 `Icon_url` 필드가 포함됩니다. `Channel` 구조체 직렬화/역직렬화 시 해당 필드가 유실되지 않도록 보존해야 합니다.
3. **동시성 제어 (Concurrency)**:
   - Cron 스케줄러나 웹 API 수동 트리거를 통해 `epg2xml update_channels`와 `epg2xml run`이 동시에 실행되면 설정 파일 및 채널 파일이 손상될 수 있습니다. 모든 `epg2xml` 실행 작업은 단일 뮤텍스로 직렬화하고, 런타임 설정 읽기와 쓰기는 `sync.RWMutex`로 보호해야 합니다.
4. **Tvheadend Unix Domain Socket (`xmltv.sock`) 공유**:
   - `xmltv.sock`은 네트워크 소켓이 아닌 파일시스템 상의 Unix Domain Socket입니다. 컨테이너 환경에서는 Tvheadend의 `/config/epggrab`과 `ko-epggrab`의 `/epggrab`이 동일한 Docker 볼륨을 마운트하여 공유합니다.
   - Tvheadend 컨테이너가 아직 준비되지 않았거나 소켓이 열리지 않은 경우에도 `ko-epggrab` 데몬이나 웹 서버 전체가 죽지(`log.Fatal`) 않도록 에러를 로깅 및 상태에 기록하고 복구 가능하게 처리해야 합니다.
5. **단일 바이너리 패키징**:
   - 웹 UI(HTML/CSS/JS)는 외부 빌드 체인이나 Node.js 런타임에 의존하지 않고 Go 표준 라이브러리의 `embed` 패키지(`//go:embed`)를 사용해 바이너리에 내장합니다.
6. **Git 관리 주의사항**:
   - 로컬 실행 시 생성되는 `epg2xml_conf/`, `*.xml`, `*.sock`, `/ko-epggrab` 바이너리, `.venv/` 등은 커밋하지 않습니다 ([`.gitignore`](file:///Users/suapapa/ws_suapapa/ko-epggrab/.gitignore) 참고).
