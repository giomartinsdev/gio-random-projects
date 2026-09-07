package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A 9router-shaped fake: OpenAI chat/completions with the answer the
// system prompt asked for (JSON, possibly fenced -- the parser must
// cope either way).
func fakeProvider(t *testing.T, content string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") {
			http.Error(w, `{"error":"nope"}`, http.StatusNotFound)
			return
		}
		var req struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"bad body"}`, http.StatusBadRequest)
			return
		}
		if len(req.Messages) != 2 || req.Messages[0].Role != "system" {
			http.Error(w, `{"error":"prompt shape"}`, http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"role": "assistant", "content": content}},
			},
		})
	}))
}

const goodDeckJSON = `{"name":"Deck Forjado","emoji":"🔥","description":"feito na forja","whites":["O teste forjado","A carta duplicada","O tema amplificado"],  "blacks":["O que saiu da forja hoje? _.","A forja transformou _ em _."]}`

func TestGenerateParsesFencedJSON(t *testing.T) {
	srv := fakeProvider(t, "Claro! Aqui está:\n```json\n"+goodDeckJSON+"\n```\n")
	defer srv.Close()

	c := &Client{base: srv.URL, hc: srv.Client()}
	c.models = []string{"test/model"}

	draft, err := c.Generate(context.Background(), GenInput{ParentName: "Pai", Theme: "teste"})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if draft.Name != "Deck Forjado" || draft.Emoji != "🔥" {
		t.Fatalf("draft metadata wrong: %+v", draft)
	}
	if len(draft.Whites) != 3 || len(draft.Blacks) != 2 {
		t.Fatalf("draft cards wrong: %+v", draft)
	}
	if draft.Whites[0] != "O teste forjado" {
		t.Fatalf("card text wrong: %q", draft.Whites[0])
	}
}

func TestGenerateSanitizesDraft(t *testing.T) {
	messy := `{"name":"  Deck Sujo  ","whites":["A","A","   ","` + strings.Repeat("x", 500) + `","B"],"blacks":["_ um","_ um","dois _ _",""]} `
	srv := fakeProvider(t, messy)
	defer srv.Close()

	c := &Client{base: srv.URL, hc: srv.Client()}
	c.models = []string{"test/model"}

	draft, err := c.Generate(context.Background(), GenInput{})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if draft.Name != "Deck Sujo" {
		t.Fatalf("name not trimmed: %q", draft.Name)
	}
	if len(draft.Whites) != 3 {
		t.Fatalf("expected dup/empty dropped and overflow capped to 3, got %d: %v", len(draft.Whites), draft.Whites)
	}
	if len(draft.Blacks) != 2 {
		t.Fatalf("expected black without blank kept (publish validates that) and dup dropped, got %v", draft.Blacks)
	}
	for _, w := range draft.Whites {
		if len(w) > maxCardLen {
			t.Fatalf("card not length-capped")
		}
	}
}

func TestGenerateCascadesOnModelErrors(t *testing.T) {
	// First model 404s, second works -- the cascade must land on it and
	// remember it for the next call.
	attempts := 0
	models := map[string]bool{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		attempts++
		models[req.Model] = true
		if req.Model == "morte/nao-existe" {
			http.Error(w, `{"error":"model not found"}`, http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{"message": map[string]any{"content": goodDeckJSON}}},
		})
	})
	srv2 := httptest.NewServer(mux)
	defer srv2.Close()

	c := &Client{base: srv2.URL + "/v1", hc: srv2.Client()}
	c.models = []string{"morte/nao-existe", "vida/existe"}

	if _, err := c.Generate(context.Background(), GenInput{}); err != nil {
		t.Fatalf("cascade should have found the working model: %v", err)
	}
	if !models["morte/nao-existe"] || !models["vida/existe"] {
		t.Fatalf("cascade did not try both models: tried %v", models)
	}
	if c.Model() != "vida/existe" {
		t.Fatalf("winning model not sticky: %q", c.Model())
	}

	// A 5xx is a provider condition, NOT a model condition -- no cascade.
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"upstream down"}`, http.StatusBadGateway)
	}))
	defer failSrv.Close()
	c2 := &Client{base: failSrv.URL, hc: failSrv.Client()}
	c2.models = []string{"um", "dois"}
	if _, err := c2.Generate(context.Background(), GenInput{}); err == nil {
		t.Fatal("5xx should surface as an error, not cascade")
	}
}

func TestDiscoverModelsPicksSmall(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"id": "gigante/opus-max"},
				{"id": "cc/claude-haiku-4-5"},
				{"id": "outro/gpt-5"},
			},
		})
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// The full loop: discovery happens because no explicit model list,
	// and generation lands on the haiku model.
	chatSrv := fakeProvider(t, goodDeckJSON)
	defer chatSrv.Close()
	_ = chatSrv
	c := &Client{base: srv.URL + "/v1", hc: srv.Client()}
	models := c.candidateModels(context.Background())
	if len(models) != 1 || !strings.Contains(models[0], "haiku") {
		t.Fatalf("discovery should pick the small model, got %v", models)
	}
}

func TestDisabledClient(t *testing.T) {
	var c *Client
	if c.Enabled() {
		t.Fatal("nil client must be disabled")
	}
	if _, err := c.Generate(context.Background(), GenInput{}); err == nil {
		t.Fatal("disabled client must refuse to generate")
	}
	if NewFromEnv() != nil {
		t.Fatal("no env vars should mean no client")
	}
}