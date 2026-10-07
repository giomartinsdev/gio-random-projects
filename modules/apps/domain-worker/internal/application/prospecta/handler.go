package prospecta

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
)

// CommandHandler é o que o domain-worker chama para cada application.Command
// da família Prospecta. Devolve zero ou um evento: uma reentrega idempotente
// devolve nil sem publicar de novo.
//
// Além de aplicar o comando, grava a auditoria do Prospecta
// (prospecta_audit_log, data-model §8) com o payload passado por PII scrubbing —
// sucesso OU falha. Um comando sem tenant_id não vira linha (a tabela é
// multi-tenant com RLS); ele continua auditado no audit_log genérico do
// worker, que o process() grava incondicionalmente.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainprospecta.Event, error) {
	evt, tenant, err := h.dispatch(ctx, cmd)
	h.service.RecordAudit(ctx, tenant, string(cmd.Action), cmd.Payload, err)
	return evt, err
}

// dispatch roteia o comando e devolve o evento e o tenant (para a auditoria).
// O tenant sai do próprio payload — os comandos do contrato o carregam.
func (h *CommandHandler) dispatch(ctx context.Context, cmd application.Command) (domainprospecta.Event, string, error) {
	switch cmd.Action {
	case application.ActionCreateCompany:
		var in CreateCompanyInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode create company payload: %w", err)
		}
		_, evt, err := h.service.CreateCompany(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionDefineICP:
		var in DefineICPInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode define icp payload: %w", err)
		}
		_, evt, err := h.service.DefineICP(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionCreateCampaign:
		var in CreateCampaignInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode create campaign payload: %w", err)
		}
		evt, err := h.service.CreateCampaign(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionStartCampaign:
		var in StartCampaignInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode start campaign payload: %w", err)
		}
		evt, err := h.service.StartCampaign(ctx, in)
		return evt, in.TenantID, err

	case application.ActionRequestProspect:
		var in RequestProspectInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode request prospect payload: %w", err)
		}
		evt, err := h.service.RequestProspect(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionUpsertLead:
		var in UpsertLeadInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode upsert lead payload: %w", err)
		}
		evt, err := h.service.UpsertLead(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionQualifyLead:
		var in QualifyLeadInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode qualify lead payload: %w", err)
		}
		evt, err := h.service.QualifyLead(ctx, in)
		return evt, in.TenantID, err

	case application.ActionDraftMessage:
		var in DraftMessageInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode draft message payload: %w", err)
		}
		evt, err := h.service.DraftMessage(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionApproveMessage:
		var in ApproveMessageInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode approve message payload: %w", err)
		}
		evt, err := h.service.ApproveMessage(ctx, in)
		return evt, in.TenantID, err

	case application.ActionSendMessage:
		var in SendMessageInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode send message payload: %w", err)
		}
		evt, err := h.service.SendMessage(ctx, in)
		return evt, in.TenantID, err

	case application.ActionReceiveReply:
		var in ReceiveReplyInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode receive reply payload: %w", err)
		}
		evt, err := h.service.ReceiveReply(ctx, cmd.ID, in)
		return evt, in.TenantID, err

	case application.ActionBookMeeting:
		var in BookMeetingInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, "", fmt.Errorf("decode book meeting payload: %w", err)
		}
		evt, err := h.service.BookMeeting(ctx, in)
		return evt, in.TenantID, err

	default:
		return nil, "", fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
