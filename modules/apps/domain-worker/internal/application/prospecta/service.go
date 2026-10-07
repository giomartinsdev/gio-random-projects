package prospecta

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
)

// Service é o caso de uso -- a única coisa que chama os métodos de escrita do
// repositório, então toda mutação passa pelas invariantes do agregado.
type Service struct {
	repo domainprospecta.Repository
	now  func() time.Time
}

func NewService(repo domainprospecta.Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// CreateCompany valida e grava a empresa. O id (UUIDv7) é gerado AQUI -- quem
// aplica escolhe o id; a ACL nunca manda id (§4.1). Idempotente pelo
// command_id: a reentrega at-least-once não duplica a linha.
func (s *Service) CreateCompany(ctx context.Context, commandID string, in CreateCompanyInput) (domainprospecta.Company, domainprospecta.Event, error) {
	if in.TenantID == "" {
		return domainprospecta.Company{}, nil, domainprospecta.ErrTenantIDRequired
	}
	if in.Name == "" {
		return domainprospecta.Company{}, nil, domainprospecta.ErrNameRequired
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return domainprospecta.Company{}, nil, err
	}
	c, err := domainprospecta.NewCompany(id.String(), in.TenantID, in.Name, in.Site, in.Description)
	if err != nil {
		return domainprospecta.Company{}, nil, err
	}
	inserted, err := s.repo.InsertCompany(ctx, c, commandID)
	if err != nil {
		return domainprospecta.Company{}, nil, err
	}
	// Reentrega do MESMO comando: a linha já existe com o mesmo id. Não publica
	// evento de novo (seria um duplicado lógico para o consumidor).
	if !inserted {
		return c, nil, nil
	}
	c.CreatedAt = s.now()
	return c, domainprospecta.CompanyRegistered{
		CompanyID:  c.ID,
		TenantID:   c.TenantID,
		Name:       c.Name,
		Site:       c.Site,
		OccurredAt: c.CreatedAt,
	}, nil
}

// DefineICP valida e grava o ICP de uma empresa existente. A empresa precisa
// existir NO MESMO tenant, senão ErrNotFound -- um ICP órfão não qualifica nada.
func (s *Service) DefineICP(ctx context.Context, commandID string, in DefineICPInput) (domainprospecta.ICP, domainprospecta.Event, error) {
	if in.TenantID == "" {
		return domainprospecta.ICP{}, nil, domainprospecta.ErrTenantIDRequired
	}
	if in.CompanyID == "" {
		return domainprospecta.ICP{}, nil, domainprospecta.ErrCompanyIDRequired
	}
	if in.Definition == "" {
		return domainprospecta.ICP{}, nil, domainprospecta.ErrDefinitionRequired
	}
	exists, err := s.repo.CompanyExists(ctx, in.TenantID, in.CompanyID)
	if err != nil {
		return domainprospecta.ICP{}, nil, err
	}
	if !exists {
		return domainprospecta.ICP{}, nil, fmt.Errorf("%w: company %s", domainprospecta.ErrNotFound, in.CompanyID)
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return domainprospecta.ICP{}, nil, err
	}
	icp, err := domainprospecta.NewICP(id.String(), in.TenantID, in.CompanyID, in.Definition, in.Signals)
	if err != nil {
		return domainprospecta.ICP{}, nil, err
	}
	inserted, err := s.repo.InsertICP(ctx, icp, commandID)
	if err != nil {
		return domainprospecta.ICP{}, nil, err
	}
	if !inserted {
		return icp, nil, nil
	}
	icp.CreatedAt = s.now()
	return icp, domainprospecta.ICPDefined{
		ICPID:      icp.ID,
		CompanyID:  icp.CompanyID,
		TenantID:   icp.TenantID,
		Definition: icp.Definition,
		Signals:    icp.Signals,
		OccurredAt: icp.CreatedAt,
	}, nil
}

// CreateCampaign grava a campanha em draft. Sem evento: o contrato só publica
// CampaignStarted, que é o StartCampaign (§7.1).
func (s *Service) CreateCampaign(ctx context.Context, commandID string, in CreateCampaignInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.CompanyID == "" {
		return nil, domainprospecta.ErrCompanyIDRequired
	}
	if in.Name == "" {
		return nil, domainprospecta.ErrNameRequired
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	// O ICP é por empresa e não vem no corpo público (a API não o conhece); o
	// dono do banco o deriva da empresa, na mesma sessão do comando -- a fila
	// preserva a ordem, então o DefineICP da empresa já foi aplicado antes.
	// Sem ICP definido, a campanha nasce sem ele e o Start a recusa (o usuário
	// precisa descrever o cliente ideal primeiro).
	icpID := in.ICPID
	if icpID == "" {
		if icp, err := s.repo.FindICPByCompany(ctx, in.TenantID, in.CompanyID); err == nil {
			icpID = icp.ID
		} else if !errors.Is(err, domainprospecta.ErrNotFound) {
			return nil, err
		}
	}
	c, err := domainprospecta.NewCampaign(id.String(), in.TenantID, in.CompanyID, icpID, in.Name, in.Channels, in.ApprovalPolicy)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.InsertCampaign(ctx, c, commandID); err != nil {
		return nil, err
	}
	return nil, nil
}

// StartCampaign liga a campanha (draft → running). Exige ICP e que ela ainda
// esteja em draft; um Start repetido é no-op silencioso (sem segundo evento).
func (s *Service) StartCampaign(ctx context.Context, in StartCampaignInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.CampaignID == "" {
		return nil, domainprospecta.ErrCampaignIDRequired
	}
	current, err := s.repo.FindCampaign(ctx, in.TenantID, in.CampaignID)
	if err != nil {
		return nil, err
	}
	if current.Status == domainprospecta.CampaignRunning {
		return nil, nil
	}
	next, err := current.Start()
	if err != nil {
		return nil, err
	}
	changed, err := s.repo.SetCampaignStatus(ctx, in.TenantID, current.ID, domainprospecta.CampaignDraft, domainprospecta.CampaignRunning)
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, nil
	}
	return domainprospecta.CampaignStarted{
		CampaignID: next.ID,
		CompanyID:  next.CompanyID,
		ICPID:      next.ICPID,
		TenantID:   next.TenantID,
		Name:       next.Name,
		Channels:   next.Channels,
		OccurredAt: s.now(),
	}, nil
}

// RequestProspect abre um run do prospector (idempotente por command_id via
// outbox — a reentrega não cria um segundo run).
func (s *Service) RequestProspect(ctx context.Context, commandID string, in RequestProspectInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.CampaignID == "" {
		return nil, domainprospecta.ErrCampaignIDRequired
	}
	campaign, err := s.repo.FindCampaign(ctx, in.TenantID, in.CampaignID)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	run, err := domainprospecta.NewAgentRun(id.String(), in.TenantID, in.CampaignID, domainprospecta.AgentProspector)
	if err != nil {
		return nil, err
	}
	inserted, err := s.repo.InsertAgentRun(ctx, run, commandID)
	if err != nil {
		return nil, err
	}
	if !inserted {
		return nil, nil
	}
	return domainprospecta.ProspectRequested{
		RunID:      run.ID,
		CampaignID: run.CampaignID,
		CompanyID:  campaign.CompanyID,
		ICPID:      campaign.ICPID,
		TenantID:   run.TenantID,
		Agent:      run.Agent,
		OccurredAt: s.now(),
	}, nil
}

// UpsertLead insere ou atualiza o lead pela chave de dedup (tenant, domain,
// company_name). Emite LeadDiscovered só quando CRIA a linha; um lead
// reencontrado não vira um segundo card. Enriched presente em um lead existente
// emite LeadEnriched.
func (s *Service) UpsertLead(ctx context.Context, commandID string, in UpsertLeadInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.CompanyName == "" {
		return nil, domainprospecta.ErrCompanyNameRequired
	}
	if in.Domain == "" {
		return nil, domainprospecta.ErrDomainRequired
	}
	if in.CampaignID == "" {
		return nil, domainprospecta.ErrCampaignIDRequired
	}
	if err := domainprospecta.ValidateFit(in.Fit); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	lead, err := domainprospecta.NewLead(id.String(), in.TenantID, in.CampaignID, in.CompanyName, in.Domain, in.Segment, in.Channel, in.SourceURL)
	if err != nil {
		return nil, err
	}
	lead.Fit = in.Fit
	if in.Enriched != nil {
		lead.Enriched = in.Enriched
		lead.Status = domainprospecta.LeadEnrichedStatus
	}
	inserted, err := s.repo.UpsertLeadByDedupKey(ctx, lead, commandID)
	if err != nil {
		return nil, err
	}
	occurred := s.now()
	if inserted {
		return domainprospecta.LeadDiscovered{
			LeadID:      lead.ID,
			CampaignID:  lead.CampaignID,
			TenantID:    lead.TenantID,
			CompanyName: lead.CompanyName,
			Domain:      lead.Domain,
			Segment:     lead.Segment,
			Channel:     lead.Channel,
			SourceURL:   lead.SourceURL,
			Status:      lead.Status,
			OccurredAt:  occurred,
		}, nil
	}
	if in.Enriched != nil {
		return domainprospecta.LeadEnriched{
			LeadID:     lead.ID,
			CampaignID: lead.CampaignID,
			TenantID:   lead.TenantID,
			Enriched:   lead.Enriched,
			Status:     lead.Status,
			OccurredAt: occurred,
		}, nil
	}
	return nil, nil
}

// QualifyLead grava o fit (0..100) e move o lead para qualified. Ajuste
// idempotente: o mesmo fit em um lead já qualified devolve nil.
func (s *Service) QualifyLead(ctx context.Context, in QualifyLeadInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.LeadID == "" {
		return nil, domainprospecta.ErrLeadIDRequired
	}
	if err := domainprospecta.ValidateFit(in.Fit); err != nil {
		return nil, err
	}
	current, err := s.repo.FindLead(ctx, in.TenantID, in.LeadID)
	if err != nil {
		return nil, err
	}
	if current.Status == domainprospecta.LeadQualifiedStatus && current.Fit == in.Fit {
		return nil, nil
	}
	next, err := current.Qualify(in.Fit)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateLeadFit(ctx, next); err != nil {
		return nil, err
	}
	return domainprospecta.LeadQualified{
		LeadID:      next.ID,
		CampaignID:  next.CampaignID,
		TenantID:    next.TenantID,
		CompanyName: next.CompanyName,
		Fit:         next.Fit,
		Status:      next.Status,
		OccurredAt:  s.now(),
	}, nil
}

// DraftMessage cria uma abordagem out em drafted (o guardrail D10 começa aqui).
func (s *Service) DraftMessage(ctx context.Context, commandID string, in DraftMessageInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.LeadID == "" {
		return nil, domainprospecta.ErrLeadIDRequired
	}
	if in.Content == "" {
		return nil, domainprospecta.ErrContentRequired
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	m, err := domainprospecta.NewDraftMessage(id.String(), in.TenantID, in.LeadID, in.Channel, in.Content)
	if err != nil {
		return nil, err
	}
	inserted, err := s.repo.InsertMessage(ctx, m, commandID)
	if err != nil {
		return nil, err
	}
	if !inserted {
		return nil, nil
	}
	return domainprospecta.MessageDrafted{
		MessageID:  m.ID,
		LeadID:     m.LeadID,
		TenantID:   m.TenantID,
		Channel:    m.Channel,
		Direction:  m.Direction,
		Status:     m.Status,
		OccurredAt: s.now(),
	}, nil
}

// ApproveMessage só a partir de drafted; qualquer outro status é
// ErrMessageNotDrafted (a borda mapeia para 409). O CAS no banco fecha a corrida
// de dois approves simultâneos.
func (s *Service) ApproveMessage(ctx context.Context, in ApproveMessageInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.MessageID == "" {
		return nil, domainprospecta.ErrMessageIDRequired
	}
	current, err := s.repo.FindMessage(ctx, in.TenantID, in.MessageID)
	if err != nil {
		return nil, err
	}
	next, err := current.Approve()
	if err != nil {
		return nil, err
	}
	changed, err := s.repo.SetMessageStatus(ctx, in.TenantID, current.ID, domainprospecta.MessageStatusDrafted, domainprospecta.MessageStatusApproved, "")
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, domainprospecta.ErrMessageNotDrafted
	}
	return domainprospecta.MessageApproved{
		MessageID:  next.ID,
		LeadID:     next.LeadID,
		TenantID:   next.TenantID,
		Channel:    next.Channel,
		Status:     domainprospecta.MessageStatusApproved,
		OccurredAt: s.now(),
	}, nil
}

// SendMessage marca a mensagem approved como sent, com o id externo. Só a partir
// de approved: sem aprovação humana não sai (D10).
func (s *Service) SendMessage(ctx context.Context, in SendMessageInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.MessageID == "" {
		return nil, domainprospecta.ErrMessageIDRequired
	}
	if in.ExternalID == "" {
		return nil, domainprospecta.ErrExternalIDRequired
	}
	current, err := s.repo.FindMessage(ctx, in.TenantID, in.MessageID)
	if err != nil {
		return nil, err
	}
	next, err := current.Send(in.ExternalID)
	if err != nil {
		return nil, err
	}
	changed, err := s.repo.SetMessageStatus(ctx, in.TenantID, current.ID, domainprospecta.MessageStatusApproved, domainprospecta.MessageStatusSent, in.ExternalID)
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, domainprospecta.ErrMessageNotDrafted
	}
	return domainprospecta.MessageSent{
		MessageID:  next.ID,
		LeadID:     next.LeadID,
		TenantID:   next.TenantID,
		Channel:    next.Channel,
		ExternalID: next.ExternalID,
		Status:     domainprospecta.MessageStatusSent,
		OccurredAt: s.now(),
	}, nil
}

