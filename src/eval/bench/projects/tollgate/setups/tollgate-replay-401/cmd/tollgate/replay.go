package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"

	"tollgate/internal/clock"
	"tollgate/internal/config"
	"tollgate/internal/jsonx"
	"tollgate/internal/logx"
	"tollgate/internal/relay"
	"tollgate/internal/sign"
	"tollgate/internal/store"
)

func replay(args []string, stdout, stderr io.Writer) int {
	log := logx.New(stderr)
	fs := flag.NewFlagSet("replay", flag.ContinueOnError)
	fs.SetOutput(stderr)
	list := fs.Bool("list", false, "print every delivery as a JSON line")
	path := fs.String("config", "config.json", "configuration file")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	cfg, err := config.Load(*path)
	if err != nil {
		log.Error("config", "err", err)
		return 1
	}
	st, err := store.Open(cfg.StoreDir)
	if err != nil {
		log.Error("open store", "err", err)
		return 1
	}
	defer st.Close()
	if *list {
		enc := json.NewEncoder(stdout)
		for _, r := range st.List() {
			enc.Encode(r)
		}
		return 0
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(stderr, "usage: tollgate replay [-config path] --list | <id>")
		return 2
	}
	rec, ok := st.Get(fs.Arg(0))
	if !ok {
		log.Error("no such delivery", "event_id", fs.Arg(0))
		return 1
	}
	if err := send(relay.NewHTTPClient(), cfg.PartnerURL, []byte(os.Getenv(cfg.SecretEnv)), clock.Real{}, rec); err != nil {
		log.Error("replay failed", "event_id", rec.ID, "err", err)
		return 1
	}
	log.Info("replayed", "event_id", rec.ID)
	return 0
}

func send(client *http.Client, url string, secret []byte, c clock.Clock, rec store.Record) error {
	body := []byte(rec.Body)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	canonical, err := jsonx.Canonical(body)
	if err != nil {
		return err
	}
	req.Header.Set("X-Meridian-Signature", sign.V2(secret, canonical, c.Now()))
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}
