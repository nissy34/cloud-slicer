package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"reflect"
	"testing"
)

func TestCameraCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/camera-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name   string   `json:"name"`
			Chosen []string `json:"chosen"`
			Names  []string `json:"names"`
			Want   []string `json:"want"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	for _, c := range file.Cases {
		got := cameraList(c.Chosen, c.Names)
		if len(got) == 0 && len(c.Want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.Want) {
			t.Errorf("%s: got %v, want %v", c.Name, got, c.Want)
		}
	}
}

func pngOf(w, h int, c color.Color) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestJoinPictures(t *testing.T) {
	red, green, blue := pngOf(320, 240, color.RGBA{255, 0, 0, 255}), pngOf(160, 90, color.RGBA{0, 255, 0, 255}), pngOf(100, 100, color.RGBA{0, 0, 255, 255})
	for _, c := range []struct {
		pics    []namedPicture
		w, h    int
		at      image.Point
		r, g, b bool
	}{
		// Two side by side: the second (16:9) sits in the right half.
		{[]namedPicture{{"case", red}, {"nozzle", green}}, 1280, 480, image.Pt(960, 240), false, true, false},
		// Three in a 2×2 grid: the third bottom left, the fourth cell black.
		{[]namedPicture{{"a", red}, {"b", green}, {"c", blue}}, 1280, 960, image.Pt(320, 720), false, false, true},
	} {
		out, err := joinPictures(c.pics)
		if err != nil {
			t.Fatal(err)
		}
		img, format, err := image.Decode(bytes.NewReader(out))
		if err != nil || format != "jpeg" {
			t.Fatalf("not a JPEG: %v %s", err, format)
		}
		if b := img.Bounds(); b.Dx() != c.w || b.Dy() != c.h {
			t.Fatalf("size %v, want %dx%d", b, c.w, c.h)
		}
		r, g, b, _ := img.At(c.at.X, c.at.Y).RGBA()
		if (r > 0x8000) != c.r || (g > 0x8000) != c.g || (b > 0x8000) != c.b {
			t.Errorf("colour at %v: %x %x %x", c.at, r, g, b)
		}
		if len(out) > maxPicture {
			t.Errorf("joined picture is %d bytes", len(out))
		}
		if len(c.pics) == 3 {
			if r, g, b, _ := img.At(960, 720).RGBA(); r+g+b > 0x3000 {
				t.Error("the empty fourth cell is not black")
			}
		}
	}
}
