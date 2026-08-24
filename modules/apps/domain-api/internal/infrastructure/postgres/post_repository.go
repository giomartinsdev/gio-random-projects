package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/post"
)

// PostRepository implements domain/post.Repository — read-only,
// matching what domain-api actually does with it.
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

func (r *PostRepository) FindByID(ctx context.Context, id string) (domainpost.Post, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+postColumns+` FROM posts WHERE id = $1`, id)
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
	row := r.pool.QueryRow(ctx, `SELECT `+postColumns+` FROM posts WHERE slug = $1`, slug)
	p, err := scanPost(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpost.Post{}, domainpost.ErrNotFound
	}
	if err != nil {
		return domainpost.Post{}, fmt.Errorf("find post by slug: %w", err)
	}
	return p, nil
}

func (r *PostRepository) ListPublished(ctx context.Context) ([]domainpost.Post, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+postColumns+` FROM posts WHERE status = 'published' ORDER BY published_at DESC`)
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
