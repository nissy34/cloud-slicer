//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

func hideWindow(*exec.Cmd) {}

// startDetached starts a program that outlives this one.
func startDetached(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
}

// stopOtherCopies: systemd and launchd stop and replace the background copy themselves.
func stopOtherCopies(string) {}

func useParentConsole() bool { return true }

func showMessage(string, string, bool) {}

// deleteAfterExit is only needed on Windows, where a running program can't be deleted.
func deleteAfterExit(string) error { return nil }

// restartIntoProcess replaces this process with the program at path, same arguments and
// process id, so a service manager (systemd, launchd, init scripts) sees no change.
func restartIntoProcess(path string) {
	err := syscall.Exec(path, append([]string{path}, os.Args[1:]...), os.Environ())
	fmt.Fprintln(os.Stderr, "Couldn't restart into the updated bridge:", err)
	os.Exit(1)
}

// ownerOf is the user that owns path: on a printer, the one Klipper and Moonraker run as.
func ownerOf(path string) (name string, uid, gid int) {
	st, err := os.Stat(path)
	if err != nil {
		return "root", 0, 0
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok {
		return "root", 0, 0
	}
	if u, err := user.LookupId(strconv.Itoa(int(sys.Uid))); err == nil {
		return u.Username, int(sys.Uid), int(sys.Gid)
	}
	return "root", 0, 0
}
