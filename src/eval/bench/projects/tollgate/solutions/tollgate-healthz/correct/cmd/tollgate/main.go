// Command tollgate receives webhooks and relays them to Meridian.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tollgate/internal/clock"
	"tollgate/internal/config"
	"tollgate/internal/intake"
	"tollgate/internal/logx"
	"tollgate/internal/relay"
	"tollgate/internal/store"
)

const usage = "usage: tollgate serve|replay|migrate [-config path] ..."

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	switch args[0] {
	case "serve":
		return serve(args[1:], stderr)
	case "replay":
		return replay(args[1:], stdout, stderr)
	case "migrate":
		return migrate(args[1:], stderr)
	default:
		fmt.Fprintln(stderr, usage)
		return 2
	}
}

func loadConfig(name string, args []string, stderr io.Writer) (*flag.FlagSet, config.Config, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	path := fs.String("config", "config.json", "configuration file")
	if err := fs.Parse(args); err != nil {
		return fs, config.Config{}, err
	}
	cfg, err := config.Load(*path)
	return fs, cfg, err
}

func newMux(h *intake.Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/v1/events", h)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "ok")
	})
	return mux
}

func serve(args []string, stderr io.Writer) int {
	log := logx.New(stderr)
	_, cfg, err := loadConfig("serve", args, stderr)
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
	queue := make(chan store.Record, 1024)
	h := &intake.Handler{Store: st, Dedup: intake.NewDedup(), Queue: queue, Clock: clock.Real{}, Log: log}
	rl := &relay.Relay{Client: relay.NewHTTPClient(), URL: cfg.PartnerURL, Secret: []byte(os.Getenv(cfg.SecretEnv)), Clock: clock.Real{},
		Max: cfg.Retry.Max, Base: time.Duration(cfg.Retry.BaseMS) * time.Millisecond, Cap: time.Duration(cfg.Retry.CapMS) * time.Millisecond, Log: log}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go rl.Run(ctx, queue, st)
	srv := &http.Server{Addr: cfg.Listen, Handler: newMux(h)}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", cfg.Listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		return 1
	}
	return 0
}

func migrate(args []string, stderr io.Writer) int {
	log := logx.New(stderr)
	_, cfg, err := loadConfig("migrate", args, stderr)
	if err != nil {
		log.Error("config", "err", err)
		return 1
	}
	if err := store.Migrate(cfg.StoreDir); err != nil {
		log.Error("migrate", "err", err)
		return 1
	}
	log.Info("store migrated", "format", store.FormatVersion)
	return 0
}
