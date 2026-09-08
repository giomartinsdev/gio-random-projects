// Package domainapi is cch-api's persistence client: everything this
// process durably remembers now goes through the platform's domain-api
// (rooms → cch_rooms, decks → cch_custom_decks) instead of JSON files
// on a volume. There is no database driver here and there must never be
// one — the whole point of the cutover is that this service talks HTTP
// like every other service.
//
// Two write shapes, deliberately separate:
//
//   - Sync: POST /sync, which publishes the command on the same async
//     broker as everything else and then holds the request open until
//     the worker's audit row proves the write landed. Used for the
//     structural writes (room create/delete, deck publish) where "the
//     room exists" must survive a restart that happens seconds later.
//     This is the platform's documented exception — do not add more
//     callers than need it.
//   - Async: the normal 202 path (POST /cch/decks/{id}/plays), used for
//     the cosmetic write where a lost bump just makes a badge stale.
//
// Reads: GET /cch/rooms and GET /cch/decks, once at boot. After Load,
// everything lives in memory exactly as before — the hot path (join,
// password check, game rounds) never touches the network.
package domainapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ErrQueued is Sync's "gave up waiting" answer (the server's 504). The
// command was published and may still land — it is not a rejection. A
// caller that must not lose the record (the legacy JSON import) treats
// this as "try again next boot"; a caller whose record already exists
// in memory (room create) treats it like any other persist failure:
// log and keep the memory-only copy.
var ErrQueued = errors.New("domain: command still queued (worker did not confirm in time)")

// ErrRejected is Sync's 422: the worker looked at the command and
// refused it (validation, unknown action). Retrying unchanged will
// fail the same way — this is permanent, unlike ErrQueued.
var ErrRejected = errors.New("domain: command rejected by worker")

// Client talks to domain-api with the service's own API key (each
// caller gets an identity so the audit log can name it). A nil Client
// is valid and means "no persistence": every method short-circuits the
// way an empty STATE_FILE path used to.
type Client struct {
	base string
	key  string
	// syncHTTP allows for the server's own 10s wait plus round-trips;
	// asyncHTTP bounds the fire-and-forget path so a wedged domain-api
	// can't pile up goroutines; readHTTP bounds the boot load.
	syncHTTP  *http.Client
	asyncHTTP *http.Client
	readHTTP  *http.Client
}

// New builds a client. base is the origin (e.g. http://127.0.0.1:8000).
func New(base, key string) *Client {
	return &Client{
		base:      base,
		key:       key,
		syncHTTP:  &http.Client{Timeout: 15 * time.Second},
		asyncHTTP: &http.Client{Timeout: 5 * time.Second},
		readHTTP:  &http.Client{Timeout: 15 * time.Second},
	}
}

// NewFromEnv wires the client from DOMAIN_API_URL + DOMAIN_API_KEY.
// Either unset (local dev, tests) returns nil — memory only, exactly
// the old empty-STATE_FILE behavior.
func NewFromEnv() *Client {
	base, key := os.Getenv("DOMAIN_API_URL"), os.Getenv("DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Enabled reports whether persistence is wired up.
func (c *Client) Enabled() bool { return c != nil }

// Room mirrors one cch_rooms row on the wire. []byte fields ride JSON
// as base64 (encoding/json's default), which is the same encoding the
// command payloads and the old rooms.json used — the bytes that went
// in are the bytes that come back.
type Room struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resume_key"`
}

// RoomInput is the cchroom.create payload. Field names match
// domain-worker's cchroom.CreateInput json tags — the envelope is
// decoded over there, so these must not drift.
type RoomInput struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resume_key"`
}

// DeleteInput is the cchroom.delete payload. No password: cch-api
// already verified it against the scrypt hash before deciding to
// delete, and domain-api has no business re-checking what it can't.
type DeleteInput struct {
	ID string `json:"id"`
}

// Deck mirrors one cch_custom_decks row on the wire.
type Deck struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji"`
	Description string    `json:"description"`
	ParentID    string    `json:"parent_id"`
	Author      string    `json:"author"`
	Whites      []string  `json:"whites"`
	Blacks      []string  `json:"blacks"`
	CreatedAt   time.Time `json:"created_at"`
	Plays       int       `json:"plays"`
}

