package application

import (
	"context"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// CreateMessageInput is the POST /messages body. The pair decides draft vs send
// from the campaign's policy.approval; this side only validates the shape.
type CreateMessageInput struct {
	LeadID  string `json:"lead_id"`
	Channel string `json:"channel"`
	Content string `json:"content"`
}

// MessagingService is the use-case layer for conversations and messages.
type MessagingService struct {
	publisher CommandPublisher
	convs     ConversationReader
	messages  MessageReader
}

func NewMessagingService(publisher CommandPublisher, convs ConversationReader, messages MessageReader) *MessagingService {
	return &MessagingService{publisher: publisher, convs: convs, messages: messages}
}

// CreateMessage validates and publishes DraftMessage (the pair downgrades it to
// a send when the policy allows). Empty content/lead/channel are rejected
// before publishing.
func (s *MessagingService) CreateMessage(ctx context.Context, in CreateMessageInput) (string, error) {
	in.LeadID = strings.TrimSpace(in.LeadID)
	if in.LeadID == "" {
		return "", domain.ErrMessageLeadRequired
	}
	in.Channel = strings.TrimSpace(in.Channel)
	if in.Channel == "" {
		return "", domain.ErrMessageChannelRequired
	}
	in.Content = strings.TrimSpace(in.Content)
	if in.Content == "" {
		return "", domain.ErrMessageContentRequired
	}
	payload := map[string]any{
		"lead_id": in.LeadID,
		"channel": in.Channel,
		"content": in.Content,
	}
	return s.publisher.Publish(ctx, ActionDraftMessage, payload)
}

// ApproveMessage publishes ApproveMessage, but only from "drafted": any other
// state is a 409 on the wire. The message is read from the pair first, so the
// API never publishes an approval for a message it was told does not exist.
func (s *MessagingService) ApproveMessage(ctx context.Context, messageID string) (string, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return "", domain.ErrNotFound
	}
	message, err := s.messages.Message(ctx, messageID)
	if err != nil {
		return "", err
	}
	if message.Status != domain.MessageStatusDrafted {
		return "", domain.ErrMessageNotDrafted
	}
	return s.publisher.Publish(ctx, ActionApproveMessage, map[string]any{"message_id": messageID})
}

// ListConversations reads a page of the unified inbox.
func (s *MessagingService) ListConversations(ctx context.Context, limit int, cursor string) (domain.Page[domain.Conversation], error) {
	return s.convs.ListConversations(ctx, normalizeLimit(limit), strings.TrimSpace(cursor))
}

// GetConversation reads one full thread; a missing record is ErrNotFound.
func (s *MessagingService) GetConversation(ctx context.Context, id string) (domain.Conversation, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Conversation{}, domain.ErrNotFound
	}
	return s.convs.Conversation(ctx, id)
}
