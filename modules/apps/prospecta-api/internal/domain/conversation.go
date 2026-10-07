package domain

// Conversation is the projection of prospecta_conversation: a thread tied to a
// lead, with the inbox summary fields on the list view and the full ordered
// message thread on the detail view.
type Conversation struct {
	ID          string    `json:"id"`
	LeadID      string    `json:"lead_id"`
	CompanyName string    `json:"company_name,omitempty"`
	Channel     string    `json:"channel,omitempty"`
	LastMessage string    `json:"last_message,omitempty"`
	Unread      int       `json:"unread"`
	State       string    `json:"state"`
	Messages    []Message `json:"messages,omitempty"`
}

// Message is the projection of prospecta_message. Status drives the approve
// invariant: only a message in "drafted" may be approved (409 otherwise).
type Message struct {
	ID        string `json:"id"`
	LeadID    string `json:"lead_id,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Direction string `json:"direction,omitempty"`
	Content   string `json:"content,omitempty"`
	Status    string `json:"status,omitempty"`
	SentAt    string `json:"sent_at,omitempty"`
}

// MessageStatusDrafted is the only state from which ApproveMessage may run.
const MessageStatusDrafted = "drafted"
