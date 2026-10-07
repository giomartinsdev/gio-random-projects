package prospecta

import (
	"errors"
	"time"
)

// Erros do agregado Conversation.
var (
	ErrThreadKeyRequired = errors.New("thread_key is required")
)

// ConversationState é o estado da thread (data-model §6).
type ConversationState string

const (
	ConversationOpen    ConversationState = "open"
	ConversationWaiting ConversationState = "waiting"
	ConversationClosed  ConversationState = "closed"
)

// Conversation agrupa as mensagens de um lead num canal. thread_key é a chave
// de idempotência do ReceiveReply: a mesma resposta reentregue pelo broker cai
// na MESMA thread e vira no-op (não duplica a mensagem in).
type Conversation struct {
	ID        string
	TenantID  string
	LeadID    string
	ThreadKey string
	State     ConversationState
	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewConversation valida a thread: tenant, lead e a chave que a torna única por
// tenant.
func NewConversation(id, tenantID, leadID, threadKey string) (Conversation, error) {
	if tenantID == "" {
		return Conversation{}, ErrTenantIDRequired
	}
	if leadID == "" {
		return Conversation{}, ErrLeadIDRequired
	}
	if threadKey == "" {
		return Conversation{}, ErrThreadKeyRequired
	}
	return Conversation{
		ID:        id,
		TenantID:  tenantID,
		LeadID:    leadID,
		ThreadKey: threadKey,
		State:     ConversationOpen,
	}, nil
}
