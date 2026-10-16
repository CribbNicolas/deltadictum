package relay

import (
	"math/rand"
	"time"
)

// backoff is how long to wait before retry number attempt+1.
func (r *Relay) backoff(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		return retryAfter
	}
	ceiling := r.Cap
	if attempt < 31 {
		if d := r.Base << attempt; d > 0 && d < ceiling {
			ceiling = d
		}
	}
	if ceiling <= 0 {
		return 0
	}
	if r.Rand != nil {
		return time.Duration(r.Rand.Int63n(int64(ceiling) + 1))
	}
	return time.Duration(rand.Int63n(int64(ceiling) + 1))
}
