package main

import "strings"

// "KBS,MBC" -> {"KBS":true, "MBC":true}
func makeAllowFilter(filterStr string) map[string]bool {
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

// "KBS,MBC" -> {"KBS":false, "MBC":false}
func makeDenyFilter(filterStr string) map[string]bool {
	fs := strings.Split(filterStr, ",")
	if len(fs) == 0 {
		return nil
	}
	channelNameFilter := make(map[string]bool)
	for _, name := range fs {
		channelNameFilter[name] = false
	}
	return channelNameFilter
}
