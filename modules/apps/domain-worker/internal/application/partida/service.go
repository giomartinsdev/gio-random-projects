package partida

import (
	"context"
	"encoding/json"
	"time"

	domainpartida "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/partida"
	domaintotais "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubetotais"
)

// Service is the use case for matches and club totals.
type Service struct {
	repo       domainpartida.Repository
	totaisRepo domaintotais.Repository
}

func NewService(repo domainpartida.Repository, totaisRepo domaintotais.Repository) *Service {
	return &Service{repo: repo, totaisRepo: totaisRepo}
}

// UpsertMatch writes the match and both sides' player lines atomically.
// The match_id unique constraint makes the second side an update, so a match
// between two followed clubs exists exactly once.
func (s *Service) UpsertMatch(ctx context.Context, in UpsertInput) (domainpartida.Partida, *domainpartida.Upserted, error) {
	ts, err := time.Parse(time.RFC3339, in.Timestamp)
	if err != nil {
		// Fall back to "now" rather than rejecting the match: the source
		// occasionally sends an unparseable timestamp, and losing a whole
		// match over it would be worse than an approximate date.
		ts = time.Now().UTC()
	}
	p, err := domainpartida.New(in.MatchID, in.ClubeCasaID, in.ClubeForaID, in.Tipo, in.ResultadoCasa, ts)
	if err != nil {
		return domainpartida.Partida{}, nil, err
	}
	p.RodadaPlayoff = in.RodadaPlayoff
	p.GolsCasa = in.GolsCasa
	p.GolsFora = in.GolsFora
	p.HouveDesistencia = in.HouveDesistencia
	p.VencedorPorDesistenciaID = in.VencedorPorDesistenciaID
	if len(in.Lances) > 0 {
		if b, err := json.Marshal(in.Lances); err == nil {
			p.Lances = b
		}
	}

	linhas := make([]domainpartida.LinhaPartida, 0, len(in.Jogadores))
	for _, l := range in.Jogadores {
		linha := domainpartida.LinhaPartida{
			ClubID: l.ClubID, PlayerID: l.PlayerID, Gamertag: l.Gamertag, Posicao: l.Posicao,
			Nota: l.Nota, Gols: l.Gols, Assistencias: l.Assistencias, Chutes: l.Chutes,
			PassesCertos: l.PassesCertos, PassesTentados: l.PassesTentados,
			DesarmesCertos: l.DesarmesCertos, DesarmesTentados: l.DesarmesTentados,
			Defesas: l.Defesas, SegundosJogados: l.SegundosJogados,
			MelhorEmCampo: l.MelhorEmCampo, CartaoVermelho: l.CartaoVermelho,
			JogoSemSofrerGol: l.JogoSemSofrerGol,
		}
		if len(l.DefesasPorTipo) > 0 {
			if b, err := json.Marshal(l.DefesasPorTipo); err == nil {
				linha.DefesasPorTipo = b
			}
		}
		linhas = append(linhas, linha)
	}

	if _, err := s.repo.UpsertByMatchID(ctx, p, linhas); err != nil {
		return domainpartida.Partida{}, nil, err
	}
	return p, &domainpartida.Upserted{
		MatchID: p.MatchID, CasaID: p.ClubeCasaID, ForaID: p.ClubeForaID,
		GolsCasa: p.GolsCasa, GolsFora: p.GolsFora, OccurredAt: time.Now().UTC(),
	}, nil
}

// UpsertTotais writes a club's all-time totals.
func (s *Service) UpsertTotais(ctx context.Context, in TotaisInput) error {
	return s.totaisRepo.Upsert(ctx, domaintotais.Totais{
		ClubID: in.ClubID, Jogos: in.Jogos, Vitorias: in.Vitorias, Empates: in.Empates,
		Derrotas: in.Derrotas, Gols: in.Gols, GolsSofridos: in.GolsSofridos,
		JogosSemSofrer: in.JogosSemSofrer, Pontos: in.Pontos,
		DivisaoAtual: in.DivisaoAtual, MelhorDivisao: in.MelhorDivisao, Nivel: in.Nivel,
		Promocoes: in.Promocoes, Rebaixamentos: in.Rebaixamentos, LidoEm: time.Now().UTC(),
	})
}
