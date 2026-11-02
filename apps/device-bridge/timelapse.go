package main

// Timelapse videos: the Device tab lists them (server.files.list on the
// printer's timelapse folder), fetches them in Range pieces through the page
// link (channel "page" on the shared direct link, or bridge.page_fetch) and may delete them. Klipper
// printers with the moonraker-timelapse add-on keep them in Moonraker's
// "timelapse" folder; the Snapmaker U1 keeps its own in "camera"; a stand-in
// (OctoPrint) offers its timelapses as a "timelapse" folder too. Only video
// and picture files in those folders can be reached, never anything else of Moonraker's.

import (
	"context"
	"net/http"
	"path"
	"strings"
)

var timelapseRoots = []string{"timelapse", "camera"}

var timelapseExts = []string{".mp4", ".webm", ".mkv", ".mov", ".avi", ".jpg", ".jpeg", ".png"}

// timelapseRel checks a file path inside Moonraker's folders ("timelapse/a.mp4")
// and gives it cleaned, or "" when it is not a timelapse video or picture.
func timelapseRel(p string) string {
	p = strings.TrimLeft(p, "/")
	if p == "" || strings.Contains(p, "\\") || strings.Contains(p, "\x00") {
		return ""
	}
	for _, part := range strings.Split(p, "/") {
		if part == ".." || part == "." || part == "" {
			return ""
		}
	}
	clean := path.Clean(p)
	root, rest, ok := strings.Cut(clean, "/")
	if !ok || rest == "" {
		return ""
	}
	known := false
	for _, r := range timelapseRoots {
		known = known || r == root
	}
	if !known {
		return ""
	}
	ext := strings.ToLower(path.Ext(rest))
	for _, e := range timelapseExts {
		if e == ext {
			return clean
		}
	}
	return ""
}

// timelapsePath is the Moonraker address of a timelapse file a page link asked
// for ("/server/files/timelapse/a.mp4"), or "" for any other address.
func timelapsePath(raw string) string {
	if strings.ContainsAny(raw, "?#") {
		raw = raw[:strings.IndexAny(raw, "?#")]
	}
	const prefix = "/server/files/"
	if !strings.HasPrefix(raw, prefix) {
		return ""
	}
	if rel := timelapseRel(strings.TrimPrefix(raw, prefix)); rel != "" {
		return prefix + rel
	}
	return ""
}

// timelapser is a brand that keeps timelapse videos the stand-in offers as its "timelapse" folder.
type timelapser interface {
	timelapses(ctx context.Context) ([]brandFile, error)
	// timelapseOpen fetches one video, passing on the browser's Range.
	timelapseOpen(ctx context.Context, name, rangeHeader string) (*http.Response, error)
	removeTimelapse(ctx context.Context, name string) error
}
