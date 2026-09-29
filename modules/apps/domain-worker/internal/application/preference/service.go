package preferencia

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preference"
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
		return s.repo.RemoveWatch(ctx, in.UserEmail, in.ClubID)
	}
	source := in.Source
	if source == "" {
		source = domainpref.OrigemManual
	}
	e, err := domainpref.NewWatch(in.UserEmail, in.ClubID, source)
	if err != nil {
		return err
	}
	return s.repo.SetWatchWithOrigem(ctx, e)
}

func (s *Service) SaveNotificacoes(ctx context.Context, in SaveNotificacoesInput) error {
	if in.UserEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	return s.repo.UpsertNotificacoes(ctx, domainpref.Notificacoes{
		UserEmail:      in.UserEmail,
		Channel:             in.Channel,
		WeeklyDigest:   in.WeeklyDigest,
		RecordsAndDivisions: in.RecordsAndDivisions,
		MatchResults: in.MatchResults,
		Publico:      in.Publico,
		PublicHandle: strings.ToLower(strings.TrimSpace(in.PublicHandle)),
		UpdatedAt:      time.Now().UTC(),
	})
}

func (s *Service) ClaimPro(ctx context.Context, in ClaimProInput) error {
	if in.UserEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	if in.PlayerID == "" {
		return domainpref.ErrClubRequired
	}
	if err := s.repo.UpsertClaimed(ctx, domainpref.ProReivindicado{
		UserEmail: in.UserEmail,
		ClubID:       in.ClubID,
		PlayerID:     in.PlayerID,
		Verified:   in.Verified,
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
	e, err := domainpref.NewWatch(in.UserEmail, in.ClubID, domainpref.OrigemProprio)
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
	if in.UserEmail == "" {
		return domainpref.ErrUsuarioRequired
	}
	run := domainpref.SyncRun{
		UserEmail: in.UserEmail,
		Running:      in.Running,
		SkillRating:        in.SkillRating,
		Total:        in.Total,
		Completed:   in.Completed,
		Current:        in.Current,
		NewItems:        in.NewItems,
		StartedAt:   time.Now().UTC(),
	}
	if in.Concluido {
		run.FinishedAt = time.Now().UTC()
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
		return h.service.SetWatch(ctx, SetWatchInput{UserEmail: in.UserEmail, ClubID: in.ClubID, Seguindo: false})

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
