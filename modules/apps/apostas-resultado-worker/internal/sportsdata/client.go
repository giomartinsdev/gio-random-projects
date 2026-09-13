// Package sportsdata looks up real match results for the resolver
// worker -- same enxuto shape as proventos-worker's own
// internal/fundamentus (single bounded http.Client, no retry library,
// ErrNotFound when nothing turns up, never returns a value it isn't
// sure about). Source is BSD's Sports Data API
// (sports.bzzoiro.com/docs/football/) -- 30+ leagues, a free football
// tier, and a plain token header, so no scraping is needed here.
//
// Scope today is football/soccer only, matching what the aposta
// descriptions seen so far actually bet on ("Real Madrid vence",
// "Over 2.5 gols") -- other sports this API also covers (tennis,
// basketball, ...) are a future extension of this client, not built
// speculatively now.
package sportsdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultBaseURL = "https://sports.bzzoiro.com/api/v2"

// ErrNotFound means no finished match between the two teams turned up
// in the searched date window -- not an error worth aborting a cycle
// over, just "try again tomorrow".
var ErrNotFound = errors.New("sportsdata: nenhum jogo encontrado")

type Client struct {
	base string
	key  string
	hc   *http.Client
}

// New builds a client against a BSD-compatible root (e.g.
// https://sports.bzzoiro.com/api/v2). An empty base URL falls back to
// the real one -- there's only ever the one BSD deployment, unlike
// TheSportsDB's key-in-path convention this replaced.
func New(baseURL, apiKey string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	return &Client{base: base, key: strings.TrimSpace(apiKey), hc: &http.Client{Timeout: 15 * time.Second}}
}

// NewFromEnv reads APOSTAS_RESULTADO_WORKER_SPORTSDATA_BASE_URL and
// APOSTAS_RESULTADO_WORKER_SPORTSDATA_API_KEY -- the free football tier
// still requires a registered token (unlike TheSportsDB's public test
// key), see this repo's Terraform for where the real key comes from.
func NewFromEnv() *Client {
	return New(os.Getenv("APOSTAS_RESULTADO_WORKER_SPORTSDATA_BASE_URL"), os.Getenv("APOSTAS_RESULTADO_WORKER_SPORTSDATA_API_KEY"))
}

// Placar is a finished match's final score.
type Placar struct {
	TimeCasa, TimeFora string
	GolsCasa, GolsFora int
	Data               time.Time
}

type eventsResponse struct {
	Results []struct {
		HomeTeam  string `json:"home_team"`
		AwayTeam  string `json:"away_team"`
		Status    string `json:"status"`
		HomeScore *int   `json:"home_score"`
		AwayScore *int   `json:"away_score"`
		EventDate string `json:"event_date"`
	} `json:"results"`
}

// BuscarPlacar looks for a finished football match between the two
// named teams (matched case-insensitively, by substring both ways --
// same tolerant matching the apostas-api extension already uses to
// pair an AI-read casa name against a conta), searching a date window
// starting at desde and running janelaDias ahead (a bet is usually
// placed before the match, not the same day it's registered). Returns
// ErrNotFound if nothing finished turns up in the window -- callers
// should leave the aposta pending and retry the next daily cycle
// rather than treat this as a hard failure.
func (c *Client) BuscarPlacar(ctx context.Context, timeA, timeB string, desde time.Time, janelaDias int) (Placar, error) {
	ate := desde.AddDate(0, 0, janelaDias)
	if hoje := time.Now(); ate.After(hoje) {
		ate = hoje // no placing a bet on a game that hasn't happened yet
	}
	if ate.Before(desde) {
		return Placar{}, ErrNotFound
	}

	eventos, err := c.events(ctx, timeA, desde, ate)
	if err != nil {
		return Placar{}, err
	}
	for _, e := range eventos.Results {
		if e.Status != "finished" {
			continue
		}
		if !timesBatem(e.HomeTeam, e.AwayTeam, timeA, timeB) {
			continue
		}
		if e.HomeScore == nil || e.AwayScore == nil {
			continue
		}
		data, _ := time.Parse(time.RFC3339, e.EventDate)
		return Placar{
			TimeCasa: e.HomeTeam, TimeFora: e.AwayTeam,
			GolsCasa: *e.HomeScore, GolsFora: *e.AwayScore, Data: data,
		}, nil
	}
	return Placar{}, ErrNotFound
}

func (c *Client) events(ctx context.Context, teamName string, desde, ate time.Time) (eventsResponse, error) {
	q := url.Values{}
	q.Set("team_name", teamName)
	q.Set("status", "finished")
	q.Set("date_from", desde.Format("2006-01-02"))
	q.Set("date_to", ate.Format("2006-01-02"))
	q.Set("limit", "50")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/events/?"+q.Encode(), nil)
	if err != nil {
		return eventsResponse{}, err
	}
	if c.key != "" {
		req.Header.Set("Authorization", "Token "+c.key)
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return eventsResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return eventsResponse{}, fmt.Errorf("sportsdata: status %d", res.StatusCode)
	}
	var out eventsResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return eventsResponse{}, err
	}
	return out, nil
}

// timesBatem checks the two real team names against the two names the
// AI extracted from a bet's freeform descrição -- exact match first,
// then substring both directions, case-insensitive, in either
// home/away order (a descrição rarely says which side is "home").
func timesBatem(homeReal, awayReal, timeA, timeB string) bool {
	return (nomeBate(homeReal, timeA) && nomeBate(awayReal, timeB)) ||
		(nomeBate(homeReal, timeB) && nomeBate(awayReal, timeA))
}

func nomeBate(real, lido string) bool {
	real, lido = strings.ToLower(strings.TrimSpace(real)), strings.ToLower(strings.TrimSpace(lido))
	if real == "" || lido == "" {
		return false
	}
	return real == lido || strings.Contains(real, lido) || strings.Contains(lido, real)
}
