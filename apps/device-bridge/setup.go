package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Adding a bridge to an account: the Device tab gives a setup code (in the
// install command, or to paste), and the bridge spends it once at the relay,
// which checks it with Cloud Slicer. From then on the bridge belongs to that
// account and connects with its own key; the code is never needed again.

// exitSetupCode is the exit status when the setup code expired, was used or is
// wrong: the install scripts then ask for a new one and run again.
const exitSetupCode = 3

// setupCodeError is a setup code the relay turned down; asking for another one helps.
type setupCodeError struct{ msg string }

func (e setupCodeError) Error() string { return e.msg }

var relayClient = &http.Client{Timeout: 30 * time.Second}

// joinedAs is the bridge's name in the account, once this run spent a setup code.
var joinedAs string

// relayTakesCodes says whether bridges on this relay join an account with a setup
// code (a relay with accounts); a test or private relay without accounts doesn't.
func relayTakesCodes(relay string) (bool, error) {
	res, err := relayClient.Get(relay + "/v1/info")
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	var info struct {
		Accounts bool `json:"accounts"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return false, fmt.Errorf("the relay answered oddly (%s)", res.Status)
	}
	return info.Accounts, nil
}

// claimWithCode spends a setup code: it says the bridge's name in the account.
func claimWithCode(cfg *Config, code, place string) (string, error) {
	body, _ := json.Marshal(map[string]string{"key": cfg.Key, "code": code, "host": shortHost(), "system": goosName(), "place": place})
	res, err := relayClient.Post(cfg.Relay+"/v1/bridges/"+cfg.BridgeID+"/claim", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("Couldn't reach Cloud Slicer's relay (%v). Check the internet connection and try again.", err)
	}
	defer res.Body.Close()
	var answer struct {
		Name  string `json:"name"`
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	_ = json.NewDecoder(res.Body).Decode(&answer)
	switch {
	case res.StatusCode == http.StatusOK:
		return answer.Name, nil
	case answer.Code == "expired":
		return "", setupCodeError{"✗ This setup code expired or was already used.\n  Get a new one in Cloud Slicer: Printers & bridges, Add a bridge."}
	case answer.Code == "wrong":
		return "", setupCodeError{"✗ That setup code isn't right.\n  Copy it again from Cloud Slicer: Printers & bridges, Add a bridge."}
	case answer.Error != "":
		return "", errors.New(answer.Error)
	default:
		return "", fmt.Errorf("The relay refused the setup code (%s).", res.Status)
	}
}

// joinAccount makes sure the bridge belongs to an account before it is installed:
// with a relay that wants setup codes, it spends the one given. Without a code it
// says how to get one (a setupCodeError, so the install scripts ask for it).
func joinAccount(cfg *Config, code, place string) error {
	// "--code" with nothing after it reads as "true".
	if code = strings.TrimSpace(code); code == "true" {
		code = ""
	}
	if cfg.Claimed {
		return nil
	}
	takes, err := relayTakesCodes(cfg.Relay)
	if err != nil {
		if code == "" {
			// No relay to ask and nothing to spend: set up anyway; it joins when run with a code.
			return nil
		}
		return fmt.Errorf("Couldn't reach Cloud Slicer's relay (%v). Check the internet connection and try again.", err)
	}
	if !takes {
		return nil
	}
	if code == "" {
		return setupCodeError{"The bridge needs a setup code from Cloud Slicer: Printers & bridges, Add a bridge."}
	}
	name, err := claimWithCode(cfg, code, place)
	if err != nil {
		return err
	}
	cfg.Claimed = true
	if err := cfg.save(); err != nil {
		return err
	}
	if name == "" {
		name = "a bridge"
	}
	joinedAs = name
	fmt.Printf("✓ Connected to your Cloud Slicer account as %s.\n", name)
	return nil
}

// leaveAccount tells the relay this bridge was removed on this computer: the
// relay forgets it and Cloud Slicer takes it (and its printers) out of the
// account. It says whether the account part worked.
func leaveAccount(cfg *Config) bool {
	if !cfg.Claimed {
		return false
	}
	body, _ := json.Marshal(map[string]string{"key": cfg.Key})
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Post(cfg.Relay+"/v1/bridges/"+cfg.BridgeID+"/release", "application/json", bytes.NewReader(body))
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var answer struct {
		Account bool `json:"account"`
	}
	_ = json.NewDecoder(res.Body).Decode(&answer)
	return res.StatusCode == http.StatusOK && answer.Account
}
