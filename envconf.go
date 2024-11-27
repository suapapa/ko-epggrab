package main

import "os"

var (
	epg2xmlChannelConf = "./epg2xml_conf/epg2xml_channels.json"
	epg2xmlProgramConf = "./epg2xml_conf/epg2xml.json"

	xmlTVXmlPath  = "./epggrab/xmltv.xml"
	xmlTVSockPath = "./epggrab/xmltv.sock"

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
	if v := os.Getenv("XMLTV_XML_PATH"); v != "" {
		xmlTVXmlPath = v
	}
	if v := os.Getenv("XMLTV_SOCK_PATH"); v != "" {
		xmlTVSockPath = v
	}
	if v := os.Getenv("CRON_CHANNEL_FETCH"); v != "" {
		cronChannelFetch = v
	}
	if v := os.Getenv("CRON_GENERATE_XMLTV"); v != "" {
		cronGenerateXMLTV = v
	}
}
