package main

// One picture from several cameras, for an alert: a notification shows only one
// picture, so two cameras sit side by side and three or four in a 2×2 grid, each
// fitted into its cell and named in its corner. The browser joins them the same
// way for printers it reaches directly (apps/web/src/device/alert-picture.ts).

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

const (
	// cellW × cellH is each camera's share of a joined picture.
	cellW = 640
	cellH = 480
	// maxPicture is the largest picture an alert carries (the relay keeps none bigger).
	maxPicture = 600 * 1024
)

type namedPicture struct {
	name string
	data []byte
}

// pictureGrid is the columns and rows for n cameras.
func pictureGrid(n int) (cols, rows int) {
	switch {
	case n <= 1:
		return 1, 1
	case n == 2:
		return 2, 1
	default:
		return 2, 2
	}
}

// joinPictures puts up to four camera pictures (JPEG or PNG) into one JPEG.
// Pictures that can't be read leave their cell empty.
func joinPictures(pics []namedPicture) ([]byte, error) {
	if len(pics) > maxAlertCameras {
		pics = pics[:maxAlertCameras]
	}
	cols, rows := pictureGrid(len(pics))
	dst := image.NewRGBA(image.Rect(0, 0, cols*cellW, rows*cellH))
	xdraw.Draw(dst, dst.Bounds(), image.Black, image.Point{}, xdraw.Src)
	for i, p := range pics {
		cell := image.Rect(0, 0, cellW, cellH).Add(image.Pt((i%cols)*cellW, (i/cols)*cellH))
		if src, _, err := image.Decode(bytes.NewReader(p.data)); err == nil {
			xdraw.ApproxBiLinear.Scale(dst, fit(src.Bounds(), cell), src, src.Bounds(), xdraw.Over, nil)
		}
		nameCorner(dst, cell.Min, p.name)
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 80}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// fit is the largest rectangle with src's shape, centred in cell.
func fit(src, cell image.Rectangle) image.Rectangle {
	sw, sh := src.Dx(), src.Dy()
	if sw <= 0 || sh <= 0 {
		return cell
	}
	w, h := cell.Dx(), cell.Dx()*sh/sw
	if h > cell.Dy() {
		w, h = cell.Dy()*sw/sh, cell.Dy()
	}
	x, y := cell.Min.X+(cell.Dx()-w)/2, cell.Min.Y+(cell.Dy()-h)/2
	return image.Rect(x, y, x+w, y+h)
}

// nameCorner writes a camera's name on a dark band in a cell's top left corner, twice the font's size.
func nameCorner(dst *image.RGBA, at image.Point, name string) {
	if len(name) > 24 {
		name = name[:24]
	}
	face := basicfont.Face7x13
	w := font.MeasureString(face, name).Ceil() + 8
	small := image.NewRGBA(image.Rect(0, 0, w, 17))
	xdraw.Draw(small, small.Bounds(), image.NewUniform(color.RGBA{0, 0, 0, 150}), image.Point{}, xdraw.Src)
	d := &font.Drawer{Dst: small, Src: image.White, Face: face, Dot: fixed.P(4, 13)}
	d.DrawString(name)
	at = at.Add(image.Pt(8, 8))
	xdraw.NearestNeighbor.Scale(dst, image.Rect(at.X, at.Y, at.X+2*w, at.Y+34), small, small.Bounds(), xdraw.Over, nil)
}
