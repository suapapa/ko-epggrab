FROM golang:alpine AS builder

WORKDIR /app
COPY . .
RUN go build -o ko-epggrab

# ----

FROM python:3.11-alpine

ENV CH_PROVIDERS_CATEGORIES="NAVER:지상파"
ENV CH_NAME_FILETER="경인 KBS1,KBS2,MBC,SBS,EBS1,EBS2"

ENV CRON_CHANNEL_FETCH="0 0 * * 1"
ENV CRON_GENERATE_XMLTV="0 */12 * * *"
ENV EPG2XML_CHANNEL_CONF=/conf/epg2xml_channels.json
ENV EPG2XML_PROGRAM_CONF=/conf/epg2xml.json
ENV EPG2XML_XMLTV_OUTPUT=/conf/xmltv.xml
ENV EPGGRAB_SOCK_PATH=/epggrab/xmltv.sock

RUN apk --no-cache add ca-certificates git
RUN pip install --upgrade pip
RUN pip install git+https://github.com/epg2xml/epg2xml.git
RUN apk del git

RUN mkdir /conf

WORKDIR /app
COPY --from=builder /app/ko-epggrab .

# CMD ["/bin/sh"]
ENTRYPOINT ["/bin/sh", "-c", "./ko-epggrab -fc -pc \"$CH_PROVIDERS_CATEGORIES\" -nf \"$CH_NAME_FILETER\" -ss -d"]