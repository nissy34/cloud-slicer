//go:build !windows

package main

import (
	"os/exec"
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
