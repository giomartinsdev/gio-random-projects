// Command fake-domain-pair is a stand-in for the domain-api/domain-worker pair,
// used ONLY by prospecta-api's integration tests. It implements just enough of
// the documented contract to let the BFF be exercised against a REAL network
// hop in a container:
//
//	GET  /companies/{id}       -> 200 projection, or 404 when unknown
//	GET  /campaigns            -> 200 paginated projection
//	GET  /campaigns/{id}       -> 200 projection, or 404
//	GET  /leads?filters        -> 200 paginated projection
//	GET  /leads/{id}           -> 200 detail, or 404
//	GET  /conversations        -> 200 paginated projection
//	GET  /conversations/{id}   -> 200 thread, or 404
//	GET  /messages/{id}        -> 200 projection, or 404
//	GET  /users/by-email/{e}   -> 200 user projection, or 404
//	GET  /agent/activity       -> text/event-stream of agent_run events
//	POST /commands             -> decode {action,payload}, record it, answer 202
//
// and it records every command it receives, so a test can prove what the BFF
// published -- and, just as importantly, what it did NOT publish when it
// rejected the request itself.
//
// It also enforces X-API-Key on the contract routes: if prospecta-api ever
// stopped sending the key on its outbound edge, these tests would fail rather
// than silently pass.
//
// Stdlib-only on purpose: it is compiled with `go run` inside a golang:alpine
// container (no module, no downloads). A few /__* control routes let the test
// seed projections, inspect the recorded commands and push live activity.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

type envelope struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

type recordedCommand struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
	ID      string          `json:"command_id"`
}

// store is one collection of seeded projections, kept in insertion order so a
// list projection is deterministic (a Go map would iterate randomly).
type store struct {
	byID  map[string]json.RawMessage
	order []string
}

func newStore() *store { return &store{byID: map[string]json.RawMessage{}} }

func (s *store) put(raw json.RawMessage) error {
	var meta struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || meta.ID == "" {
		return fmt.Errorf("record needs an id")
	}
	if _, exists := s.byID[meta.ID]; !exists {
		s.order = append(s.order, meta.ID)
	}
	s.byID[meta.ID] = raw
	return nil
}

type fake struct {
	mu       sync.Mutex
	commands []recordedCommand
	stores   map[string]*store
	users    map[string]json.RawMessage
	seq      int
	key      string

	activityMu   sync.Mutex
	activitySubs map[int]chan json.RawMessage
	activitySeq  int
	activitySeen int
}

func main() {
	f := &fake{
		key: os.Getenv("DOMAIN_KEY"),
		stores: map[string]*store{
			"company":      newStore(),
			"campaign":     newStore(),
			"lead":         newStore(),
			"conversation": newStore(),
			"message":      newStore(),
		},
		users:        map[string]json.RawMessage{},
		activitySubs: map[int]chan json.RawMessage{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /commands", f.guarded(f.publish))

	mux.HandleFunc("GET /companies/{id}", f.guarded(f.one("company")))

	mux.HandleFunc("GET /campaigns", f.guarded(f.list("campaign", nil)))
	mux.HandleFunc("GET /campaigns/{id}", f.guarded(f.one("campaign")))

	mux.HandleFunc("GET /leads", f.guarded(f.list("lead", filterLeads)))
	mux.HandleFunc("GET /leads/{id}", f.guarded(f.one("lead")))

	mux.HandleFunc("GET /conversations", f.guarded(f.list("conversation", nil)))
	mux.HandleFunc("GET /conversations/{id}", f.guarded(f.one("conversation")))

	mux.HandleFunc("GET /messages/{id}", f.guarded(f.one("message")))

	mux.HandleFunc("GET /users/by-email/{email}", f.guarded(f.userByEmail))

	mux.HandleFunc("GET /agent/activity", f.guarded(f.activity))

	// Control routes (no key): used by the test to set up and inspect state.
	mux.HandleFunc("POST /__seed/company", f.seed("company"))
	mux.HandleFunc("POST /__seed/campaign", f.seed("campaign"))
	mux.HandleFunc("POST /__seed/lead", f.seed("lead"))
	mux.HandleFunc("POST /__seed/conversation", f.seed("conversation"))
	mux.HandleFunc("POST /__seed/message", f.seed("message"))
	mux.HandleFunc("POST /__seed/user", f.seedUser)
	mux.HandleFunc("POST /__seed/activity", f.seedActivity)
	mux.HandleFunc("GET /__activity/connections", f.activityConnections)
	mux.HandleFunc("GET /__commands", f.listCommands)
	mux.HandleFunc("DELETE /__commands", f.clearCommands)
	mux.HandleFunc("DELETE /__state", f.clearState)

	_ = http.ListenAndServe(":"+env("PORT", "8080"), mux)
}

func (f *fake) guarded(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if f.key != "" && r.Header.Get("X-API-Key") != f.key {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing or invalid API key"})
			return
		}
		next(w, r)
	}
}

func (f *fake) publish(w http.ResponseWriter, r *http.Request) {
	var env envelope
	if err := json.NewDecoder(r.Body).Decode(&env); err != nil || env.Action == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid envelope"})
		return
	}
	f.mu.Lock()
	f.seq++
	id := "cmd-" + strconv.Itoa(f.seq)
	f.commands = append(f.commands, recordedCommand{Action: env.Action, Payload: env.Payload, ID: id})
	// CreateCompany/CreateUser are folded into the read projections so a
	// signup is immediately visible to GET /companies/{id} and
	// GET /users/by-email/{email}. The stored id is the command id, mirroring
	// what the real pair would stamp.
	switch env.Action {
	case "CreateCompany":
		f.registerCompany(env.Payload, id)
	case "CreateUser":
		f.registerUser(env.Payload, id)
	case "UpdateUserPassword":
		f.updateUserPassword(env.Payload)
	}
	f.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]string{"command_id": id, "status": "accepted"})
}

