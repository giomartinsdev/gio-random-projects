// Regras de negócio das sessões (US1–US5): criação (com extensão
// herdando contexto da origem), retomada da baton (idempotente), edição
// de conteúdo com concorrência otimista e o ciclo de status com as
// transições fechadas do data-model.md. Os limites de tamanho dos campos
// moram aqui (a migration não tem CHECKs de tamanho -- ver 001_init.sql)
// e voltam como ValidacaoError para a camada HTTP virar 422 com
// detalhes por campo.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Now is the clock every timestamp the store writes (criado_em,
// atualizado_em, eventos) comes from. A var, not a call, so handler
// tests can pin it and make ordering and the optimistic-conflict cases
// deterministic; production never touches it.
var Now = time.Now

// Limits from data-model.md -- rune counts for the short text fields
// (they hold prose, and pt-BR titles would hit a byte cap unfairly),
// bytes for the markdown fields.
const (
	maxTituloRunes   = 200
	maxObjetivoRunes = 5000
	maxRepoRunes     = 200
	maxContextoBytes = 65536
	maxPassosBytes   = 16384
	maxPRLinkRunes   = 500
)

// The three statuses of sessoes.status (CHECK in the schema).
const (
	StatusEmAndamento = "em_andamento"
	StatusEntregue    = "entregue"
	StatusArquivada   = "arquivada"
)

var (
	// ErrNaoEncontrado maps to 404 nao_encontrado.
	ErrNaoEncontrado = errors.New("sessão não encontrada")
	// ErrOrigemInexistente maps to 422 validacao (origem_id de extensão).
	ErrOrigemInexistente = errors.New("sessão de origem não existe")
	// ErrConflito maps to 409 conflito -- the handler re-reads the
	// current state and sends it in the body.
	ErrConflito = errors.New("conteúdo mudou desde a leitura")
)

// CampoProblema is one per-field validation problem (a 422 `detalhes`
// entry).
type CampoProblema struct {
	Campo    string
	Problema string
}

// ValidacaoError carries the per-field problems of a rejected write.
type ValidacaoError struct {
	Problemas []CampoProblema
}

func (e *ValidacaoError) Error() string { return "dados inválidos" }

// TransicaoInvalidaError is a status change outside the data-model
// diagram; Error() already reads like the contract message.
type TransicaoInvalidaError struct {
	De, Para string
}

func (e *TransicaoInvalidaError) Error() string {
	return fmt.Sprintf("transição %s → %s não permitida", e.De, e.Para)
}

// ValidarCampo applies the data-model limit for one field by name and
// returns the problem ("" when the value passes). titulo/objetivo/repo/
// pr_link count runes; the markdown fields count bytes (64 KB / 16 KB,
// data-model.md).
func ValidarCampo(nome, valor string) string {
	switch nome {
	case "titulo":
		t := strings.TrimSpace(valor)
		switch {
		case t == "":
			return "obrigatório"
		case utf8.RuneCountInString(t) > maxTituloRunes:
			return fmt.Sprintf("máximo de %d caracteres", maxTituloRunes)
		}
	case "objetivo":
		switch {
		case strings.TrimSpace(valor) == "":
			return "obrigatório"
		case utf8.RuneCountInString(valor) > maxObjetivoRunes:
			return fmt.Sprintf("máximo de %d caracteres", maxObjetivoRunes)
		}
	case "repo":
		if utf8.RuneCountInString(valor) > maxRepoRunes {
			return fmt.Sprintf("máximo de %d caracteres", maxRepoRunes)
		}
	case "contexto_md":
		if len(valor) > maxContextoBytes {
			return fmt.Sprintf("máximo de %d bytes (64 KB)", maxContextoBytes)
		}
	case "proximos_passos_md":
		if len(valor) > maxPassosBytes {
			return fmt.Sprintf("máximo de %d bytes (16 KB)", maxPassosBytes)
		}
	case "pr_link":
		if utf8.RuneCountInString(valor) > maxPRLinkRunes {
			return fmt.Sprintf("máximo de %d caracteres", maxPRLinkRunes)
		}
	}
	return ""
}

