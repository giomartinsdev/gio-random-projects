// Contas: the one aggregate this BFF fronts today (US1 of
// specs/002-gestao-financeira-modular). Every write goes through
// domain-api's POST /sync so the caller gets an immediate, confirmed
// answer (conta.create / conta.update); every read is a plain GET
// against domain-api, scoped to the logged-in caller's own email.
package httpapi

import (
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

// handleSaldoConta: a real consolidated balance needs transacional-api
// and asset-manager-api wired up, which is out of scope here (see the
// task's own instruction not to invent cross-service aggregation logic
// yet). This is a placeholder shape the frontend can already call
// against.
func (s *Server) handleSaldoConta(w http.ResponseWriter, r *http.Request) {
	contaID := r.PathValue("id")
	writeJSON(w, http.StatusOK, map[string]any{
		"contaId":    contaID,
		"observacao": "cálculo de saldo consolidado será refinado quando transacional-api/asset-manager-api estiverem integrados",
	})
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
