//go:build windows || darwin

package main

import (
	"errors"

	"github.com/ncruces/zenity"
)

// The few windows the computer apps show when opened by hand (a double click,
// the Start menu, Applications): plain system dialogs, no web page. Linux and
// printers have no windows; there everything is in the terminal.

const guiAvailable = true

// guiAsk asks for one line of text; ok is false when it was cancelled.
func guiAsk(title, text, cancel string) (answer string, ok bool) {
	answer, err := zenity.Entry(text, zenity.Title(title), zenity.OKLabel("Continue"), zenity.CancelLabel(cancel))
	return answer, err == nil
}

// guiChoice shows a message with up to three buttons and says which was pressed:
// 0 the first (ok), 1 the second (cancel, or the window was closed), 2 the extra one.
func guiChoice(title, text, ok, cancel, extra string, warn bool) int {
	opts := []zenity.Option{zenity.Title(title), zenity.OKLabel(ok), zenity.CancelLabel(cancel), zenity.InfoIcon}
	if warn {
		opts[len(opts)-1] = zenity.WarningIcon
	}
	if extra != "" {
		opts = append(opts, zenity.ExtraButton(extra))
	}
	switch err := zenity.Question(text, opts...); {
	case err == nil:
		return 0
	case errors.Is(err, zenity.ErrExtraButton):
		return 2
	default:
		return 1
	}
}

// guiMessage shows a message with one OK button.
func guiMessage(title, text string, isError bool) {
	icon := zenity.InfoIcon
	if isError {
		icon = zenity.ErrorIcon
	}
	_ = zenity.Info(text, zenity.Title(title), icon)
}
