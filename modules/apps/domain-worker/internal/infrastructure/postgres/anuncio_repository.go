package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	domainanuncio "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/anuncio"
)

// AnuncioRepository implements domain/anuncio.Repository. Append-only and
// trimmed by age — an announcement describes a moment, it is never edited.
type AnuncioRepository struct {
	pool *pgxpool.Pool
}

func NewAnuncioRepository(pool *pgxpool.Pool) *AnuncioRepository {
	return &AnuncioRepository{pool: pool}
}

func (r *AnuncioRepository) Append(ctx context.Context, a domainanuncio.Anuncio) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_announcements (id, tipo, titulo, texto, referencia_id, icone, gerado_em, expira_em)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		a.ID, a.Tipo, a.Titulo, a.Texto, a.ReferenciaID, a.Icone, a.GeradoEm, a.ExpiraEm)
	if err != nil {
		return fmt.Errorf("append anuncio: %w", err)
	}
	return nil
}

// Recent returns the newest unexpired announcements, newest first.
func (r *AnuncioRepository) Recent(ctx context.Context, limit int) ([]domainanuncio.Anuncio, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, tipo, titulo, texto, referencia_id, icone, gerado_em, expira_em
		FROM clubs_announcements
		WHERE expira_em IS NULL OR expira_em > now()
		ORDER BY gerado_em DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("recent anuncios: %w", err)
	}
	defer rows.Close()

	var list []domainanuncio.Anuncio
	for rows.Next() {
		var a domainanuncio.Anuncio
		if err := rows.Scan(&a.ID, &a.Tipo, &a.Titulo, &a.Texto, &a.ReferenciaID, &a.Icone,
			&a.GeradoEm, &a.ExpiraEm); err != nil {
			return nil, fmt.Errorf("scan anuncio: %w", err)
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// TrimOlderThan drops announcements past their expiry so the feed never
// grows unbounded.
func (r *AnuncioRepository) TrimOlderThan(ctx context.Context, cutoff time.Time) (int, error) {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM clubs_announcements WHERE expira_em IS NOT NULL AND expira_em < $1`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("trim anuncios: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// CountRecent reports how many announcements exist — the admin counter.
func (r *AnuncioRepository) CountRecent(ctx context.Context) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM clubs_announcements`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count anuncios: %w", err)
	}
	return n, nil
}
