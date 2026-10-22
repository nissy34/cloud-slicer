package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"unsafe"
)

const (
	createNoWindow        = 0x08000000
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

var (
	kernel32      = syscall.NewLazyDLL("kernel32.dll")
	attachConsole = kernel32.NewProc("AttachConsole")
	messageBox    = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
)

// hideWindow keeps helper commands (reg, taskkill) from flashing a console window.
func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// startDetached starts a program that outlives this one, with no window.
func startDetached(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess | createNewProcessGroup | createNoWindow}
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
}

// stopOtherCopies ends any other running copy of the installed bridge (Windows locks running programs).
func stopOtherCopies(path string) {
	c := exec.Command("taskkill", "/F", "/IM", filepath.Base(path), "/FI", "PID ne "+strconv.Itoa(os.Getpid()))
	hideWindow(c)
	_ = c.Run()
}

// deleteAfterExit deletes a folder a moment after this program exits: Windows
// can't delete a program while it runs. The command line goes to cmd as it is
// (Go would escape the quotes around the folder the C way, which cmd doesn't read).
// cmd gets a console with no window rather than none at all: with none
// (detached), the ping it runs would open a console window of its own.
func deleteAfterExit(dir string) error {
	c := exec.Command("cmd")
	c.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNewProcessGroup | createNoWindow,
		CmdLine:       `cmd /c ping -n 3 127.0.0.1 >nul & rmdir /s /q "` + dir + `"`,
	}
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
}

// useParentConsole lets the app, which has no window of its own, print to the
// terminal it was started from. It says whether there is one: opened with a
// double click there isn't.
func useParentConsole() bool {
	// Output sent to a file or a pipe (a script, CI) already arrives there.
	if fi, err := os.Stdout.Stat(); err == nil && fi.Mode()&os.ModeCharDevice == 0 {
		return true
	}
	const attachParentProcess = ^uintptr(0)
	if r, _, _ := attachConsole.Call(attachParentProcess); r == 0 {
		return false
	}
	if out, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = out, out
	}
	return true
}

// showMessage tells someone who double-clicked the app what happened, since it has no window.
func showMessage(title, text string, isError bool) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	flags := uintptr(0x40) // MB_ICONINFORMATION
	if isError {
		flags = 0x10 // MB_ICONERROR
	}
	_, _, _ = messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}

// restartIntoProcess starts the program at path with the same arguments, then exits.
func restartIntoProcess(path string) {
	_ = startDetached(path, os.Args[1:]...)
	os.Exit(0)
}
