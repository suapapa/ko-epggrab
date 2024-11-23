# ko-epggrab

[한국의 EPG](https://namu.wiki/w/%EC%A0%84%EC%9E%90%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8%20%EC%95%88%EB%82%B4#s-2)는
부실하게 관리되고 있음. 일 예로, tvheadend에서 지상파의 OTA EPG를 사용하려 하면 느린 속도와 부족한 정보에 울화통이 터짐.

여러 업체(웹 포털, IPTV 프로바이더)에서 자체적으로 EPG를 웹에서 제공하고 있음.
[epg2xml](https://github.com/epg2xml/epg2xml) 프로젝트에서 웹상의 epg들을 크롤링? 하여
epggrab 에서 사용하는 `xmltv.xml`를 만들어 tvheadend에 unix domain socket을 통해 주입할 수 있음.

이 프로그램, ko-epggrab 은 `xmltv.xml`파일을 만들 때 수동으로 채널 목록을 json 설정 파일, `epg2xml.json`
에 채워 넣는 과정을 조금이나마 단순화 하기 위해 만들어짐.

- EPG프로바이더, 카테고리별 선택
- 채널 이름의 allow list 필터링
- 주기적인 채널 목록 갱신 (기본값: 1주일에 한 번)
- 주기적인 EPG 생성 및 푸시 (기본값: 12시간마다)

Docker-Compose 로 tvheadend와 함께 사용하는 예제:
```yaml
services:
  tvheadend:
    image: lscr.io/linuxserver/tvheadend:latest
    container_name: tvheadend
    environment:
      - PUID=0
      - PGID=0
      - TZ=Asia/Seoul
    volumes:
      - /system/tvheadend/config:/config # tvheadend의 설정 디렉터리
      - /data/recording/tvheadend:/recordings
    network_mode: "host"
    devices:
      - /dev/dri:/dev/dri
    restart: unless-stopped
  ko-epggrab:
    image: suapapa/ko-epggrab:main
    container_name: ko-epggrab
    environment:
      - ENV CH_PROVIDERS_CATEGORIES="NAVER:지상파" # EPG 제공업체와 카테고리를 나열
      - ENV CH_NAME_FILETER="경인 KBS1,KBS2,MBC,SBS,EBS1,EBS2" # 위의 채널 목록에서 선택할 whitelist 나열 (없으면 전체선택)
    volumes:
      - /system/tvheadend/config/epggrab:/epggrab # tvheadend 에서 마운트한 설정디레터리와 base가 같아야 서로 통신 가능
    restart: unless-stopped
```

## 개발 방법

epg2xml 설치:
```sh
python -m venv .venv
source .venv/bin/activate
pip install git+https://github.com/epg2xml/epg2xml.git
```

ko-epggrab 빌드:
```sh
go build
```

실행:
```sh
./epg2xml -h
```