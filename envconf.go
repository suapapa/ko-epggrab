package main

import "os"

var (
	epg2xmlChannelConf = "./epg2xml_conf/epg2xml_channels.json"
	epg2xmlProgramConf = "./epg2xml_conf/epg2xml.json"
	epg2xmlXMLTVOutput = "./epg2xml_conf/xmltv.xml"

	epgGrabSockPath = "./epggrab/xmltv.sock"

	cronChannelFetch  = "0 0 * * 1"    // Every Monday at 00:00
	cronGenerateXMLTV = "0 */12 * * *" // Every 12 hours
)

func init() {
	setConfs()
}

func setConfs() {
	if v := os.Getenv("EPG2XML_CHANNEL_CONF"); v != "" {
		epg2xmlChannelConf = v
	}
	if v := os.Getenv("EPG2XML_PROGRAM_CONF"); v != "" {
		epg2xmlProgramConf = v
	}
	if v := os.Getenv("EPG2XML_XMLTV_OUTPUT"); v != "" {
		epg2xmlXMLTVOutput = v
	}
	if v := os.Getenv("EPGGRAB_SOCK_PATH"); v != "" {
		epgGrabSockPath = v
	}
	if v := os.Getenv("CRON_CHANNEL_FETCH"); v != "" {
		cronChannelFetch = v
	}
	if v := os.Getenv("CRON_GENERATE_XMLTV"); v != "" {
		cronGenerateXMLTV = v
	}
}
