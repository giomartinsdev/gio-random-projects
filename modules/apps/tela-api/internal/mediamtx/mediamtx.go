// Package mediamtx proxies screen-share media through a self-hosted
// MediaMTX: WHIP to publish, WHEP to read. Media never transits this
// process -- only the SDP handshake does; the browser talks to
// MediaMTX's ICE/DTLS port directly.
//
// One path = one stream (all tracks of one publisher peer connection).
// The server proxies the raw SDP so the browser never reaches MediaMTX's
// HTTP port and the path/Location stay invisible to clients.
package mediamtx

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The SDP round trip to MediaMTX: long enough for a real handshake,
// short enough that a wedged MediaMTX doesn't pin a request forever.
const sdpTimeout = 10 * time.Second

// Best-effort teardown; MediaMTX also reaps the path on its own when
// the publisher's peer connection closes.
const closeTimeout = 5 * time.Second

// Result is one WHIP/WHEP exchange's answer, plus (WHIP only) the
// session Location used for teardown.
type Result struct {
	SDP string
	// WHIP answers carry a Location header naming the session to DELETE;
	// WHEP answers don't (MediaMTX reaps a reader when its PC closes).
	Location string
}

// Proxy is the server's side of the MediaMTX transport. A nil *Proxy is
// valid and means "no MediaMTX configured": every method degrades to a
// clear refusal instead of a panic, which is what lets a deploy without
// the media profile keep serving rooms.
type Proxy struct {
	base   string
	client *http.Client
}

// NewProxy builds a proxy from MediaMTX's Docker-internal base URL
// (e.g. http://mediamtx:8889). An empty or whitespace-only URL returns
// nil, deliberately: the caller's `if proxy != nil` is the configured
// check, mirroring the old SFU's nil-able field.
func NewProxy(base string) *Proxy {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return nil
	}
	return &Proxy{
		base: base,
		// No timeout on the client itself; each request carries its own
		// deadline so a slow gather can't wedge the whole room.
		client: &http.Client{},
	}
}

// Configured reports whether MediaMTX is available. A nil proxy is never
// configured.
func (p *Proxy) Configured() bool { return p != nil && p.base != "" }

func (p *Proxy) whipURL(path string) string {
	return fmt.Sprintf("%s/%s/whip", p.base, url.PathEscape(path))
}

func (p *Proxy) whepURL(path string) string {
	return fmt.Sprintf("%s/%s/whep", p.base, url.PathEscape(path))
}

// PathFor names one publisher's stream inside MediaMTX. Namespaced by the
// room so two rooms never collide, lowercased because MediaMTX paths are
// case-sensitive but client ids aren't guaranteed stable in case.
func PathFor(roomID, peerID string) string {
	return "tela-" + strings.ToLower(roomID) + "-" + strings.ToLower(peerID)
}

// sdpExchange is the one shape both WHIP and WHEP share: POST a raw SDP
// offer (Content-Type: application/sdp) whose response body is the
// answer. WHIP additionally returns a Location for teardown.
func (p *Proxy) sdpExchange(url, offer string) (Result, error) {
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(offer))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/sdp")

	ctx, cancel := context.WithTimeout(req.Context(), sdpTimeout)
	defer cancel()
	req = req.WithContext(ctx)

	res, err := p.client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("mediamtx: %w", err)
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		// MediaMTX's body carries the parser/validation detail -- without
		// it a failure is just "HTTP 400".
		detail := strings.TrimSpace(string(body))
		if len(detail) > 200 {
			detail = detail[:200]
		}
		if detail == "" {
			return Result{}, fmt.Errorf("mediamtx: HTTP %d", res.StatusCode)
		}
		return Result{}, fmt.Errorf("mediamtx: HTTP %d — %s", res.StatusCode, detail)
	}
	sdp := string(body)
	if strings.TrimSpace(sdp) == "" {
		return Result{}, fmt.Errorf("mediamtx: resposta sem SDP")
	}
	return Result{SDP: sdp, Location: res.Header.Get("Location")}, nil
}

// Publish forwards a raw publisher offer to MediaMTX's WHIP endpoint and
// returns its answer plus the session Location. The offer is sent RAW --
// never munge it (no x-google-* bitrate lines): that drives residential
// uplinks past what they can carry and MediaMTX drops frames. Sender
// caps are applied client-side via setParameters instead.
func (p *Proxy) Publish(path, offer string) (Result, error) {
	if !p.Configured() {
		return Result{}, fmt.Errorf("mediamtx: transporte desconfigurado")
	}
	return p.sdpExchange(p.whipURL(path), offer)
}

// Subscribe forwards a raw viewer offer to MediaMTX's WHEP endpoint and
// returns the answer. The viewer never learns the path.
func (p *Proxy) Subscribe(path, offer string) (Result, error) {
	if !p.Configured() {
		return Result{}, fmt.Errorf("mediamtx: transporte desconfigurado")
	}
	return p.sdpExchange(p.whepURL(path), offer)
}

// Close ends a WHIP session. A failed DELETE never breaks the share end:
// MediaMTX also tears the path down when the publisher's PC closes, and a
// 404 means the session is already gone (the intended end state).
func (p *Proxy) Close(location string) error {
	if !p.Configured() || location == "" {
		return nil
	}
	// MediaMTX answers WHIP with a RELATIVE Location
	// (/tela-x/whip/<uuid>), which url.Parse accepts but a bare fetch
	// would not; resolve it against the base. An absolute Location
	// passes through unchanged.
	target, err := url.Parse(location)
	if err != nil {
		return fmt.Errorf("mediamtx: location inválido (%s): %w", location, err)
	}
	if !target.IsAbs() {
		base, err := url.Parse(p.base + "/")
		if err != nil {
			return err
		}
		target = base.ResolveReference(target)
	}

	req, err := http.NewRequest(http.MethodDelete, target.String(), nil)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(req.Context(), closeTimeout)
	defer cancel()
	req = req.WithContext(ctx)

	res, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("mediamtx: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNoContent && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("mediamtx: HTTP %d no teardown", res.StatusCode)
	}
	return nil
}

// OfferHasAudio reports whether an offer carries an audio m-line. The
// server derives the audio flag from the publisher's own SDP, so a client
// flag can't lie about what's published.
func OfferHasAudio(sdp string) bool {
	return hasAudioLine(sdp)
}

// hasAudioLine matches an m=audio line at the start of any line.
func hasAudioLine(sdp string) bool {
	for _, line := range strings.Split(sdp, "\n") {
		if strings.HasPrefix(strings.TrimRight(line, "\r"), "m=audio ") {
			return true
		}
	}
	return false
}
