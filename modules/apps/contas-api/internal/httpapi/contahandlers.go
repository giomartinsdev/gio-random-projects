// Contas: the one aggregate this BFF fronts today (US1 of
// specs/002-gestao-financeira-modular). Every write goes through
// domain-api's POST /sync so the caller gets an immediate, confirmed
// answer (conta.create / conta.update); every read is a plain GET
// against domain-api, scoped to the logged-in caller's own email.
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/contas-api/internal/domainapi"
)

// tiposValidos are the only account kinds this module knows about today
// (FR-010). Anything else is a 422 -- validated here, before ever
// reaching domain-api, so a bad request never costs a round-trip.
var tiposValidos = []string{"corrente", "investimento"}

const (
	statusAtiva     = "ativa"
	statusArquivada = "arquivada"
)

func (s *Server) registrarRotasContas() {
	s.mux.HandleFunc("GET /api/contas", s.handleListarContas)
	s.mux.HandleFunc("POST /api/contas", s.handleCriarConta)
	s.mux.HandleFunc("PATCH /api/contas/{id}", s.handleEditarConta)
	s.mux.HandleFunc("POST /api/contas/{id}/arquivar", s.handleArquivarConta)
	s.mux.HandleFunc("GET /api/contas/{id}/saldo", s.handleSaldoConta)
}

func (s *Server) handleListarContas(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	status := r.URL.Query().Get("status")
	if status != "" && status != statusAtiva && status != statusArquivada {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "status deve ser 'ativa' ou 'arquivada'")
		return
	}
	contas, err := s.domain.ListContas(r.Context(), id.Email, status)
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contas": contas})
}

type criarContaRequest struct {
	Nome string `json:"nome"`
	Tipo string `json:"tipo"`
}

func (s *Server) handleCriarConta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	var req criarContaRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "corpo inválido: "+err.Error())
		return
	}
	req.Nome = strings.TrimSpace(req.Nome)
	if req.Nome == "" {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "nome é obrigatório")
		return
	}
	if !slices.Contains(tiposValidos, req.Tipo) {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "tipo deve ser 'corrente' ou 'investimento'")
		return
	}

	entityID, err := s.domain.Sync(r.Context(), "conta.create", domainapi.CriarInput{
		UsuarioEmail: id.Email,
		Nome:         req.Nome,
		Tipo:         req.Tipo,
	})
	if s.respondSyncErr(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": entityID, "nome": req.Nome, "tipo": req.Tipo, "status": statusAtiva})
}

type editarContaRequest struct {
	Nome string `json:"nome"`
}

func (s *Server) handleEditarConta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	contaID := r.PathValue("id")
	var req editarContaRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "corpo inválido: "+err.Error())
		return
	}
	req.Nome = strings.TrimSpace(req.Nome)
	if req.Nome == "" {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "nome é obrigatório")
		return
	}

	_, err := s.domain.Sync(r.Context(), "conta.update", domainapi.EditarInput{
		ID:           contaID,
		UsuarioEmail: id.Email,
		Nome:         req.Nome,
	})
	if s.respondSyncErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": contaID, "nome": req.Nome})
}

func (s *Server) handleArquivarConta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	contaID := r.PathValue("id")

	_, err := s.domain.Sync(r.Context(), "conta.update", domainapi.EditarInput{
		ID:           contaID,
		UsuarioEmail: id.Email,
		Status:       statusArquivada,
	})
	if s.respondSyncErr(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": contaID, "status": statusArquivada})
}

// handleSaldoConta computes FR-013's consolidated balance by reading
// the shared domain-api directly (the contract explicitly allows this
// instead of fanning out to the other BFFs). The math follows each
// conta tipo's own module: a corrente account is what transacional-api
// tracks, so its saldo is entradas − saídas over the conta's
// transações; an investimento account is what asset-manager-api
// tracks, so its saldo is Σ quantidade_atual × cotação over the
// posições. A position whose quote was never fetched counts at its
// custo médio -- the best-known value, the same tolerance FR-035 gives
// the carteira when brapi.dev is unavailable.
//
// Both reads are scoped to the caller's own email, and the conta itself
// is fetched first so a stranger's contaId answers 404 like a
// nonexistent one -- no existence oracle.
func (s *Server) handleSaldoConta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	contaID := r.PathValue("id")

	conta, err := s.domain.GetConta(r.Context(), contaID)
	if err != nil {
		if errors.Is(err, domainapi.ErrNotFound) {
			writeError(w, http.StatusNotFound, "conta_nao_encontrada", "conta não encontrada")
			return
		}
		writeError(w, http.StatusBadGateway, "domain_indisponivel", err.Error())
		return
	}
	if conta.Usuario != id.Email {
		writeError(w, http.StatusNotFound, "conta_nao_encontrada", "conta não encontrada")
		return
	}

	var saldo float64
	switch conta.Tipo {
	case "corrente":
		saldo, err = s.saldoCorrente(r.Context(), id.Email, contaID)
	case "investimento":
		saldo, err = s.saldoInvestimento(r.Context(), id.Email, contaID)
	default:
		writeError(w, http.StatusBadGateway, "domain_indisponivel", "conta com tipo desconhecido: "+conta.Tipo)
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contaId": contaID, "saldo": saldo})
}

// saldoCorrente sums the conta's transações: entradas in, saídas out.
func (s *Server) saldoCorrente(ctx context.Context, usuarioEmail, contaID string) (float64, error) {
	transacoes, err := s.domain.ListTransacoes(ctx, usuarioEmail, contaID)
	if err != nil {
		return 0, err
	}
	var saldo float64
	for _, t := range transacoes {
		switch t.Tipo {
		case "entrada":
			saldo += t.Valor
		case "saida":
			saldo -= t.Valor
		}
	}
	return saldo, nil
}

// saldoInvestimento sums the posições' market value: quantidade_atual ×
// última cotação conhecida, falling back to custo médio for a position
// never quoted (see handleSaldoConta).
func (s *Server) saldoInvestimento(ctx context.Context, usuarioEmail, contaID string) (float64, error) {
	ativos, err := s.domain.ListAtivos(ctx, usuarioEmail, contaID)
	if err != nil {
		return 0, err
	}
	var saldo float64
	for _, a := range ativos {
		cotacao := a.UltimaCotacao
		if cotacao == 0 {
			cotacao = a.CustoMedio
		}
		saldo += a.QuantidadeAtual * cotacao
	}
	return saldo, nil
}

// respondSyncErr classifies a domainapi.Sync error into the response the
// contract asks for and writes it. Returns true when it wrote a
// response (the caller should return immediately), false when err was
// nil.
func (s *Server) respondSyncErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, domainapi.ErrRejected):
		writeError(w, http.StatusUnprocessableEntity, "rejeitado_pelo_worker", err.Error())
	case errors.Is(err, domainapi.ErrQueued):
		writeError(w, http.StatusAccepted, "escrita_em_confirmacao", "a escrita foi publicada e ainda está sendo confirmada")
	default:
		writeError(w, http.StatusBadGateway, "domain_indisponivel", err.Error())
	}
	return true
}
