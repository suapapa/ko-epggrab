FROM golang:alpine AS builder

WORKDIR /app
COPY . .
RUN go build -o ko-epggrab

# ----

FROM python:3.11-alpine

# 채널 목록 갱신 주기
ENV CRON_CHANNEL_FETCH="0 0 * * 1"
# xmltv.xml의 생성 및 UDS 전송 주기
ENV CRON_GENERATE_XMLTV="0 */12 * * *"

# epg2xml 이 생성한 파일들을 보고 싶으면 /conf 에 마운트
ENV EPG2XML_CHANNEL_CONF=/conf/epg2xml_channels.json
ENV EPG2XML_PROGRAM_CONF=/conf/epg2xml.json
ENV EPG2XML_XMLTV_OUTPUT=/conf/xmltv.xml

# epggrab 소켓을 사용하기위해 tvheadend의 /conf/epggrab 을 /epggrab 에 마운트
ENV EPGGRAB_SOCK_PATH=/epggrab/xmltv.sock

RUN apk --no-cache add ca-certificates git
RUN pip install --upgrade pip
RUN pip install git+https://github.com/epg2xml/epg2xml.git
RUN apk del git

ENV TZ=Asia/Seoul
RUN apk --no-cache add tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone \
    apk del tzdata

RUN mkdir /conf

WORKDIR /app
COPY --from=builder /app/ko-epggrab .

#CMD ["/bin/sh", "-c", "./ko-epggrab -fc -pc \"$CH_PROVIDERS_CATEGORIES\" -nf \"$CH_NAME_FILETER\" -ss -d"]
ENTRYPOINT ["./ko-epggrab"]