// ReceiveReply é idempotente por (tenant_id, thread_key): a thread é única e
// uma resposta reentregue não duplica a conversa. A mensagem in em si é
// deduplicada por command_id.
func (s *Service) ReceiveReply(ctx context.Context, commandID string, in ReceiveReplyInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.ThreadKey == "" {
		return nil, domainprospecta.ErrThreadKeyRequired
	}
	if in.Content == "" {
		return nil, domainprospecta.ErrContentRequired
	}
	if in.LeadID == "" {
		return nil, domainprospecta.ErrLeadIDRequired
	}
	convID, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	draft, err := domainprospecta.NewConversation(convID.String(), in.TenantID, in.LeadID, in.ThreadKey)
	if err != nil {
		return nil, err
	}
	conv, err := s.repo.UpsertConversation(ctx, draft)
	if err != nil {
		return nil, err
	}
	msgID, err := uuid.Parse(commandID)
	if err != nil {
		return nil, err
	}
	msg, err := domainprospecta.NewInboundMessage(msgID.String(), in.TenantID, conv.LeadID, in.Channel, in.Content, in.ExternalID)
	if err != nil {
		return nil, err
	}
	inserted, err := s.repo.InsertMessage(ctx, msg, commandID)
	if err != nil {
		return nil, err
	}
	if !inserted {
		return nil, nil
	}
	return domainprospecta.ReplyReceived{
		ConversationID: conv.ID,
		MessageID:      msg.ID,
		LeadID:         msg.LeadID,
		TenantID:       msg.TenantID,
		ThreadKey:      conv.ThreadKey,
		Channel:        msg.Channel,
		Status:         msg.Status,
		OccurredAt:     s.now(),
	}, nil
}

