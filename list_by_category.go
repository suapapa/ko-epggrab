package main

import (
	"os"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

func listupChannels(channels Channels) error {
	if len(channels) == 0 {
		return errors.New("no channels")
	}

	type EPGCategory struct {
		Name     string   `yaml:"name"`
		Channels []string `yaml:"channels"`
	}

	type EPGProvider struct {
		Name     string         `yaml:"name"`
		Category []*EPGCategory `yaml:"categories"`
	}

	type EPG struct {
		EPGProviders []*EPGProvider `yaml:"providers"`
	}

	epg := &EPG{}
	for ep, sr := range channels {
		epgProvider := &EPGProvider{
			Name: ep,
		}
		categories := make(map[string][]string)
		for _, ch := range sr.Channels {
			if _, ok := categories[ch.Category]; !ok {
				categories[ch.Category] = []string{}
			}
			categories[ch.Category] = append(categories[ch.Category], ch.Name)
		}
		for category, chs := range categories {
			epgCategory := &EPGCategory{
				Name:     category,
				Channels: chs,
			}
			epgProvider.Category = append(epgProvider.Category, epgCategory)
		}

		epg.EPGProviders = append(epg.EPGProviders, epgProvider)
	}

	yamlEnc := yaml.NewEncoder(os.Stdout)
	yamlEnc.SetIndent(2)
	if err := yamlEnc.Encode(epg); err != nil {
		return errors.Wrap(err, "fail to encode yaml")
	}

	return nil
}
