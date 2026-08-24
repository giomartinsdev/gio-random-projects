package post

import (
	"context"
	"fmt"
	"time"

	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
)

// Service is the use case: it's the only thing in this codebase that
// calls domainpost.Repository's write methods, so every mutation to a
// Post goes through the aggregate's own invariants (New/Edit) on the
// way — same shape as application/user.Service.
type Service struct {
	repo domainpost.Repository
}

func NewService(repo domainpost.Repository) *Service {
	return &Service{repo: repo}
}

// uniqueSlug appends -2, -3, ... until it finds a slug not already
// taken — collisions on a single title are rare, so this loop is
// bounded in practice by how many times one exact title repeats.
func (s *Service) uniqueSlug(ctx context.Context, base string) (string, error) {
	candidate := base
	for i := 2; ; i++ {
		exists, err := s.repo.SlugExists(ctx, candidate)
		if err != nil {
			return "", fmt.Errorf("check slug: %w", err)
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
	}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainpost.Post, domainpost.Event, error) {
	slug, err := s.uniqueSlug(ctx, Slugify(in.Title))
	if err != nil {
		return domainpost.Post{}, nil, err
	}
	p, err := domainpost.New(id, in.AuthorID, in.Title, slug, in.BodyMarkdown, in.Type, in.Status)
	if err != nil {
		return domainpost.Post{}, nil, err
	}
	p.Excerpt = in.Excerpt
	p.CoverImageURL = in.CoverImageURL

	if err := s.repo.Insert(ctx, p); err != nil {
		return domainpost.Post{}, nil, err
	}
	return p, domainpost.Created{PostID: p.ID, AuthorID: p.AuthorID, Slug: p.Slug, OccurredAt: p.CreatedAt}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domainpost.Post, domainpost.Event, error) {
	p, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domainpost.Post{}, nil, err
	}
	if err := p.Edit(in.AuthorID, in.Title, in.BodyMarkdown, in.Excerpt, in.CoverImageURL, in.Status); err != nil {
		return domainpost.Post{}, nil, err
	}
	if err := s.repo.Update(ctx, p); err != nil {
		return domainpost.Post{}, nil, err
	}
	return p, domainpost.Updated{PostID: p.ID, AuthorID: p.AuthorID, Slug: p.Slug, OccurredAt: p.UpdatedAt}, nil
}

func (s *Service) Delete(ctx context.Context, in DeleteInput) (domainpost.Event, error) {
	p, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if in.AuthorID != p.AuthorID {
		return nil, domainpost.ErrForbidden
	}
	if err := s.repo.Delete(ctx, in.ID); err != nil {
		return nil, err
	}
	return domainpost.Deleted{PostID: in.ID, OccurredAt: time.Now().UTC()}, nil
}
