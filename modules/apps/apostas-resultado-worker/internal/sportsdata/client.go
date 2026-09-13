// Package sportsdata looks up real match results for the resolver
// worker -- same enxuto shape as proventos-worker's own
// internal/fundamentus (single bounded http.Client, no retry library,
// ErrNotFound when nothing turns up, never returns a value it isn't
// sure about). Source is TheSportsDB (thesportsdb.com), a free public
// scores API -- no signup needed for the "3" test key tier this client
// defaults to.
//
// Scope today is football/soccer only, matching what the aposta
// descriptions seen so far actually bet on ("Real Madrid vence",
// "Over 2.5 gols") -- other sports are a future extension of this
// client, not built speculatively now.
package sportsdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultBaseURL = "https://www.thesportsdb.com/api/v1/json/3"

// ErrNotFound means no finished match between the two teams turned up
// in the searched date window -- not an error worth aborting a cycle
// over, just "try again tomorrow".
var ErrNotFound = errors.New("sportsdata: nenhum jogo encontrado")

type Client struct {
	base string
	hc   *http.Client
}

// New builds a client against a TheSportsDB-compatible root (already
// including the API key path segment, e.g.
// https://www.thesportsdb.com/api/v1/json/<key>).
func New(baseURL string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = defaultBaseURL
	}
	return &Client{base: base, hc: &http.Client{Timeout: 15 * time.Second}}
}

// NewFromEnv reads APOSTAS_RESULTADO_WORKER_SPORTSDATA_BASE_URL, or
// falls back to the free public tier.
func NewFromEnv() *Client {
	return New(os.Getenv("APOSTAS_RESULTADO_WORKER_SPORTSDATA_BASE_URL"))
}

// Placar is a finished match's final score.
type Placar struct {
	TimeCasa, TimeFora string
	GolsCasa, GolsFora int
	Data               time.Time
}

type eventsDayResponse struct {
	Events []struct {
		StrHomeTeam  string  `json:"strHomeTeam"`
		StrAwayTeam  string  `json:"strAwayTeam"`
		IntHomeScore *string `json:"intHomeScore"`
		IntAwayScore *string `json:"intAwayScore"`
		StrStatus    string  `json:"strStatus"`
	} `json:"events"`
}

// BuscarPlacar looks for a finished football match between the two
// named teams (matched case-insensitively, by substring both ways --
// same tolerant matching the apostas-api extension already uses to
// pair an AI-read casa name against a conta), searching day by day
// starting at desde, up to janelaDias ahead (a bet is usually placed
// before the match, not the same day it's registered). Returns
// ErrNotFound if nothing finished turns up in the window -- callers
// should leave the aposta pending and retry the next daily cycle
// rather than treat this as a hard failure.
func (c *Client) BuscarPlacar(ctx context.Context, timeA, timeB string, desde time.Time, janelaDias int) (Placar, error) {
	for i := 0; i <= janelaDias; i++ {
		dia := desde.AddDate(0, 0, i)
		if dia.After(time.Now()) {
			break // no placing a bet on a game that hasn't happened yet
		}
		eventos, err := c.eventsDay(ctx, dia)
		if err != nil {
			continue // one bad day's lookup shouldn't stop the search
		}
		for _, e := range eventos.Events {
			if !timesBatem(e.StrHomeTeam, e.StrAwayTeam, timeA, timeB) {
				continue
			}
			if e.IntHomeScore == nil || e.IntAwayScore == nil {
				continue // listed but not finished yet
			}
			golsCasa, errA := strconv.Atoi(*e.IntHomeScore)
			golsFora, errB := strconv.Atoi(*e.IntAwayScore)
			if errA != nil || errB != nil {
				continue
			}
			return Placar{
				TimeCasa: e.StrHomeTeam, TimeFora: e.StrAwayTeam,
				GolsCasa: golsCasa, GolsFora: golsFora, Data: dia,
			}, nil
		}
	}
	return Placar{}, ErrNotFound
}

func (c *Client) eventsDay(ctx context.Context, dia time.Time) (eventsDayResponse, error) {
	url := fmt.Sprintf("%s/eventsday.php?d=%s&s=Soccer", c.base, dia.Format("2006-01-02"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return eventsDayResponse{}, err
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return eventsDayResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return eventsDayResponse{}, fmt.Errorf("sportsdata: status %d", res.StatusCode)
	}
	var out eventsDayResponse
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return eventsDayResponse{}, err
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