// registerCompany folds a CreateCompany payload into the company store. Caller
// holds f.mu.
func (f *fake) registerCompany(payload json.RawMessage, id string) {
	var c struct {
		Name        string `json:"name"`
		Site        string `json:"site"`
		Description string `json:"description"`
		TenantID    string `json:"tenant_id"`
	}
	if err := json.Unmarshal(payload, &c); err != nil || c.Name == "" {
		return
	}
	raw, _ := json.Marshal(map[string]any{
		"id": id, "name": c.Name, "site": c.Site, "description": c.Description, "tenant_id": c.TenantID,
	})
	_ = f.stores["company"].put(raw)
}

// registerUser folds a CreateUser payload into the by-email store. Caller holds
// f.mu.
func (f *fake) registerUser(payload json.RawMessage, id string) {
	var u struct {
		Email        string `json:"email"`
		Name         string `json:"name"`
		PasswordHash string `json:"password_hash"`
		CompanyID    string `json:"company_id"`
		TenantID     string `json:"tenant_id"`
		Role         string `json:"role"`
	}
	if err := json.Unmarshal(payload, &u); err != nil || u.Email == "" {
		return
	}
	raw, _ := json.Marshal(map[string]any{
		"id": id, "email": u.Email, "name": u.Name, "password_hash": u.PasswordHash,
		"company_id": u.CompanyID, "tenant_id": u.TenantID, "role": u.Role,
	})
	f.users[strings.ToLower(strings.TrimSpace(u.Email))] = raw
}

// updateUserPassword folds an UpdateUserPassword payload into the by-email
// store: it finds the user by id, rewrites password_hash and keeps the rest of
// the projection. Mirrors what the real worker does (idempotent by command_id)
// so a password change is immediately visible to a following login. Caller
// holds f.mu.
func (f *fake) updateUserPassword(payload json.RawMessage) {
	var u struct {
		UserID       string `json:"user_id"`
		PasswordHash string `json:"password_hash"`
	}
	if err := json.Unmarshal(payload, &u); err != nil || u.UserID == "" {
		return
	}
	for email, raw := range f.users {
		var existing map[string]any
		if err := json.Unmarshal(raw, &existing); err != nil {
			continue
		}
		if id, _ := existing["id"].(string); id == u.UserID {
			existing["password_hash"] = u.PasswordHash
			if updated, err := json.Marshal(existing); err == nil {
				f.users[email] = updated
			}
			return
		}
	}
}

