package main

import (
	"net/http"

	"tollgate/internal/relay"
)

// newReplayClient is the client replays use, wherever they are sent.
func newReplayClient() *http.Client { return relay.NewHTTPClient() }
