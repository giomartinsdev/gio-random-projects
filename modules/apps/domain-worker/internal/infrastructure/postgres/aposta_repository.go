package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/aposta"
)

// ApostaRepository implements domain/aposta.Repository against Postgres
// -- the only adapter that satisfies that port. Aposta is a single-row
// aggregate (no child records like AtivoMovimento), so Insert/Update
// are plain single-table writes, same shape as ContaRepository.
type ApostaRepository struct {
	pool *pgxpool.Pool
}

func NewApostaRepository(pool *pgxpool.Pool) *ApostaRepository {
	return &ApostaRepository{pool: pool}
}

const apostaColumns = `id, user_email, conta_id, descricao, valor_apostado, odd, status, retorno_obtido, data_aposta, data_resultado, created_at, updated_at`

func scanAposta(row pgx.Row) (domainaposta.Aposta, error) {
	var a domainaposta.Aposta
	var odd, retornoObtido *float64
	var dataResultado *time.Time
	err := row.Scan(
		&a.ID, &a.UserEmail, &a.ContaID, &a.Descricao, &a.ValorApostado, &odd, &a.Status,
		&retornoObtido, &a.DataAposta, &dataResultado, &a.CreatedAt, &a.UpdatedAt,
	)
	if odd != nil {
		a.Odd = *odd
	}
	if retornoObtido != nil {
		a.RetornoObtido = *retornoObtido
	}
	if dataResultado != nil {
		a.DataResultado = *dataResultado
	}
	return a, err
}

func (r *ApostaRepository) FindByID(ctx context.Context, id string) (domainaposta.Aposta, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+apostaColumns+` FROM apostas WHERE id = $1`, id)
	a, err := scanAposta(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainaposta.Aposta{}, domainaposta.ErrNotFound
	}
	if err != nil {
		return domainaposta.Aposta{}, fmt.Errorf("find aposta: %w", err)
	}
	return a, nil
}

// An empty contaID means "every conta do usuario".
func (r *ApostaRepository) ListByUsuario(ctx context.Context, userEmail, contaID string) ([]domainaposta.Aposta, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+apostaColumns+` FROM apostas
		 WHERE user_email = $1 AND ($2 = '' OR conta_id = $2::uuid)
		 ORDER BY data_aposta DESC, created_at DESC`,
		userEmail, contaID,
	)
	if err != nil {
		return nil, fmt.Errorf("list apostas: %w", err)
	}
	defer rows.Close()

	var apostas []domainaposta.Aposta
	for rows.Next() {
		a, err := scanAposta(rows)
		if err != nil {
			return nil, fmt.Errorf("scan aposta: %w", err)
		}
		apostas = append(apostas, a)
	}
	return apostas, rows.Err()
}

func (r *ApostaRepository) Insert(ctx context.Context, a domainaposta.Aposta) error {
	var odd *float64
	if a.Odd > 0 {
		odd = &a.Odd
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO apostas (id, user_email, conta_id, descricao, valor_apostado, odd, status, data_aposta, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		a.ID, a.UserEmail, a.ContaID, a.Descricao, a.ValorApostado, odd, a.Status, a.DataAposta, a.CreatedAt, a.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert aposta: %w", err)
	}
	return nil
}

func (r *ApostaRepository) Update(ctx context.Context, a domainaposta.Aposta) error {
	var retornoObtido *float64
	if a.RetornoObtido > 0 {
		retornoObtido = &a.RetornoObtido
	}
	var dataResultado *time.Time
	if !a.DataResultado.IsZero() {
		dataResultado = &a.DataResultado
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE apostas SET status = $2, retorno_obtido = $3, data_resultado = $4, updated_at = $5 WHERE id = $1`,
		a.ID, a.Status, retornoObtido, dataResultado, a.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("update aposta: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainaposta.ErrNotFound
	}
	return nil
}