// userByEmail serves GET /users/by-email/{email}; unknown e-mail is 404, which
// the BFF's auth slice reads as "no such account".
func (f *fake) userByEmail(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	f.mu.Lock()
	raw, ok := f.users[email]
	f.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (f *fake) seedUser(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.registerUser(raw, idFromRaw(raw))
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func idFromRaw(raw json.RawMessage) string {
	var meta struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &meta)
	if meta.ID == "" {
		return "user-seed"
	}
	return meta.ID
}

func (f *fake) one(collection string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		body, ok := f.stores[collection].byID[r.PathValue("id")]
		f.mu.Unlock()
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

// filterFunc decides whether a seeded record matches a /leads-style query.
type filterFunc func(r *http.Request, raw json.RawMessage) bool

func (f *fake) list(collection string, filter filterFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		s := f.stores[collection]
		matched := make([]json.RawMessage, 0, len(s.order))
		for _, id := range s.order {
			raw := s.byID[id]
			if filter == nil || filter(r, raw) {
				matched = append(matched, raw)
			}
		}
		f.mu.Unlock()

		items, next := paginate(matched, atoi(r.URL.Query().Get("limit")), r.URL.Query().Get("cursor"))
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "next": next})
	}
}

func filterLeads(r *http.Request, raw json.RawMessage) bool {
	var lead struct {
		CampaignID string `json:"campaign_id"`
		Status     string `json:"status"`
		Fit        int    `json:"fit"`
	}
	if err := json.Unmarshal(raw, &lead); err != nil {
		return false
	}
	if v := r.URL.Query().Get("campaign_id"); v != "" && lead.CampaignID != v {
		return false
	}
	if v := r.URL.Query().Get("status"); v != "" && lead.Status != v {
		return false
	}
	if v := r.URL.Query().Get("fit_min"); v != "" {
		if min, err := strconv.Atoi(v); err == nil && lead.Fit < min {
			return false
		}
	}
	return true
}

func paginate(items []json.RawMessage, limit int, cursor string) ([]json.RawMessage, *string) {
	offset := atoi(cursor)
	if offset > len(items) {
		offset = len(items)
	}
	items = items[offset:]
	if limit <= 0 || limit >= len(items) {
		return items, nil
	}
	next := strconv.Itoa(offset + limit)
	return items[:limit], &next
}

func (f *fake) seed(collection string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		err := f.stores[collection].put(raw)
		f.mu.Unlock()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// activity streams agent_run events as SSE. The subscriber registers on
// connect and deregisters when the request context is cancelled (client
// disconnected), so the fake can report how many streams are still open.
func (f *fake) activity(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "no flusher"})
		return
	}
	ch := make(chan json.RawMessage, 32)
	id := f.subscribe(ch)
	defer f.unsubscribe(id)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-ch:
			if _, err := fmt.Fprintf(w, "event: agent\ndata: %s\n\n", ev); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (f *fake) subscribe(ch chan json.RawMessage) int {
	f.activityMu.Lock()
	defer f.activityMu.Unlock()
	f.activitySeq++
	f.activitySubs[f.activitySeq] = ch
	return f.activitySeq
}

func (f *fake) unsubscribe(id int) {
	f.activityMu.Lock()
	delete(f.activitySubs, id)
	f.activityMu.Unlock()
}

func (f *fake) seedActivity(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(r.Body)
	if err != nil || !json.Valid(raw) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid event"})
		return
	}
	f.activityMu.Lock()
	f.activitySeen++
	for _, ch := range f.activitySubs {
		select {
		case ch <- raw:
		default:
		}
	}
	f.activityMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (f *fake) activityConnections(w http.ResponseWriter, _ *http.Request) {
	f.activityMu.Lock()
	n := len(f.activitySubs)
	seen := f.activitySeen
	f.activityMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]int{"count": n, "seen": seen})
}

func (f *fake) listCommands(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.commands == nil {
		f.commands = []recordedCommand{}
	}
	writeJSON(w, http.StatusOK, f.commands)
}

func (f *fake) clearCommands(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	f.commands = nil
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (f *fake) clearState(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	f.commands = nil
	f.users = map[string]json.RawMessage{}
	for _, s := range f.stores {
		s.byID = map[string]json.RawMessage{}
		s.order = nil
	}
	f.mu.Unlock()
	f.activityMu.Lock()
	f.activitySeen = 0
	f.activityMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func atoi(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return n
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
