package application

import (
	"context"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// ActivityService is the use-case layer for the live agent feed. It is thin on
// purpose: the streaming policy (buffering, cancel-on-disconnect) lives in the
// transport and the pair adapter owns the source of events.
type ActivityService struct {
	reader ActivityReader
}

func NewActivityService(reader ActivityReader) *ActivityService {
	return &ActivityService{reader: reader}
}

// Stream returns the live event channel. The channel is closed by the reader
// when ctx (the request's context) is cancelled.
func (s *ActivityService) Stream(ctx context.Context) (<-chan domain.AgentRunEvent, error) {
	return s.reader.StreamActivity(ctx)
}
