package prospecta

import (
	"errors"
	"time"
)

// Erros do agregado Message.
var (
	ErrMessageIDRequired = errors.New("message_id is required")
	ErrContentRequired    = errors.New("content is required")
	ErrMessageNotDrafted  = errors.New("message is not in drafted status")
	ErrExternalIDRequired = errors.New("external_id is required")
)

// MessageStatus é o ciclo de vida de uma mensagem (data-model §5).
type MessageStatus string

const (
	MessageStatusDrafted  MessageStatus = "drafted"
	MessageStatusApproved MessageStatus = "approved"
	MessageStatusSent     MessageStatus = "sent"
	MessageStatusFailed   MessageStatus = "failed"
	MessageStatusBlocked  MessageStatus = "blocked"
)

// MessageDirection distingue a abordagem (out) da resposta do lead (in).
type MessageDirection string

const (
	DirectionOut MessageDirection = "out"
	DirectionIn  MessageDirection = "in"
)

// Message é uma abordagem (out) ou uma resposta (in) dentro de uma thread. O
// guardrail D10 é estrutural: uma mensagem out nasce drafted e SÓ vai a sent
// depois de aprovada — ApproveMessage é a única transição para approved, e
// SendMessage só sai de approved.
type Message struct {
	ID         string
	TenantID   string
	LeadID     string
	Channel    string
	Direction  MessageDirection
	Content    string
	Status     MessageStatus
	ExternalID string
	SentAt     string
	CreatedAt  time.Time
}

// NewDraftMessage cria uma abordagem (out) em drafted. Exige lead e conteúdo.
func NewDraftMessage(id, tenantID, leadID, channel, content string) (Message, error) {
	if tenantID == "" {
		return Message{}, ErrTenantIDRequired
	}
	if leadID == "" {
		return Message{}, ErrLeadIDRequired
	}
	if content == "" {
		return Message{}, ErrContentRequired
	}
	return Message{
		ID:        id,
		TenantID:  tenantID,
		LeadID:    leadID,
		Channel:   channel,
		Direction: DirectionOut,
		Content:   content,
		Status:    MessageStatusDrafted,
	}, nil
}

// NewInboundMessage cria a resposta recebida (in): já chega como enviada, porque
// quem a mandou foi o lead, não nós.
func NewInboundMessage(id, tenantID, leadID, channel, content, externalID string) (Message, error) {
	if tenantID == "" {
		return Message{}, ErrTenantIDRequired
	}
	if leadID == "" {
		return Message{}, ErrLeadIDRequired
	}
	if content == "" {
		return Message{}, ErrContentRequired
	}
	return Message{
		ID:         id,
		TenantID:   tenantID,
		LeadID:     leadID,
		Channel:    channel,
		Direction:  DirectionIn,
		Content:    content,
		Status:     MessageStatusSent,
		ExternalID: externalID,
	}, nil
}

// Approve é a guarda do D10: só uma mensagem drafted pode ser aprovada; qualquer
// outro status devolve ErrMessageNotDrafted (a borda mapeia para 409).
func (m Message) Approve() (Message, error) {
	if m.Status != MessageStatusDrafted {
		return m, ErrMessageNotDrafted
	}
	next := m
	next.Status = MessageStatusApproved
	return next, nil
}

// Send marca a mensagem aprovada como enviada, com o id no provedor
// (Evolution/e-mail). Só a partir de approved: uma drafted não pode ser
// enviada sem passar pela aprovação humana.
func (m Message) Send(externalID string) (Message, error) {
	if m.Status != MessageStatusApproved {
		return m, ErrMessageNotDrafted
	}
	if externalID == "" {
		return m, ErrExternalIDRequired
	}
	next := m
	next.Status = MessageStatusSent
	next.ExternalID = externalID
	return next, nil
}
