package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
)

// PostRepository implements domain/post.Repository against Postgres —
// the only adapter that satisfies that port.
type PostRepository struct {
	pool *pgxpool.Pool
}

func NewPostRepository(pool *pgxpool.Pool) *PostRepository {
	return &PostRepository{pool: pool}
}

const postColumns = `id, author_id, title, slug, body_markdown, excerpt, cover_image_url, type, status, source, source_url, created_at, updated_at, published_at`

func scanPost(row pgx.Row) (domainpost.Post, error) {
	var p domainpost.Post
	err := row.Scan(
		&p.ID, &p.AuthorID, &p.Title, &p.Slug, &p.BodyMarkdown, &p.Excerpt, &p.CoverImageURL,
		&p.Type, &p.Status, &p.Source, &p.SourceURL, &p.CreatedAt, &p.UpdatedAt, &p.PublishedAt,
	)
	return p, err
}

// Every read below filters on deleted_at IS NULL -- a soft-deleted
// post is excluded from all of them, the same as if the row were
// physically gone, without ever running a DELETE. See Delete.
func (r *PostRepository) FindByID(ctx context.Context, id string) (domainpost.Post, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+postColumns+` FROM posts WHERE id = $1 AND deleted_at IS NULL`, id)
	p, err := scanPost(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpost.Post{}, domainpost.ErrNotFound
	}
	if err != nil {
		return domainpost.Post{}, fmt.Errorf("find post: %w", err)
	}
	return p, nil
}

func (r *PostRepository) FindBySlug(ctx context.Context, slug string) (domainpost.Post, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+postColumns+` FROM posts WHERE slug = $1 AND deleted_at IS NULL`, slug)
	p, err := scanPost(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpost.Post{}, domainpost.ErrNotFound
	}
	if err != nil {
		return domainpost.Post{}, fmt.Errorf("find post by slug: %w", err)
	}
	return p, nil
}

// A soft-deleted post's slug is excluded too -- deleting a post frees
// its slug up for reuse, same as if the row were gone.
func (r *PostRepository) SlugExists(ctx context.Context, slug string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM posts WHERE slug = $1 AND deleted_at IS NULL)`, slug).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check slug exists: %w", err)
	}
	return exists, nil
}

func (r *PostRepository) ListPublished(ctx context.Context) ([]domainpost.Post, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+postColumns+` FROM posts WHERE status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list published posts: %w", err)
	}
	defer rows.Close()

	var posts []domainpost.Post
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, fmt.Errorf("scan post: %w", err)
		}
		posts = append(posts, p)
	}
	return posts, rows.Err()
}

func (r *PostRepository) Insert(ctx context.Context, p domainpost.Post) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO posts (id, author_id, title, slug, body_markdown, excerpt, cover_image_url, type, status, source, source_url, created_at, updated_at, published_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		p.ID, p.AuthorID, p.Title, p.Slug, p.BodyMarkdown, p.Excerpt, p.CoverImageURL,
		p.Type, p.Status, p.Source, p.SourceURL, p.CreatedAt, p.UpdatedAt, p.PublishedAt,
	)
	if err != nil {
		return fmt.Errorf("insert post: %w", err)
	}
	return nil
}

// Update never overwrites a post's content without a trace: the row
// Postgres currently has (the pre-edit value, about to become
// inactive) is archived into post_revisions FIRST, in the same
// transaction as the UPDATE that publishes the new value -- either
// both happen or neither does.
func (r *PostRepository) Update(ctx context.Context, p domainpost.Post) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin update post tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once Commit succeeds

	_, err = tx.Exec(ctx,
		`INSERT INTO post_revisions (id, post_id, author_id, title, slug, body_markdown, excerpt, cover_image_url, type, status, source, source_url, created_at, updated_at, published_at)
		 SELECT $1, id, author_id, title, slug, body_markdown, excerpt, cover_image_url, type, status, source, source_url, created_at, updated_at, published_at
		 FROM posts WHERE id = $2 AND deleted_at IS NULL`,
		uuid.NewString(), p.ID,
	)
	if err != nil {
		return fmt.Errorf("archive post revision: %w", err)
	}

	tag, err := tx.Exec(ctx,
		`UPDATE posts SET title = $2, body_markdown = $3, excerpt = $4, cover_image_url = $5,
		 status = $6, updated_at = $7, published_at = $8 WHERE id = $1 AND deleted_at IS NULL`,
		p.ID, p.Title, p.BodyMarkdown, p.Excerpt, p.CoverImageURL, p.Status, p.UpdatedAt, p.PublishedAt,
	)
	if err != nil {
		return fmt.Errorf("update post: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainpost.ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit update post tx: %w", err)
	}
	return nil
}

// Soft delete only -- the row and every post_revisions entry for it
// stay in place forever, just excluded from every read path above.
func (r *PostRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainpost.ErrNotFound
	}
	return nil
}
