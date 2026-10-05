package finance

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
)

// CommandHandler é o que o domain-worker chama para cada application.Command
// da família finance.*. Devolve uma LISTA de eventos: um comando de orçamento
// pode cruzar várias réguas de uma vez (50 e 80 num só gasto), e cada régua é
// um evento próprio para o worker conversacional avisar.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) ([]domainfinance.Event, error) {
	switch cmd.Action {
	case application.ActionRegisterTransaction:
		var in RegisterTransactionInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode register transaction: %w", err)
		}
		_, evt, err := h.service.RegisterTransaction(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionCategorizeTransaction:
		var in CategorizeTransactionInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode categorize transaction: %w", err)
		}
		evt, err := h.service.Categorize(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionUpdateTransaction:
		var in UpdateTransactionInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode update transaction: %w", err)
		}
		evt, err := h.service.UpdateTransaction(ctx, in)
		if err != nil {
			return nil, err
		}
		// Sem mudança efetiva devolve nil (no-op) — processo aceita zero eventos.
		if evt == nil {
			return nil, nil
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionRemoveTransaction:
		var in RemoveTransactionInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode remove transaction: %w", err)
		}
		evt, err := h.service.RemoveTransaction(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionSetTransactionActive:
		var in SetTransactionActiveInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode set transaction active: %w", err)
		}
		evt, err := h.service.SetTransactionActive(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionTransferBetweenAccounts:
		var in TransferBetweenAccountsInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode transfer: %w", err)
		}
		_, evt, err := h.service.Transfer(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionSetCategoryBudget:
		var in SetCategoryBudgetInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode set budget: %w", err)
		}
		_, events, err := h.service.SetCategoryBudget(ctx, in)
		if err != nil {
			return nil, err
		}
		return events, nil

	case application.ActionOFConsentCreated:
		var in ConsentCreatedInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode consent created: %w", err)
		}
		_, evt, err := h.service.UpsertConsent(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionOFConsentUpdated:
		var in ConsentUpdatedInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode consent updated: %w", err)
		}
		evt, err := h.service.UpdateConsentStatus(ctx, in)
		if err != nil {
			return nil, err
		}
		return []domainfinance.Event{evt}, nil

	case application.ActionOFConsentRemoved:
		var in ConsentUpdatedInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode consent removed: %w", err)
		}
		if err := h.service.RemoveConsent(ctx, in.PolpConsentID); err != nil {
			return nil, err
		}
		return nil, nil

	case application.ActionNotifSet:
		var in NotificationInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode notif set: %w", err)
		}
		if err := h.service.SetNotification(ctx, in); err != nil {
			return nil, err
		}
		return nil, nil

	case application.ActionNotifDelete:
		var in NotificationDeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode notif delete: %w", err)
		}
		if err := h.service.DeleteNotification(ctx, in); err != nil {
			return nil, err
		}
		return nil, nil

	case application.ActionOFAccountSynced:
		var in AccountSyncedInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode account synced: %w", err)
		}
		// A conta é dado de apoio; não gera evento. Devolve lista vazia (o
		// process() aceita zero eventos sem publicar).
		if err := h.service.SyncAccount(ctx, in); err != nil {
			return nil, err
		}
		return nil, nil

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
