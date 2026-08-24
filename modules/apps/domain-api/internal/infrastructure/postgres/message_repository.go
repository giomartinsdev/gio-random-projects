package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/message"
)

// MessageRepository implements domain/message.Repository -- read-only,
// matching what domain-api actually does with it.
type MessageRepository struct {
	pool *pgxpool.Pool
}

func NewMessageRepository(pool *pgxpool.Pool) *MessageRepository {
	return &MessageRepository{pool: pool}
}

const messageColumns = `id, room_id, user_id, user_name, body, requested_page, created_at`

func scanMessage(row pgx.Row) (domainmessage.Message, error) {
	var m domainmessage.Message
	err := row.Scan(&m.ID, &m.RoomID, &m.UserID, &m.UserName, &m.Body, &m.RequestedPage, &m.CreatedAt)
	return m, err
}

func (r *MessageRepository) ListByRoom(ctx context.Context, roomID string) ([]domainmessage.Message, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+messageColumns+` FROM messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT 200`, roomID)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	var messages []domainmessage.Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}
