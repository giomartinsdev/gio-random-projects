package finance

import (
	"errors"
	"time"
)

var (
	ErrNotificationIDRequired = errors.New("notification_id is required")
	ErrNotificationKind       = errors.New("notification kind must be category_threshold, any_transaction or large_transaction")
)

// NotificationKind são as regras que a pessoa pode cadastrar.
const (
	NotifCategoryThreshold = "category_threshold" // gasto numa categoria passou de X
	NotifAnyTransaction    = "any_transaction"    // qualquer transação
	NotifLargeTransaction  = "large_transaction"  // transação acima de X
)

// Notification é uma regra de aviso do usuário. O disparo é decidido pelo
// worker conversacional; aqui mora só a regra (o que avisar e a partir de quê).
type Notification struct {
	ID        string
	UserID    string
	Kind      string
	Category  string
	Threshold string // decimal string; "" = sem limiar
	Channel   string
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func NewNotification(id, userID, kind, category, threshold, channel string, enabled bool) (Notification, error) {
	if id == "" {
		return Notification{}, ErrNotificationIDRequired
	}
	if userID == "" {
		return Notification{}, ErrUserIDRequired
	}
	switch kind {
	case NotifCategoryThreshold, NotifAnyTransaction, NotifLargeTransaction:
	default:
		return Notification{}, ErrNotificationKind
	}
	if channel == "" {
		channel = "WHATSAPP"
	}
	now := time.Now().UTC()
	return Notification{ID: id, UserID: userID, Kind: kind, Category: category,
		Threshold: threshold, Channel: channel, Enabled: enabled, CreatedAt: now, UpdatedAt: now}, nil
}
