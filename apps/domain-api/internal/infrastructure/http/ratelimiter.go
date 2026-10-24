package httpapi

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// IPRateLimiter gives each client IP its own token bucket. It only ever
// gates unauthenticated/invalid-key requests — see Secure in
// middleware.go — so its limits should stay strict: this is an
// anti-brute-force/anti-scanning throttle, not a real traffic shaper.
type IPRateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*bucket
	rps      rate.Limit
	burst    int
	idleTTL  time.Duration
}

type bucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func NewIPRateLimiter(rps float64, burst int) *IPRateLimiter {
	l := &IPRateLimiter{
		limiters: make(map[string]*bucket),
		rps:      rate.Limit(rps),
		burst:    burst,
		idleTTL:  10 * time.Minute,
	}
	go l.evictLoop()
	return l
}

func (l *IPRateLimiter) Allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.limiters[ip]
	if !ok {
		b = &bucket{limiter: rate.NewLimiter(l.rps, l.burst)}
		l.limiters[ip] = b
	}
	b.lastSeen = time.Now()
	return b.limiter.Allow()
}

// evictLoop drops buckets nothing has hit in idleTTL — without this,
// every distinct IP that ever probes the API (this is internet-facing)
// leaks a bucket forever.
func (l *IPRateLimiter) evictLoop() {
	ticker := time.NewTicker(l.idleTTL)
	defer ticker.Stop()
	for range ticker.C {
		l.mu.Lock()
		for ip, b := range l.limiters {
			if time.Since(b.lastSeen) > l.idleTTL {
				delete(l.limiters, ip)
			}
		}
		l.mu.Unlock()
	}
}
