package main

import "strings"

// "KBS,MBC" -> {"KBS":true, "MBC":true}
func setChannelNameFilter(filterStr string) map[string]bool {
	if filterStr == "" {
		return nil
	}
	fs := strings.Split(filterStr, ",")
	if len(fs) == 0 {
		return nil
	}
	channelNameFilter := make(map[string]bool)
	for _, name := range fs {
		channelNameFilter[name] = true
	}
	return channelNameFilter
}