// Sessao is one row of sessoes. Nil pointers stand for the nullable
// columns (repo, markdown fields, pr_link, origem_id); the HTTP layer
// passes them through so JSON gets null, never "".
type Sessao struct {
	ID               int64
	Titulo           string
	Objetivo         string
	Repo             *string
	ContextoMD       *string
	ProximosPassosMD *string
	Status           string
	CriadorEmail     string
	DonoAtualEmail   string
	PRLink           *string
	OrigemID         *int64
	CriadoEm         int64
	AtualizadoEm     int64
}

// NovaSessao carries the creation fields. nil pointers mean "not sent":
// on an extension (OrigemID set), contexto_md/proximos_passos_md left
// out copy the origin's -- fields present in the body override the copy.
type NovaSessao struct {
	Titulo           string
	Objetivo         string
	Repo             string
	ContextoMD       *string
	ProximosPassosMD *string
	OrigemID         *int64
	CriadorEmail     string
}

// CamposConteudo is the editable surface of a session (US-2, FR-006):
// nil field = not sent, stays untouched.
type CamposConteudo struct {
	ContextoMD       *string
	ProximosPassosMD *string
}

// Filtros narrows ListSessoes. Statuses is repeatable (OR semantics).
type Filtros struct {
	Statuses []string
	Dono     string
	OrigemID *int64
}

