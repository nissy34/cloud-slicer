// Command release signs the bridge builds for self-update. CI runs it with the
// private key in BRIDGE_SIGNING_KEY (the base64url ed25519 seed, a repo secret):
//
//	go run ./tools/release pubkey             the public key to build into the bridge
//	go run ./tools/release sign <build> dist  dist/release.json for every build in dist
//
// A new key, on any computer with Node.js (paste the output into the secret):
//
//	node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'jwk'}).d)"
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// The downloads the relay serves (APPS in apps/device-relay/src/index.ts).
var names = []string{"windows-x64", "mac-arm64", "mac-x64", "linux-x64", "linux-arm64", "linux-armv7", "linux-mipsle"}

type file struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Sig    string `json:"sig"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func key() (ed25519.PrivateKey, error) {
	seed, err := base64.RawURLEncoding.DecodeString(os.Getenv("BRIDGE_SIGNING_KEY"))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("BRIDGE_SIGNING_KEY must be a base64url ed25519 seed (32 bytes)")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

func run(args []string) error {
	k, err := key()
	if err != nil {
		return err
	}
	switch {
	case len(args) == 1 && args[0] == "pubkey":
		fmt.Println(base64.RawURLEncoding.EncodeToString(k.Public().(ed25519.PublicKey)))
		return nil
	case len(args) == 3 && args[0] == "sign":
		build, err := strconv.ParseInt(args[1], 10, 64)
		if err != nil || build <= 0 {
			return fmt.Errorf("bad build %q", args[1])
		}
		apps := map[string]file{}
		for _, name := range names {
			data, err := os.ReadFile(filepath.Join(args[2], name))
			if err != nil {
				return err
			}
			sum := sha256.Sum256(data)
			sha := hex.EncodeToString(sum[:])
			// The same text the bridge checks (signedText in update.go).
			sig := ed25519.Sign(k, []byte(fmt.Sprintf("cloud-slicer-bridge %s %d %s", name, build, sha)))
			apps[name] = file{int64(len(data)), sha, base64.RawURLEncoding.EncodeToString(sig)}
		}
		out, _ := json.MarshalIndent(map[string]any{"build": build, "apps": apps}, "", "  ")
		return os.WriteFile(filepath.Join(args[2], "release.json"), out, 0o644)
	}
	return fmt.Errorf("usage: release pubkey | release sign <build> <dist>")
}
