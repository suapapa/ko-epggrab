FROM golang:alpine AS builder

WORKDIR /app
COPY . .
RUN go build -o ko-epggrab

# ----

FROM python:3.11-alpine

# 웹 UI / API
ENV HTTP_ADDR=:8080

# 최초 ko-epggrab.json 생성 시 seed 값 (이후에는 웹 UI에서 변경)
ENV CRON_CHANNEL_FETCH="0 0 * * 1"
ENV CRON_GENERATE_XMLTV="0 */12 * * *"

# 설정 / 채널 / 프로그램 conf
ENV KO_EPGGRAB_CONF=/conf/ko-epggrab.json
ENV EPG2XML_CHANNEL_CONF=/conf/epg2xml_channels.json
ENV EPG2XML_PROGRAM_CONF=/conf/epg2xml.json

# tvheadend의 /config/epggrab 과 같은 volume을 /epggrab 에 마운트해 xmltv.sock 공유
ENV XMLTV_XML_PATH=/epggrab/xmltv.xml
ENV XMLTV_SOCK_PATH=/epggrab/xmltv.sock

RUN apk --no-cache add ca-certificates git
RUN pip install --upgrade pip
RUN pip install git+https://github.com/epg2xml/epg2xml.git
RUN apk del git

ENV TZ=Asia/Seoul
RUN apk --no-cache add tzdata && \
    cp /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    apk del tzdata

RUN mkdir /conf

WORKDIR /app
COPY --from=builder /app/ko-epggrab .

EXPOSE 8080
ENTRYPOINT ["./ko-epggrab"]