// CreateSessao inserts the session (dono = criador) and its criacao
// event in one tx; on an extension it also reads the origem to copy
// contexto_md/proximos_passos_md and leaves extensao_criada on the
// origem's timeline. Everything is validated first, so a rejected
// creation never touches the database.
func (s *Store) CreateSessao(n NovaSessao) (Sessao, error) {
	titulo := strings.TrimSpace(n.Titulo)

	var problemas []CampoProblema
	problema := func(campo, valor string) {
		if p := ValidarCampo(campo, valor); p != "" {
			problemas = append(problemas, CampoProblema{Campo: campo, Problema: p})
		}
	}
	problema("titulo", titulo)
	problema("objetivo", n.Objetivo)
	problema("repo", n.Repo)
	if n.ContextoMD != nil {
		problema("contexto_md", *n.ContextoMD)
	}
	if n.ProximosPassosMD != nil {
		problema("proximos_passos_md", *n.ProximosPassosMD)
	}
	if len(problemas) > 0 {
		return Sessao{}, &ValidacaoError{Problemas: problemas}
	}

	contexto, passos := n.ContextoMD, n.ProximosPassosMD

	tx, err := s.db.Begin()
	if err != nil {
		return Sessao{}, fmt.Errorf("abrir transação de criação: %w", err)
	}
	defer tx.Rollback()

	if n.OrigemID != nil {
		var origemCtx, origemPassos sql.NullString
		err := tx.QueryRow(
			`SELECT contexto_md, proximos_passos_md FROM sessoes WHERE id = ?`, *n.OrigemID,
		).Scan(&origemCtx, &origemPassos)
		if errors.Is(err, sql.ErrNoRows) {
			return Sessao{}, ErrOrigemInexistente
		}
		if err != nil {
			return Sessao{}, fmt.Errorf("ler origem %d: %w", *n.OrigemID, err)
		}
		// Campos enviados sobrescrevem a cópia; ausentes herdam a origem.
		if contexto == nil {
			contexto = nullStrPtr(origemCtx)
		}
		if passos == nil {
			passos = nullStrPtr(origemPassos)
		}
	}

	agora := Now().Unix()
	res, err := tx.Exec(`INSERT INTO sessoes
		(titulo, objetivo, repo, contexto_md, proximos_passos_md, status,
		 criador_email, dono_atual_email, origem_id, criado_em, atualizado_em)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		titulo, n.Objetivo, textoOuNulo(n.Repo), textoPtrOuNulo(contexto), textoPtrOuNulo(passos),
		StatusEmAndamento, n.CriadorEmail, n.CriadorEmail, n.OrigemID, agora, agora,
	)
	if err != nil {
		return Sessao{}, fmt.Errorf("inserir sessão: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Sessao{}, fmt.Errorf("id da sessão: %w", err)
	}

	if err := insertEvento(tx, id, "criacao", n.CriadorEmail, map[string]string{"titulo": titulo}); err != nil {
		return Sessao{}, err
	}
	if n.OrigemID != nil {
		payload := map[string]any{"extensao_id": id, "titulo": titulo}
		if err := insertEvento(tx, *n.OrigemID, "extensao_criada", n.CriadorEmail, payload); err != nil {
			return Sessao{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return Sessao{}, fmt.Errorf("commit criação: %w", err)
	}

	return Sessao{
		ID:               id,
		Titulo:           titulo,
		Objetivo:         n.Objetivo,
		Repo:             textoPtr(n.Repo),
		ContextoMD:       contexto,
		ProximosPassosMD: passos,
		Status:           StatusEmAndamento,
		CriadorEmail:     n.CriadorEmail,
		DonoAtualEmail:   n.CriadorEmail,
		OrigemID:         n.OrigemID,
		CriadoEm:         agora,
		AtualizadoEm:     agora,
	}, nil
}

// RetomarSessao hands the baton to novoDono. Idempotent: when the caller
// already owns the session nothing changes and no event is born. The
// bool reports whether ownership actually moved.
func (s *Store) RetomarSessao(id int64, novoDonoEmail string) (sess Sessao, mudou bool, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return Sessao{}, false, fmt.Errorf("abrir transação de retomada: %w", err)
	}
	defer tx.Rollback()

	atual, err := getSessao(tx, id)
	if err != nil {
		return Sessao{}, false, err
	}
	if atual.DonoAtualEmail == novoDonoEmail {
		return atual, false, nil
	}

	agora := Now().Unix()
	if _, err := tx.Exec(
		`UPDATE sessoes SET dono_atual_email = ?, atualizado_em = ? WHERE id = ?`,
		novoDonoEmail, agora, id,
	); err != nil {
		return Sessao{}, false, fmt.Errorf("retomar sessão %d: %w", id, err)
	}
	payload := map[string]string{"dono_anterior": atual.DonoAtualEmail, "dono_novo": novoDonoEmail}
	if err := insertEvento(tx, id, "retomada", novoDonoEmail, payload); err != nil {
		return Sessao{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Sessao{}, false, fmt.Errorf("commit retomada: %w", err)
	}

	atual.DonoAtualEmail = novoDonoEmail
	atual.AtualizadoEm = agora
	return atual, true, nil
}

// UpdateConteudo edits contexto_md and/or proximos_passos_md with the
// optimistic concurrency of data-model.md: when baseAtualizadoEm differs
// from the stored one and !force, the write is refused with ErrConflito
// and nothing changes -- the handler answers 409 with the current state.
// On success the atualizacao_contexto event records which fields moved
// and whether the write was forced.
func (s *Store) UpdateConteudo(id int64, autorEmail string, campos CamposConteudo, baseAtualizadoEm int64, force bool) (Sessao, error) {
	var problemas []CampoProblema
	if campos.ContextoMD == nil && campos.ProximosPassosMD == nil {
		problema := "informe contexto_md e/ou proximos_passos_md"
		problemas = append(problemas,
			CampoProblema{Campo: "contexto_md", Problema: problema},
			CampoProblema{Campo: "proximos_passos_md", Problema: problema},
		)
	}
	if campos.ContextoMD != nil {
		if p := ValidarCampo("contexto_md", *campos.ContextoMD); p != "" {
			problemas = append(problemas, CampoProblema{Campo: "contexto_md", Problema: p})
		}
	}
	if campos.ProximosPassosMD != nil {
		if p := ValidarCampo("proximos_passos_md", *campos.ProximosPassosMD); p != "" {
			problemas = append(problemas, CampoProblema{Campo: "proximos_passos_md", Problema: p})
		}
	}
	if len(problemas) > 0 {
		return Sessao{}, &ValidacaoError{Problemas: problemas}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Sessao{}, fmt.Errorf("abrir transação de edição: %w", err)
	}
	defer tx.Rollback()

	atual, err := getSessao(tx, id)
	if err != nil {
		return Sessao{}, err
	}
	if !force && baseAtualizadoEm != atual.AtualizadoEm {
		return Sessao{}, ErrConflito
	}

	agora := Now().Unix()
	var sets []string
	var args []any
	var camposGravados []string
	if campos.ContextoMD != nil {
		sets = append(sets, "contexto_md = ?")
		args = append(args, textoPtrOuNulo(campos.ContextoMD))
		camposGravados = append(camposGravados, "contexto_md")
	}
	if campos.ProximosPassosMD != nil {
		sets = append(sets, "proximos_passos_md = ?")
		args = append(args, textoPtrOuNulo(campos.ProximosPassosMD))
		camposGravados = append(camposGravados, "proximos_passos_md")
	}
	sets = append(sets, "atualizado_em = ?")
	args = append(args, agora, id)
	if _, err := tx.Exec(
		`UPDATE sessoes SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...,
	); err != nil {
		return Sessao{}, fmt.Errorf("editar sessão %d: %w", id, err)
	}
	payload := map[string]any{"campos": camposGravados, "force": force}
	if err := insertEvento(tx, id, "atualizacao_contexto", autorEmail, payload); err != nil {
		return Sessao{}, err
	}
	if err := tx.Commit(); err != nil {
		return Sessao{}, fmt.Errorf("commit edição: %w", err)
	}

	if campos.ContextoMD != nil {
		atual.ContextoMD = conteudoPtr(campos.ContextoMD)
	}
	if campos.ProximosPassosMD != nil {
		atual.ProximosPassosMD = conteudoPtr(campos.ProximosPassosMD)
	}
	atual.AtualizadoEm = agora
	return atual, nil
}

