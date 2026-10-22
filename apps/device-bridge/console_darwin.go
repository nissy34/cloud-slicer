package main

import (
	"os"

	"golang.org/x/sys/unix"
)

// hasConsole: a terminal, or output going to a file or pipe (a script, CI). Opened
// from Finder, all three are /dev/null.
func hasConsole() bool {
	for _, f := range []*os.File{os.Stdin, os.Stdout, os.Stderr} {
		if _, err := unix.IoctlGetTermios(int(f.Fd()), unix.TIOCGETA); err == nil {
			return true
		}
	}
	fi, err := os.Stdout.Stat()
	return err == nil && (fi.Mode().IsRegular() || fi.Mode()&os.ModeNamedPipe != 0 || fi.Mode()&os.ModeSocket != 0)
}
