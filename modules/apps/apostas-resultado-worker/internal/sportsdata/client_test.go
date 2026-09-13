package sportsdata

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBuscarPlacarEncontraJogoFinalizado(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		golsCasa, golsFora := 2, 1
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{
					"home_team":  "Real Madrid",
					"away_team":  "Barcelona",
					"status":     "finished",
					"home_score": &golsCasa,
					"away_score": &golsFora,
					"event_date": time.Now().Format(time.RFC3339),
				},
			},
		})
	}))
	defer srv.Close()

	c := New(srv.URL, "chave-teste")
	placar, err := c.BuscarPlacar(context.Background(), "real madrid", "barcelona", time.Now().AddDate(0, 0, -3), 4)
	if err != nil {
		t.Fatalf("esperava achar o jogo, deu erro: %v", err)
	}
	if placar.GolsCasa != 2 || placar.GolsFora != 1 {
		t.Fatalf("placar errado: %+v", placar)
	}
}

func TestBuscarPlacarNaoEncontrado(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []map[string]any{}})
	}))
	defer srv.Close()

	c := New(srv.URL, "chave-teste")
	_, err := c.BuscarPlacar(context.Background(), "Flamengo", "Vasco", time.Now().AddDate(0, 0, -3), 4)
	if err != ErrNotFound {
		t.Fatalf("esperava ErrNotFound, deu: %v", err)
	}
}

func TestBuscarPlacarIgnoraJogoNaoFinalizado(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{
					"home_team":  "Real Madrid",
					"away_team":  "Barcelona",
					"status":     "upcoming",
					"home_score": nil,
					"away_score": nil,
					"event_date": time.Now().Format(time.RFC3339),
				},
			},
		})
	}))
	defer srv.Close()

	c := New(srv.URL, "chave-teste")
	_, err := c.BuscarPlacar(context.Background(), "Real Madrid", "Barcelona", time.Now().AddDate(0, 0, -3), 4)
	if err != ErrNotFound {
		t.Fatalf("esperava ErrNotFound pro jogo ainda não finalizado, deu: %v", err)
	}
}

func TestBuscarPlacarEnviaToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token chave-teste" {
			t.Errorf("esperava header Authorization com o token, veio: %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []map[string]any{}})
	}))
	defer srv.Close()

	c := New(srv.URL, "chave-teste")
	_, _ = c.BuscarPlacar(context.Background(), "A", "B", time.Now(), 1)
}
