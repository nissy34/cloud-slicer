package main

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OctoPrint's own timelapses (/api/timelapse), offered as the stand-in's "timelapse" folder.

type octoTimelapse struct {
	Name      string  `json:"name"`
	Bytes     int64   `json:"bytes"`
	Date      string  `json:"date"`
	Timestamp float64 `json:"timestamp"`
}

func (o *octoPrint) timelapses(ctx context.Context) ([]brandFile, error) {
	var v struct {
		Files []octoTimelapse `json:"files"`
	}
	if _, err := o.do(ctx, http.MethodGet, "/api/timelapse", nil, 0, "", &v); err != nil {
		return nil, err
	}
	out := []brandFile{}
	for _, f := range v.Files {
		if f.Name == "" || strings.Contains(f.Name, "/") {
			continue
		}
		at := f.Timestamp
		if at == 0 {
			// Older OctoPrint gives only its formatted date, in the printer computer's time.
			if t, err := time.ParseInLocation("2006-01-02 15:04", f.Date, time.Local); err == nil {
				at = float64(t.Unix())
			}
		}
		out = append(out, brandFile{Path: f.Name, Modified: at, Size: f.Bytes})
	}
	return out, nil
}

func (o *octoPrint) timelapseOpen(ctx context.Context, name, rangeHeader string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, o.base+"/downloads/timelapse/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	if o.key != "" {
		req.Header.Set("X-Api-Key", o.key)
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	return o.client.Do(req)
}

func (o *octoPrint) removeTimelapse(ctx context.Context, name string) error {
	_, err := o.do(ctx, http.MethodDelete, "/api/timelapse/"+url.PathEscape(name), nil, 0, "", nil)
	return err
}
