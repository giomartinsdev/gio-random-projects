package preferencia

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preferencia"
)

// Service is the use case for the per-person writes. Every method takes
// usuario_email and every repository call filters by it.
type Service struct {
	repo domainpref.Repository
}

func NewService(repo domainpref.Repository) *Service {
	return &Service{repo: repo}
}

// SetWatch follows or unfollows a club. Following upgrades an existing
// follow's origem (so a club that starts as "rival" can become "proprio");
// unfollowing deletes the row.
func (s *Service) SetWatch(ctx context.Context, in SetWatchInput) error {
	if !in.Seguindo {
		return s.repo.RemoveWatch(ctx, in.UsuarioEmail, in.ClubID)
	}
	origem := in.Origem
	if origem == "" {
		origem = domainpref.OrigemManual
	}
	e, err := domainpref.NewWatch(in.UsuarioEmail, in.ClubID, origem)
	if err != nil {
		return err
	}
	return s.repo.SetWatchWithOrigem(ctx, e)
}

func (s *Service) SaveNotificacoes(ctx context.Context, in SaveNotificacoesInput) error {
	if in.UsuarioEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	return s.repo.UpsertNotificacoes(ctx, domainpref.Notificacoes{
		UsuarioEmail:      in.UsuarioEmail,
		Canal:             in.Canal,
		ResumoPeriodico:   in.ResumoPeriodico,
		RecordesEDivisoes: in.RecordesEDivisoes,
		ResultadoPartidas: in.ResultadoPartidas,
		AtualizadoEm:      time.Now().UTC(),
	})
}

func (s *Service) ClaimPro(ctx context.Context, in ClaimProInput) error {
	if in.UsuarioEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	if in.PlayerID == "" {
		return domainpref.ErrClubRequired
	}
	if err := s.repo.UpsertClaimed(ctx, domainpref.ProReivindicado{
		UsuarioEmail: in.UsuarioEmail,
		ClubID:       in.ClubID,
		PlayerID:     in.PlayerID,
		Verificado:   in.Verificado,
	}); err != nil {
		return err
	}
	// Reivindicar o pro É dizer onde você joga, então o clube daquele jogador
	// vira um clube PRÓPRIO: é dele que o sync de três níveis parte (o nível 1
	// lê a watchlist com origem "proprio"). Sem esta linha, o login sincroniza
	// a partir de uma watchlist que quase sempre está vazia, e o sync de quem
	// acabou de reivindicar o pro não sai do lugar.
	if in.ClubID == "" {
		return nil
	}
	e, err := domainpref.NewWatch(in.UsuarioEmail, in.ClubID, domainpref.OrigemProprio)
	if err != nil {
		return err
	}
	// SetWatchWithOrigem, não SetWatch: se o clube já era seguido como rival
	// ou manual, o claim precisa SUBIR a origem para "proprio".
	if err := s.repo.SetWatchWithOrigem(ctx, e); err != nil {
		return fmt.Errorf("claim: seguir clube próprio: %w", err)
	}
	return nil
}

func (s *Service) SaveSyncRun(ctx context.Context, in SaveSyncRunInput) error {
	if in.UsuarioEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	run := domainpref.SyncRun{
		UsuarioEmail: in.UsuarioEmail,
		Rodando:      in.Rodando,
		Nivel:        in.Nivel,
		Total:        in.Total,
		Concluidos:   in.Concluidos,
		Atual:        in.Atual,
		Novos:        in.Novos,
		IniciadoEm:   time.Now().UTC(),
	}
	if in.Concluido {
		run.ConcluidoEm = time.Now().UTC()
	}
	return s.repo.UpsertSyncRun(ctx, run)
}

// CommandHandler is what domain-worker calls for this aggregate's actions.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) error {
	switch cmd.Action {
	case application.ActionSetWatch:
		var in SetWatchInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return fmt.Errorf("decode setWatch payload: %w", err)
		}
		return h.service.SetWatch(ctx, in)

	case application.ActionRemoveWatch:
		var in SetWatchInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return fmt.Errorf("decode removeWatch payload: %w", err)
		}
		return h.service.SetWatch(ctx, SetWatchInput{UsuarioEmail: in.UsuarioEmail, ClubID: in.ClubID, Seguindo: false})

	case application.ActionSaveNotify:
		var in SaveNotificacoesInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return fmt.Errorf("decode saveNotificacoes payload: %w", err)
		}
		return h.service.SaveNotificacoes(ctx, in)

	case application.ActionClaimPro:
		var in ClaimProInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return fmt.Errorf("decode claimPro payload: %w", err)
		}
		return h.service.ClaimPro(ctx, in)

	case application.ActionSaveSyncRun:
		var in SaveSyncRunInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return fmt.Errorf("decode saveSyncRun payload: %w", err)
		}
		return h.service.SaveSyncRun(ctx, in)

	default:
		return fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
