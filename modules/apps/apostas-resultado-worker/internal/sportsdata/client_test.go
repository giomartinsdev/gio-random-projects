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
		golsCasa, golsFora := "2", "1"
		_ = json.NewEncoder(w).Encode(map[string]any{
			"events": []map[string]any{
				{
					"strHomeTeam":  "Real Madrid",
					"strAwayTeam":  "Barcelona",
					"intHomeScore": &golsCasa,
					"intAwayScore": &golsFora,
					"strStatus":    "Match Finished",
				},
			},
		})
	}))
	defer srv.Close()

	c := New(srv.URL)
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
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []map[string]any{}})
	}))
	defer srv.Close()

	c := New(srv.URL)
	_, err := c.BuscarPlacar(context.Background(), "Flamengo", "Vasco", time.Now().AddDate(0, 0, -3), 4)
	if err != ErrNotFound {
		t.Fatalf("esperava ErrNotFound, deu: %v", err)
	}
}

func TestBuscarPlacarIgnoraJogoNaoFinalizado(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"events": []map[string]any{
				{
					"strHomeTeam":  "Real Madrid",
					"strAwayTeam":  "Barcelona",
					"intHomeScore": nil,
					"intAwayScore": nil,
					"strStatus":    "Not Started",
				},
			},
		})
	}))
	defer srv.Close()

	c := New(srv.URL)
	_, err := c.BuscarPlacar(context.Background(), "Real Madrid", "Barcelona", time.Now().AddDate(0, 0, -3), 4)
	if err != ErrNotFound {
		t.Fatalf("esperava ErrNotFound pro jogo ainda não finalizado, deu: %v", err)
	}
}