// BookMeeting marca a reunião no lead — o output do produto.
func (s *Service) BookMeeting(ctx context.Context, in BookMeetingInput) (domainprospecta.Event, error) {
	if in.TenantID == "" {
		return nil, domainprospecta.ErrTenantIDRequired
	}
	if in.LeadID == "" {
		return nil, domainprospecta.ErrLeadIDRequired
	}
	current, err := s.repo.FindLead(ctx, in.TenantID, in.LeadID)
	if err != nil {
		return nil, err
	}
	if current.Status == domainprospecta.LeadMeetingStatus {
		return nil, nil
	}
	next, err := current.BookMeeting()
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateLeadStatus(ctx, next); err != nil {
		return nil, err
	}
	return domainprospecta.MeetingBooked{
		LeadID:      next.ID,
		CampaignID:  next.CampaignID,
		TenantID:    next.TenantID,
		CompanyName: next.CompanyName,
		When:        in.When,
		Status:      next.Status,
		OccurredAt:  s.now(),
	}, nil
}

// CreateUser valida e grava a conta de autenticação e-mail+senha. O id é o
// command_id (como nos demais agregados). Idempotente por command_id; um e-mail
// já existente (único global, lower(email)) falha de forma limpa — não vira uma
// segunda conta nem um evento duplicado. O password_hash chega pronto; o service
// nunca vê a senha em claro.
func (s *Service) CreateUser(ctx context.Context, commandID string, in CreateUserInput) (domainprospecta.User, domainprospecta.Event, error) {
	id, err := uuid.Parse(commandID)
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	u, err := domainprospecta.NewUser(id.String(), in.TenantID, in.CompanyID, in.Name, in.Email, in.PasswordHash, in.Role)
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	inserted, err := s.repo.InsertUser(ctx, u, commandID)
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	if !inserted {
		return u, nil, nil
	}
	u.CreatedAt = s.now()
	return u, domainprospecta.UserRegistered{
		UserID:     u.ID,
		TenantID:   u.TenantID,
		CompanyID:  u.CompanyID,
		Email:      u.Email,
		OccurredAt: u.CreatedAt,
	}, nil
}