// DeckUpsert is the cchdeck.upsert payload (worker's UpsertInput tags).
type DeckUpsert struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji,omitempty"`
	Description string    `json:"description,omitempty"`
	ParentID    string    `json:"parent_id,omitempty"`
	Author      string    `json:"author,omitempty"`
	Whites      []string  `json:"whites"`
	Blacks      []string  `json:"blacks"`
	CreatedAt   time.Time `json:"created_at,omitempty"`
	Plays       int       `json:"plays"`
}

// envelope is the write shape every domain-api route takes.
type envelope struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// syncResponse is /sync's three possible outcomes on one struct.
type syncResponse struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	EntityID  string `json:"entity_id"`
	Error     string `json:"error"`
}

// Sync publishes action and blocks until the worker's audit row lands.
// Returns the written entity's id. ErrQueued means "published, not yet
// confirmed"; any other error means the command was rejected or could
// not be published.
func (c *Client) Sync(ctx context.Context, action string, payload any) (string, error) {
	if c == nil {
		return "", nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("domain: marshal %s payload: %w", action, err)
	}
	body, status, err := c.post(ctx, c.syncHTTP, "/sync", envelope{Action: action, Payload: raw})
	if err != nil {
		return "", err
	}
	var resp syncResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("domain: decode /sync response (status %d): %w", status, err)
	}
	switch {
	case status == http.StatusOK && resp.Status == "written":
		return resp.EntityID, nil
	case status == http.StatusGatewayTimeout || resp.Status == "queued":
		return "", fmt.Errorf("%w: %s", ErrQueued, resp.Error)
	case status == http.StatusUnprocessableEntity || resp.Status == "failed":
		return "", fmt.Errorf("%w: %s", ErrRejected, resp.Error)
	default:
		return "", fmt.Errorf("domain: %s was not written (status %d): %s", action, status, resp.Error)
	}
}

// PlayCounted is the one async write: POST /cch/decks/{id}/plays, the
// normal 202 pattern. The worker applies it whenever it gets to it;
// nothing here waits. A dropped bump only makes a marketplace badge
// stale, which is why this — unlike every structural write — doesn't
// need /sync.
func (c *Client) PlayCounted(ctx context.Context, deckID string) error {
	if c == nil {
		return nil
	}
	_, status, err := c.post(ctx, c.asyncHTTP, "/cch/decks/"+deckID+"/plays", nil)
	if err != nil {
		return err
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("domain: POST plays for %s: status %d", deckID, status)
	}
	return nil
}

// ListRooms is the boot load of the room registry.
func (c *Client) ListRooms(ctx context.Context) ([]Room, error) {
	if c == nil {
		return nil, nil
	}
	var out struct {
		Rooms []Room `json:"rooms"`
	}
	if err := c.get(ctx, "/cch/rooms", &out); err != nil {
		return nil, err
	}
	return out.Rooms, nil
}

// ListDecks is the boot load of the marketplace, cards included —
// server-to-server, behind the API key.
func (c *Client) ListDecks(ctx context.Context) ([]Deck, error) {
	if c == nil {
		return nil, nil
	}
	var out struct {
		Decks []Deck `json:"decks"`
	}
	if err := c.get(ctx, "/cch/decks", &out); err != nil {
		return nil, err
	}
	return out.Decks, nil
}

// post sends one envelope to path and returns the body + status. A
// transport error surfaces as-is; HTTP error statuses are returned to
// the caller (Sync classifies them, Async turns any non-2xx into an
// error).
func (c *Client) post(ctx context.Context, client *http.Client, path string, body any) ([]byte, int, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, 0, fmt.Errorf("domain: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.key)

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("domain: POST %s: %w", path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("domain: read POST %s response: %w", path, err)
	}
	return data, resp.StatusCode, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("domain: GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(out); err != nil {
		return fmt.Errorf("domain: decode GET %s: %w", path, err)
	}
	return nil
}