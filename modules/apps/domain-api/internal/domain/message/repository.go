package message

import "context"

type Repository interface {
	ListByRoom(ctx context.Context, roomID string) ([]Message, error)
}