// UpdateUserPassword reescreve o hash da senha de uma conta existente. O hash
// já chega pronto (bcrypt); o service nunca vê a senha em claro. Idempotente por
// command_id. changed=false (comando já aplicado, ou usuário inexistente) não
// levanta evento — evita um UserPasswordChanged duplicado.
func (s *Service) UpdateUserPassword(ctx context.Context, commandID string, in UpdateUserPasswordInput) (domainprospecta.User, domainprospecta.Event, error) {
	if in.TenantID == "" {
		return domainprospecta.User{}, nil, domainprospecta.ErrTenantIDRequired
	}
	if in.UserID == "" {
		return domainprospecta.User{}, nil, domainprospecta.ErrUserIDRequired
	}
	id, err := uuid.Parse(commandID)
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	if _, err := uuid.Parse(in.UserID); err != nil {
		return domainprospecta.User{}, nil, err
	}
	// A troca só toca id/tenant/hash; os demais campos da linha ficam intactos
	// (o UPDATE é por id+tenant). O agregado aqui carrega só o que a invariante
	// de senha exige.
	target := domainprospecta.User{ID: in.UserID, TenantID: in.TenantID}
	next, err := target.ApplyPasswordHash(in.PasswordHash)
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	changed, err := s.repo.UpdateUserPassword(ctx, next, id.String())
	if err != nil {
		return domainprospecta.User{}, nil, err
	}
	if !changed {
		return domainprospecta.User{}, nil, nil
	}
	return next, domainprospecta.UserPasswordChanged{
		UserID:     next.ID,
		TenantID:   next.TenantID,
		OccurredAt: s.now(),
	}, nil
}

// RecordAudit grava a linha de prospecta_audit_log de um comando, com o payload
// já passado por PII scrubbing. Chamado pelo handler para todo comando,
// sucesso ou falha — é a auditoria própria do Prospecta (data-model §8).
func (s *Service) RecordAudit(ctx context.Context, tenantID, command string, payload []byte, cmdErr error) {
	entry := domainprospecta.AuditEntry{
		TenantID: tenantID,
		Command:  command,
		Status:   "ok",
		Payload:  scrubPII(payload),
	}
	if cmdErr != nil {
		entry.Status = "failed"
		entry.Error = cmdErr.Error()
	}
	_ = s.repo.Audit(ctx, entry)
}
