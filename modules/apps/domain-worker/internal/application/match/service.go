package partida

import (
	"context"
	"encoding/json"
	"time"

	domainmatch "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/match"
	domainclubtotals "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubtotals"
)

// Service is the use case for matches and club totals.
type Service struct {
	repo       domainmatch.Repository
	totaisRepo domainclubtotals.Repository
}

func NewService(repo domainmatch.Repository, totaisRepo domainclubtotals.Repository) *Service {
	return &Service{repo: repo, totaisRepo: totaisRepo}
}

// UpsertMatch writes the match and both sides' player lines atomically.
// The match_id unique constraint makes the second side an update, so a match
// between two followed clubs exists exactly once.
func (s *Service) UpsertMatch(ctx context.Context, in UpsertInput) (domainmatch.Partida, *domainmatch.Upserted, error) {
	ts, err := time.Parse(time.RFC3339, in.Timestamp)
	if err != nil {
		// Fall back to "now" rather than rejecting the match: the source
		// occasionally sends an unparseable timestamp, and losing a whole
		// match over it would be worse than an approximate date.
		ts = time.Now().UTC()
	}
	p, err := domainmatch.New(in.MatchID, in.ClubeCasaID, in.ClubeForaID, in.Kind, in.HomeResult, ts)
	if err != nil {
		return domainmatch.Partida{}, nil, err
	}
	p.PlayoffRound = in.PlayoffRound
	p.HomeGoals = in.HomeGoals
	p.AwayGoals = in.AwayGoals
	p.DecidedByForfeit = in.DecidedByForfeit
	p.VencedorPorDesistenciaID = in.VencedorPorDesistenciaID
	if len(in.Events) > 0 {
		if b, err := json.Marshal(in.Events); err == nil {
			p.Events = b
		}
	}

	linhas := make([]domainmatch.LinhaPartida, 0, len(in.Players))
	for _, l := range in.Players {
		linha := domainmatch.LinhaPartida{
			ClubID: l.ClubID, PlayerID: l.PlayerID, Gamertag: l.Gamertag, Position: l.Position,
			Rating: l.Rating, Goals: l.Goals, Assists: l.Assists, Shots: l.Shots,
			PassesMade: l.PassesMade, PassesAttempted: l.PassesAttempted,
			TacklesMade: l.TacklesMade, TacklesAttempted: l.TacklesAttempted,
			Saves: l.Saves, SecondsPlayed: l.SecondsPlayed,
			ManOfTheMatch: l.ManOfTheMatch, RedCard: l.RedCard,
			CleanSheet: l.CleanSheet,
		}
		if len(l.SavesByType) > 0 {
			if b, err := json.Marshal(l.SavesByType); err == nil {
				linha.SavesByType = b
			}
		}
		linhas = append(linhas, linha)
	}

	if _, err := s.repo.UpsertByMatchID(ctx, p, linhas); err != nil {
		return domainmatch.Partida{}, nil, err
	}
	return p, &domainmatch.Upserted{
		MatchID: p.MatchID, CasaID: p.ClubeCasaID, ForaID: p.ClubeForaID,
		HomeGoals: p.HomeGoals, AwayGoals: p.AwayGoals, OccurredAt: time.Now().UTC(),
	}, nil
}

// UpsertTotais writes a club's all-time totals.
func (s *Service) UpsertTotais(ctx context.Context, in TotaisInput) error {
	return s.totaisRepo.Upsert(ctx, domainclubtotals.Totais{
		ClubID: in.ClubID, Played: in.Played, Wins: in.Wins, Draws: in.Draws,
		Losses: in.Losses, Goals: in.Goals, GoalsConceded: in.GoalsConceded,
		CleanSheets: in.CleanSheets, Points: in.Points,
		Division: in.Division, BestDivision: in.BestDivision, SkillRating: in.SkillRating,
		Promotions: in.Promotions, Relegations: in.Relegations, ReadAt: time.Now().UTC(),
	})
}
