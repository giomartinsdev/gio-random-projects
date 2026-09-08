package cchroom

import "context"

// Repository is the storage port for registry entries. domain-worker
// is the only implementer and the only caller — domain-api's copy of
// this aggregate carries the read side instead (List, for cch-api's
// boot load). Upsert rather than Insert: the caller's writes are
// create-and-forget and its cutover import may re-fire a whole file
// after a crash, so replaying a create over its own row has to land
// silently on the same entry.
type Repository interface {
	Upsert(ctx context.Context, room Room) error
	Delete(ctx context.Context, id string) error
}