package main

import (
	"net/http"
	"time"
)

// newReplayClient is the client replays use, wherever they are sent.
func newReplayClient() *http.Client { return &http.Client{Timeout: 10 * time.Second} }
