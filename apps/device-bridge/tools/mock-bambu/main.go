// Command mock-bambu runs a pretend Bambu Lab printer (internal/fakebambu) for
// the Device tab's browser test (apps/web/test/device-bambu.mjs). It prints one
// JSON line saying where it is, then answers on a small local web page:
//
//	GET  /state  its files (name: size), the commands it got and its status
//	POST /off    turns it off (stops answering)
//
//	go run ./tools/mock-bambu
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"

	"github.com/nissy34/cloud-slicer/apps/device-bridge/internal/fakebambu"
)

func main() {
	p, err := fakebambu.Start()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	dir, _ := os.MkdirTemp("", "mock-bambu-")
	ca := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(ca, p.CAPEM, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/state", func(w http.ResponseWriter, r *http.Request) {
		files := map[string]int{}
		for name, body := range p.Files() {
			files[name] = len(body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"files": files, "commands": p.Commands(), "report": p.Report()})
	})
	mux.HandleFunc("/off", func(w http.ResponseWriter, r *http.Request) {
		p.Close()
		w.WriteHeader(http.StatusNoContent)
	})
	out, _ := json.Marshal(map[string]any{
		"url": "http://127.0.0.1", "code": fakebambu.Code, "serial": fakebambu.Serial, "ca": ca,
		// CLOUD_SLICER_BAMBU_PORTS for the bridge: MQTT, FTP, camera, and no search port.
		"ports":   p.MQTT + "," + p.FTP + "," + p.Camera + ",0",
		"control": "http://" + ln.Addr().String(),
	})
	fmt.Println(string(out))
	_ = http.Serve(ln, mux)
}
