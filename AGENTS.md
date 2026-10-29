# AGENTS.md

이 문서는 AI 코딩 에이전트가 `ko-epggrab` 저장소에서 코드를 탐색, 수정, 검증할 때 참고해야 할 프로젝트 컨텍스트와 규칙을 정의합니다.

## 1. 프로젝트 개요

`ko-epggrab`은 한국의 다양한 EPG 제공사(NAVER, DAUM, KT, LG, SK, TVING, WAVVE, SPOTV, KBS, MBC, SBS)로부터 방송 편성표를 수집하는 Python 도구인 [`epg2xml`](https://github.com/epg2xml/epg2xml)을 래핑한 Go 기반 자동화 데몬입니다.

- **핵심 역할**:
  1. `epg2xml`의 전체 채널 목록(`epg2xml_channels.json`) 주기적 갱신
  2. 사용자가 선택한 채널 목록을 바탕으로 `epg2xml.json` 설정 파일 생성
  3. 주기적으로 `epg2xml run`을 호출하여 `xmltv.xml` 생성
  4. 생성된 `xmltv.xml`을 Tvheadend의 XMLTV Unix Domain Socket(`xmltv.sock`)으로 전송
  5. 내장 웹 UI(`//go:embed web`)로 런타임 채널 선택·스케줄·옵션 변경 및 수동 실행/로그 확인

상세 설계: [`DESIGN.md`](DESIGN.md), [`DESIGN_UI.md`](DESIGN_UI.md)

---

## 2. 기술 스택 및 환경

- **언어**: Go (`go.mod` 기준 Go 1.27)
- **런타임 외부 의존성**: Python 3.11+ 및 `epg2xml` CLI (`PATH`에 `epg2xml` 실행 파일이 존재해야 함)
- **주요 패키지**:
  - `github.com/robfig/cron/v3`: 채널 목록 갱신 및 XMLTV 생성 주기 스케줄링
  - `github.com/pkg/errors`: 에러 래핑
- **프론트엔드**: Vanilla HTML/CSS/ES6 (`web/`), Node 빌드 없음, `//go:embed`
- **컨테이너 & CI/CD**:
  - [`Dockerfile`](Dockerfile): `golang:alpine`에서 정적 바이너리를 빌드한 뒤 `python:3.11-alpine`(+ `epg2xml`, `Asia/Seoul` 타임존) 이미지로 복사
  - [`.github/workflows/docker-image.yml`](.github/workflows/docker-image.yml): `v*.*.*` 태그 푸시 시 multi-arch 이미지를 `ghcr.io/suapapa/ko-epggrab`에 배포

---

## 3. 디렉터리 및 파일 구조

- [`main.go`](main.go): 데몬 엔트리포인트 — Config / Scheduler / HTTP 서버 기동
- [`config.go`](config.go): 환경 변수 경로 로드, `ko-epggrab.json` 로드/저장/마이그레이션, `sync.RWMutex`
- [`epg2xml.go`](epg2xml.go): 채널/`epg2xml` 데이터 모델, CLI 실행, 메타데이터 동기화 후 `epg2xml.json` 생성
- [`scheduler.go`](scheduler.go): Cron 동적 재등록, 작업 상태, 로그 링 버퍼, 소켓 전송
- [`server.go`](server.go): REST API + `embed` 정적 파일 서빙 + `/xmltv.xml`
- [`web/`](web/): `index.html`, `style.css`, `app.js`
- [`example_docker-compose.yml`](example_docker-compose.yml): Tvheadend + 웹 UI 포트/`/conf` 볼륨 예제

---

## 4. 빌드, 실행 및 검증 방법

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install git+https://github.com/epg2xml/epg2xml.git

go vet ./...
go test ./...
go build -o ko-epggrab
./ko-epggrab   # http://localhost:8080
```

Docker:
```sh
docker build -t ko-epggrab:local .
```

---

## 5. 핵심 도메인 규칙 (Gotchas)

1. **`epg2xml` CLI**:
   - `update_channels`는 채널 파일이 있으면 갱신하지 않음 → 갱신 전 `os.Remove` 필수
   - `epg2xml`은 `epg2xml.json`을 재포맷할 수 있음 → 고유 설정은 `ko-epggrab.json`에만 보관하고 실행 직전에 `epg2xml.json` 생성
2. **채널 스키마**:
   - `ServiceId`는 string 또는 number → `any` 유지, 비교 시 문자열화
   - 빈 `Category`는 UI에서 `미분류`로 처리
   - `Icon_url`, `Id` 필드 보존
3. **동시성**:
   - 모든 `epg2xml` 작업은 단일 워커 뮤텍스로 직렬화
   - 설정 읽기/쓰기는 `sync.RWMutex`
4. **UDS**:
   - Tvheadend `/config/epggrab` ↔ ko-epggrab `/epggrab` 동일 볼륨
   - 소켓 미존재 시에도 데몬/웹 서버는 계속 동작 (에러는 로그·상태에 기록)
5. **웹 자산**:
   - `web/`은 반드시 `//go:embed`로 바이너리에 포함. 외부 번들러 금지
6. **Git**:
   - `epg2xml_conf/`, `*.xml`, `*.sock`, 바이너리, `.venv/` 등은 커밋하지 않음
