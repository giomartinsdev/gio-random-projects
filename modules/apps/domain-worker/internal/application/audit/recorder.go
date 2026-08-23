// Package audit is a cross-cutting application concern, not part of any
// aggregate: domain-worker records one entry here per Command it
// handles, success or failure, independently of which aggregate the
// command targeted.
package audit

import "context"

type Entry struct {
	CommandID  string
	EntityType string
	EntityID   string
	Action     string
	Payload    []byte
	Success    bool
	Error      string
}

// Repository is a port — infrastructure/postgres provides the only
// implementation.
type Repository interface {
	Record(ctx context.Context, e Entry) error
}
