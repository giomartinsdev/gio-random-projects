package httpapi

import (
	"context"
	"log/slog"
	"net"
	"net/http"
)

type callerLabelKey struct{}

// CallerLabel returns the authenticated caller's label (see
// APIKeys.Label), for handlers/logging that want to know who made the
// request.
func CallerLabel(ctx context.Context) string {
	label, _ := ctx.Value(callerLabelKey{}).(string)
	return label
}

// Secure enforces the apiKey security scheme documented in openapi.yaml:
// a valid X-API-Key is required to reach next at all. A valid key skips
// the rate limiter entirely (trusted caller, no throttling); a
// missing/invalid key is rate-limited per source IP before being
// rejected with 401 — the limiter's job here is only to slow down
// brute-forcing or scanning for a valid key, since every such request
// ends in 401 regardless.
func Secure(next http.Handler, keys APIKeys, limiter *IPRateLimiter, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if label, ok := keys.Label(key); ok {
			ctx := context.WithValue(r.Context(), callerLabelKey{}, label)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		ip := clientIP(r)
		if !limiter.Allow(ip) {
			log.Warn("rate limited", "ip", ip, "path", r.URL.Path)
			writeJSON(w, http.StatusTooManyRequests, errorBody{Error: "too many requests"})
			return
		}
		writeJSON(w, http.StatusUnauthorized, errorBody{Error: "missing or invalid API key"})
	})
}

func clientIP(r *http.Request) string {
	// Trusts X-Forwarded-For because this service is only ever reached
	// through the homelab's Cloudflare Tunnel/proxy — see this repo's
	// infra/cloudflared. There's no path where a client can hit this
	// service directly and spoof the header past a proxy that would
	// otherwise overwrite it.
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
