package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/aposta"
)

// ApostaRepository implements domain/aposta.Repository -- read-only,
// matching what domain-api actually does with it.
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

// ListPendentes is the cross-user read: every aposta still awaiting a
// result, across every usuario_email, for the resolver worker's daily
// sweep -- it has no session to scope a usuario by.
func (r *ApostaRepository) ListPendentes(ctx context.Context) ([]domainaposta.Aposta, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+apostaColumns+` FROM apostas WHERE status = 'pendente' ORDER BY data_aposta`,
	)
	if err != nil {
		return nil, fmt.Errorf("list apostas pendentes: %w", err)
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
