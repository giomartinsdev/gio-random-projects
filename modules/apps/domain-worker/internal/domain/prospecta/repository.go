package prospecta

import "context"

// Repository é uma porta -- o domain-worker é o único implementador E o único
// chamador dos métodos de escrita. Toda operação passa pelo tenant (RLS):
// nenhuma leitura cruza tenants.
type Repository interface {
	// InsertCompany grava a empresa. inserted=false quando o command_id já foi
	// aplicado (reentrega at-least-once) -- idempotência por comando.
	InsertCompany(ctx context.Context, c Company, commandID string) (inserted bool, err error)
	// FindCompany busca a empresa DENTRO do tenant informado.
	FindCompany(ctx context.Context, tenantID, id string) (Company, error)
	// CompanyExists diz se a empresa existe no tenant (pré-condição do ICP).
	CompanyExists(ctx context.Context, tenantID, id string) (bool, error)
	// InsertICP grava o ICP, idempotente por command_id.
	InsertICP(ctx context.Context, icp ICP, commandID string) (inserted bool, err error)
	// FindICPByCompany devolve o ICP de uma empresa no tenant.
	FindICPByCompany(ctx context.Context, tenantID, companyID string) (ICP, error)

	// InsertCampaign grava a campanha em draft, idempotente por command_id.
	InsertCampaign(ctx context.Context, c Campaign, commandID string) (inserted bool, err error)
	// FindCampaign busca a campanha DENTRO do tenant.
	FindCampaign(ctx context.Context, tenantID, id string) (Campaign, error)
	// SetCampaignStatus muda o status, condicionado ao from esperado (CAS): se a
	// campanha não estiver no status from, devolve changed=false sem escrever.
	SetCampaignStatus(ctx context.Context, tenantID, id string, from, to CampaignStatus) (changed bool, err error)

	// InsertLead grava o lead, idempotente por command_id.
	InsertLead(ctx context.Context, l Lead, commandID string) (inserted bool, err error)
	// FindLead busca o lead no tenant.
	FindLead(ctx context.Context, tenantID, id string) (Lead, error)
	// UpsertLeadByDedupKey insere ou atualiza o lead pela chave (tenant_id,
	// domain, company_name). inserted=false quando já existia (dedup).
	UpsertLeadByDedupKey(ctx context.Context, l Lead, commandID string) (inserted bool, err error)
	// UpdateLeadFit grava o fit e o status do lead.
	UpdateLeadFit(ctx context.Context, l Lead) error
	// UpdateLeadStatus grava o status corrente (e o enriched, quando houver).
	UpdateLeadStatus(ctx context.Context, l Lead) error

	// InsertMessage grava a mensagem, idempotente por command_id.
	InsertMessage(ctx context.Context, m Message, commandID string) (inserted bool, err error)
	// FindMessage busca a mensagem no tenant.
	FindMessage(ctx context.Context, tenantID, id string) (Message, error)
	// SetMessageStatus muda o status, condicionado ao from esperado (CAS).
	SetMessageStatus(ctx context.Context, tenantID, id string, from, to MessageStatus, externalID string) (changed bool, err error)

	// FindConversation busca a thread no tenant.
	FindConversation(ctx context.Context, tenantID, threadKey string) (Conversation, error)
	// UpsertConversation insere a thread (ON CONFLICT thread_key → no-op) e
	// devolve a conversa existente ou criada, para o ReceiveReply pendurar a
	// mensagem in nela.
	UpsertConversation(ctx context.Context, c Conversation) (Conversation, error)

	// InsertAgentRun abre o run, idempotente por command_id.
	InsertAgentRun(ctx context.Context, run AgentRun, commandID string) (inserted bool, err error)

	// Audit grava a linha de auditoria do Prospecta (sucesso ou falha) com o
	// payload já passado por PII scrubbing.
	Audit(ctx context.Context, e AuditEntry) error

	// InsertUser grava a conta (e-mail+senha), idempotente por command_id. O
	// e-mail é único GLOBALMENTE (índice lower(email)): um e-mail já existente
	// falha de forma limpa, sem virar uma segunda conta. A leitura por e-mail
	// (cross-tenant, do login) vive no domain-api, não aqui.
	InsertUser(ctx context.Context, u User, commandID string) (inserted bool, err error)
	// UpdateUserPassword reescreve o password_hash de uma conta existente,
	// idempotente por command_id (reentrega = no-op). changed=false quando o
	// comando já foi aplicado ou o usuário não existe no tenant.
	UpdateUserPassword(ctx context.Context, u User, commandID string) (changed bool, err error)
}

// AuditEntry é a linha de auditoria do Prospecta (data-model §8). Distinta do
// audit_log genérico do worker: esta carrega o tenant_id e o payload com PII
// removida.
type AuditEntry struct {
	TenantID string
	Command  string
	Status   string
	Payload  []byte
	Error    string
}

// ErrNotFound é devolvido quando o registro não existe no tenant.
var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "prospecta record not found" }
