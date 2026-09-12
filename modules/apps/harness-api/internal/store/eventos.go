// Timeline de uma sessão (tabela eventos): append-only, a API nunca faz
// UPDATE nem DELETE aqui. Cada operação grava exatamente o evento do
// data-model.md; o payload é um JSON pequeno cuja forma depende do tipo
// (criacao, retomada, atualizacao_contexto, extensao_criada,
// status_mudou).
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Evento is one immutable timeline row. Payload is the raw JSON text as
// stored ("" when the event has no payload).
type Evento struct {
	ID         int64
	SessaoID   int64
	Tipo       string
	AutorEmail string
	Payload    string
	CriadoEm   int64
}

// querier is the common surface of *sql.DB and *sql.Tx -- operations
// that need atomicity (creation with its events, retake, status change)
// run inside a tx and pass it down here.
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// InsertEvento appends one event to the session's timeline. Payload may
// be nil (stored as NULL) or any JSON-serializable value.
func (s *Store) InsertEvento(sessaoID int64, tipo, autorEmail string, payload any) error {
	return insertEvento(s.db, sessaoID, tipo, autorEmail, payload)
}

func insertEvento(q querier, sessaoID int64, tipo, autorEmail string, payload any) error {
	var payloadSQL any
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("serializar payload de %s: %w", tipo, err)
		}
		payloadSQL = string(raw)
	}
	if _, err := q.Exec(
		`INSERT INTO eventos (sessao_id, tipo, autor_email, payload, criado_em) VALUES (?, ?, ?, ?, ?)`,
		sessaoID, tipo, autorEmail, payloadSQL, Now().Unix(),
	); err != nil {
		return fmt.Errorf("inserir evento %s na sessão %d: %w", tipo, sessaoID, err)
	}
	return nil
}

// ListEventos returns the session's timeline in chronological ascending
// order (FR-007); ties on criado_em (same second) fall back to id, which
// is insertion order since the table is append-only.
func (s *Store) ListEventos(sessaoID int64) ([]Evento, error) {
	rows, err := s.db.Query(
		`SELECT id, sessao_id, tipo, autor_email, COALESCE(payload, ''), criado_em
		 FROM eventos WHERE sessao_id = ? ORDER BY criado_em ASC, id ASC`, sessaoID,
	)
	if err != nil {
		return nil, fmt.Errorf("eventos da sessão %d: %w", sessaoID, err)
	}
	defer rows.Close()

	eventos := []Evento{}
	for rows.Next() {
		var e Evento
		if err := rows.Scan(&e.ID, &e.SessaoID, &e.Tipo, &e.AutorEmail, &e.Payload, &e.CriadoEm); err != nil {
			return nil, fmt.Errorf("ler evento da sessão %d: %w", sessaoID, err)
		}
		eventos = append(eventos, e)
	}
	return eventos, rows.Err()
}
