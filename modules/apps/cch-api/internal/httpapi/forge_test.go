package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/customdecks"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/rooms"
)

// forgeServer wires a Server against a fake AI provider (see the ai
// package's tests for the provider side).
func forgeServer(t *testing.T, providerURL string) *Server {
	t.Helper()
	aiClient := ai.New(providerURL, "", []string{"test/model"})
	s := New(rooms.NewRegistry(nil), []string{"https://cch.test"}, aiClient, customdecks.New(nil))
	return s
}

func postJSON(t *testing.T, s *Server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	return res
}

func getJSON(t *testing.T, s *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	return res
}

func TestGenerateEndpointDisabled(t *testing.T) {
	s := New(rooms.NewRegistry(nil), nil, nil, customdecks.New(nil))
	res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"cah"}`)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled forge should 503, got %d", res.Code)
	}
}

func TestGenerateEndpointFlow(t *testing.T) {
	draft := `{"name":"Forjado","emoji":"🔥","description":"d","whites":["w1","w2"],"blacks":["_ b"]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": draft}}},
		})
	}))
	defer srv.Close()
	s := forgeServer(t, srv.URL)

	res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"cah","theme":"teste"}`)
	if res.Code != http.StatusOK {
		t.Fatalf("generate should succeed, got %d: %s", res.Code, res.Body.String())
	}
	var got struct {
		Draft ai.Draft `json:"draft"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad draft payload: %v", err)
	}
	if got.Draft.Name != "Forjado" || len(got.Draft.Whites) != 2 {
		t.Fatalf("draft wrong: %+v", got.Draft)
	}

	// Unknown parent deck is a 404, not a call to the provider.
	if res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"nao-existe"}`); res.Code != http.StatusNotFound {
		t.Fatalf("unknown parent should 404, got %d", res.Code)
	}

	// The per-IP quota: generationsPerHour succeed, the next one is a 429.
	for i := 1; i < generationsPerHour; i++ {
		if res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"cah"}`); res.Code != http.StatusOK {
			t.Fatalf("generation %d should pass, got %d", i, res.Code)
		}
	}
	if res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"cah"}`); res.Code != http.StatusTooManyRequests {
		t.Fatalf("generation past quota should 429, got %d", res.Code)
	}
}

func TestGenerateEndpointBusy(t *testing.T) {
	draft := `{"name":"F","whites":["w1"],"blacks":["_ b"]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": draft}}},
		})
	}))
	defer srv.Close()
	s := forgeServer(t, srv.URL)

	// A generation already in flight (the slot is held, context
	// cancelled so the fake provider would return anyway -- the busy
	// check happens before the call).
	s.generationSlot <- struct{}{}
	res := postJSON(t, s, "/api/decks/generate", `{"parentDeckId":"cah"}`)
	if res.Code != http.StatusTooManyRequests {
		t.Fatalf("busy forge should 429, got %d", res.Code)
	}
	<-s.generationSlot
}

func TestPublishListGetCustomDeck(t *testing.T) {
	s := forgeServer(t, "http://unused") // provider never called on these paths

	body := `{
		"name":"Deck do Mercado","emoji":"🛒","description":"teste","author":"Zé",
		"whites":["a","b","c","d","e","f","g","h","i","j","k","l"],
		"blacks":["_ um","dois _ _","_ tres","_ quatro"]
	}`
	res := postJSON(t, s, "/api/decks/custom", body)
	if res.Code != http.StatusCreated {
		t.Fatalf("publish should 201, got %d: %s", res.Code, res.Body.String())
	}
	var published customdecks.Deck
	if err := json.Unmarshal(res.Body.Bytes(), &published); err != nil {
		t.Fatalf("bad publish payload: %v", err)
	}
	if !strings.HasPrefix(published.ID, customdecks.IDPrefix) {
		t.Fatalf("server must mint the id, got %q", published.ID)
	}

	// Registered for the game engine immediately.
	if _, ok := decks.Get(published.ID); !ok {
		t.Fatal("published deck not resolvable via decks.Get")
	}

	// Listing is metadata only -- no card texts leak.
	res = getJSON(t, s, "/api/decks/custom")
	var list []customdecks.Info
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil {
		t.Fatalf("bad listing: %v", err)
	}
	if len(list) != 1 || list[0].Whites != 12 || list[0].Blacks != 4 {
		t.Fatalf("listing wrong: %+v", list)
	}

	// Full fetch carries the cards (the Forja's fork flow).
	res = getJSON(t, s, "/api/decks/custom/"+published.ID)
	var full customdecks.Deck
	if err := json.Unmarshal(res.Body.Bytes(), &full); err != nil {
		t.Fatalf("bad full deck: %v", err)
	}
	if len(full.Whites) != 12 {
		t.Fatalf("full deck should carry cards, got %d whites", len(full.Whites))
	}
	if res := getJSON(t, s, "/api/decks/custom/cx-inexistente"); res.Code != http.StatusNotFound {
		t.Fatalf("unknown deck should 404, got %d", res.Code)
	}

	// Rejected publishes say why, in Portuguese, with a 400.
	if res := postJSON(t, s, "/api/decks/custom", `{"name":"","whites":[],"blacks":[]}`); res.Code != http.StatusBadRequest {
		t.Fatalf("invalid publish should 400, got %d", res.Code)
	}
}

func TestAIStatusEndpoint(t *testing.T) {
	s := forgeServer(t, "http://unused")
	res := getJSON(t, s, "/api/ai/status")
	var status struct {
		Configured bool   `json:"configured"`
		Model      string `json:"model"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &status); err != nil {
		t.Fatalf("bad status: %v", err)
	}
	if !status.Configured {
		t.Fatal("forge with a provider URL should report configured")
	}

	s2 := New(rooms.NewRegistry(nil), nil, nil, customdecks.New(nil))
	res = getJSON(t, s2, "/api/ai/status")
	if err := json.Unmarshal(res.Body.Bytes(), &status); err != nil {
		t.Fatalf("bad status: %v", err)
	}
	if status.Configured {
		t.Fatal("forge without a provider should report unconfigured")
	}
}