// destinoDe maps each status action to the status it targets.
var destinoDe = map[string]string{
	"entregar": StatusEntregue,
	"arquivar": StatusArquivada,
	"reabrir":  StatusEmAndamento,
}

// transicoesValidas is the closed transition diagram of data-model.md:
// em_andamento→entregue|arquivada, entregue→arquivada|em_andamento,
// arquivada→em_andamento. Anything else is TransicaoInvalidaError.
var transicoesValidas = map[string]map[string]bool{
	StatusEmAndamento: {"entregar": true, "arquivar": true},
	StatusEntregue:    {"arquivar": true, "reabrir": true},
	StatusArquivada:   {"reabrir": true},
}

// UpdateStatus moves the session through the diagram. pr_link is only
// touched by entregar (and only when sent) -- arquivar/reabrir keep
// whatever is there, and no status change ever moves the dono.
func (s *Store) UpdateStatus(id int64, autorEmail, acao string, prLink *string) (Sessao, error) {
	para, ok := destinoDe[acao]
	if !ok {
		return Sessao{}, &ValidacaoError{Problemas: []CampoProblema{{
			Campo: "acao", Problema: "valores aceitos: entregar, arquivar, reabrir",
		}}}
	}
	if prLink != nil {
		if p := ValidarCampo("pr_link", *prLink); p != "" {
			return Sessao{}, &ValidacaoError{Problemas: []CampoProblema{{Campo: "pr_link", Problema: p}}}
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Sessao{}, fmt.Errorf("abrir transação de status: %w", err)
	}
	defer tx.Rollback()

	atual, err := getSessao(tx, id)
	if err != nil {
		return Sessao{}, err
	}
	if !transicoesValidas[atual.Status][acao] {
		return Sessao{}, &TransicaoInvalidaError{De: atual.Status, Para: para}
	}

	agora := Now().Unix()
	var novoPRLink *string
	if acao == "entregar" && prLink != nil {
		novoPRLink = conteudoPtr(prLink)
		if _, err := tx.Exec(
			`UPDATE sessoes SET status = ?, pr_link = ?, atualizado_em = ? WHERE id = ?`,
			para, novoPRLink, agora, id,
		); err != nil {
			return Sessao{}, fmt.Errorf("mudar status da sessão %d: %w", id, err)
		}
	} else {
		novoPRLink = atual.PRLink
		if _, err := tx.Exec(
			`UPDATE sessoes SET status = ?, atualizado_em = ? WHERE id = ?`,
			para, agora, id,
		); err != nil {
			return Sessao{}, fmt.Errorf("mudar status da sessão %d: %w", id, err)
		}
	}
	payload := map[string]any{"de": atual.Status, "para": para, "pr_link": novoPRLink}
	if err := insertEvento(tx, id, "status_mudou", autorEmail, payload); err != nil {
		return Sessao{}, err
	}
	if err := tx.Commit(); err != nil {
		return Sessao{}, fmt.Errorf("commit status: %w", err)
	}

	atual.Status = para
	atual.PRLink = novoPRLink
	atual.AtualizadoEm = agora
	return atual, nil
}

// GetSessao reads one session; ErrNaoEncontrado when it does not exist.
func (s *Store) GetSessao(id int64) (Sessao, error) {
	return getSessao(s.db, id)
}

// ListSessoes applies the filters and returns the team list in the
// contract's fixed order: em_andamento first, then by atualizado_em
// descending (ties fall back to id, newest first -- same-second writes
// stay deterministic).
func (s *Store) ListSessoes(f Filtros) ([]Sessao, error) {
	var conds []string
	var args []any
	if len(f.Statuses) > 0 {
		placeholders := make([]string, len(f.Statuses))
		for i, st := range f.Statuses {
			placeholders[i] = "?"
			args = append(args, st)
		}
		conds = append(conds, "status IN ("+strings.Join(placeholders, ", ")+")")
	}
	if f.Dono != "" {
		conds = append(conds, "dono_atual_email = ?")
		args = append(args, f.Dono)
	}
	if f.OrigemID != nil {
		conds = append(conds, "origem_id = ?")
		args = append(args, *f.OrigemID)
	}

	query := `SELECT ` + colunasSessao + ` FROM sessoes`
	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += ` ORDER BY CASE WHEN status = 'em_andamento' THEN 0 ELSE 1 END,
		atualizado_em DESC, id DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("listar sessões: %w", err)
	}
	defer rows.Close()

	sessoes := []Sessao{}
	for rows.Next() {
		sess, err := scanSessao(rows)
		if err != nil {
			return nil, fmt.Errorf("ler sessão: %w", err)
		}
		sessoes = append(sessoes, sess)
	}
	return sessoes, rows.Err()
}

const colunasSessao = `id, titulo, objetivo, repo, contexto_md, proximos_passos_md,
	status, criador_email, dono_atual_email, pr_link, origem_id, criado_em, atualizado_em`

func getSessao(q querier, id int64) (Sessao, error) {
	row := q.QueryRow(`SELECT `+colunasSessao+` FROM sessoes WHERE id = ?`, id)
	sess, err := scanSessao(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Sessao{}, ErrNaoEncontrado
	}
	if err != nil {
		return Sessao{}, fmt.Errorf("sessão %d: %w", id, err)
	}
	return sess, nil
}

// scanSessao reads a full row into Sessao, mapping SQL NULLs to nil
// pointers so the HTTP layer keeps null in JSON.
func scanSessao(row interface{ Scan(dest ...any) error }) (Sessao, error) {
	var s Sessao
	var repo, contexto, passos, prLink sql.NullString
	var origem sql.NullInt64
	err := row.Scan(&s.ID, &s.Titulo, &s.Objetivo, &repo, &contexto, &passos,
		&s.Status, &s.CriadorEmail, &s.DonoAtualEmail, &prLink, &origem,
		&s.CriadoEm, &s.AtualizadoEm)
	if err != nil {
		return Sessao{}, err
	}
	s.Repo = nullStrPtr(repo)
	s.ContextoMD = nullStrPtr(contexto)
	s.ProximosPassosMD = nullStrPtr(passos)
	s.PRLink = nullStrPtr(prLink)
	if origem.Valid {
		s.OrigemID = &origem.Int64
	}
	return s, nil
}

// textoOuNulo stores "" as NULL: an optional field the caller left empty
// means absent, and the contract answers null, not "".
func textoOuNulo(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func textoPtrOuNulo(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

// conteudoPtr normalizes a pointer coming from a request: nil stays nil
// and "" becomes nil, so clearing a markdown field stores NULL.
func conteudoPtr(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}

func textoPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nullStrPtr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.String
}
