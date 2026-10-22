package main

// No windows on Linux (a desktop, a Pi or a printer): everything is in the terminal.
const guiAvailable = false

func guiAsk(string, string, string) (string, bool) { return "", false }

func guiChoice(string, string, string, string, string, bool) int { return 1 }

func guiMessage(string, string, bool) {}
