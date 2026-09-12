// This file is dashboard-api's whole reason to exist: GET/PUT/DELETE
// /api/layout, backed by domain-api's dashboardlayout aggregate. This
// service has no opinion about what's inside fonteDados -- accounts,
// categories, assets are other modules' business -- it only validates
// the shape a bloco must have to render at all (tipo, posicao, tamanho)
// and passes blocos through to domain-api byte-for-byte.
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/dashboard-api/internal/domainapi"
)

// tiposVisualizacaoValidos are the only bloco kinds the frontend knows
// how to render (contract: specs/002-gestao-financeira-modular/
// contracts/dashboard-api.md).
var tiposVisualizacaoValidos = map[string]bool{
	"linha":     true,
	"barra":     true,
	"pizza":     true,
	"indicador": true,
	"tabela":    true,
}

// posicao is a bloco's grid coordinates.
type posicao struct {
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
}

// tamanho is a bloco's grid dimensions -- both must be > 0, a
// zero-or-negative size can't render.
type tamanho struct {
	Largura *float64 `json:"largura"`
	Altura  *float64 `json:"altura"`
}

// bloco is one dashboard tile. FonteDados is deliberately json.RawMessage:
// it is opaque to this service, a free object the frontend interprets
// (account/category/asset reference) -- validating its content would
// couple dashboard-api to the other modules' schemas, which the module
// split exists to avoid.
type bloco struct {
	ID               string          `json:"id"`
	TipoVisualizacao string          `json:"tipoVisualizacao"`
	Posicao          *posicao        `json:"posicao"`
	Tamanho          *tamanho        `json:"tamanho"`
	FonteDados       json.RawMessage `json:"fonteDados"`
}

// putLayoutRequest is PUT /api/layout's body.
type putLayoutRequest struct {
	Blocos json.RawMessage `json:"blocos"`
}

// handleGetLayout reads the caller's saved layout. A 404 from
// domain-api (no personalization saved) becomes a 404 here -- the
// frontend's embedded default layout takes over, this is not an error
// condition worth a distinct body.
func (s *Server) handleGetLayout(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	layout, err := s.domain.GetLayout(r.Context(), id.Email)
	switch {
	case errors.Is(err, domainapi.ErrNotFound):
		writeError(w, http.StatusNotFound, "layout_nao_encontrado", "nenhum layout salvo para esta pessoa usuária")
		return
	case err != nil:
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocos": layout.Blocos})
}

// handlePutLayout validates and saves/replaces the caller's layout.
// Any validation failure is a 422 that never reaches domain-api --
// this service is the gate for "does this even look like a bloco",
// domain-api's job is only to persist what already passed that gate.
func (s *Server) handlePutLayout(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	var req putLayoutRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo_invalido", "corpo da requisição não é um JSON válido")
		return
	}

	var blocos []bloco
	if err := json.Unmarshal(req.Blocos, &blocos); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "blocos_invalido", "blocos precisa ser um array JSON válido")
		return
	}
	if codigo, mensagem, ok := validarBlocos(blocos); !ok {
		writeError(w, http.StatusUnprocessableEntity, codigo, mensagem)
		return
	}

	if err := s.domain.SaveLayout(r.Context(), id.Email, req.Blocos); err != nil {
		writeDomainSyncError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocos": req.Blocos})
}

// handleDeleteLayout removes the caller's layout personalization.
func (s *Server) handleDeleteLayout(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	if err := s.domain.DeleteLayout(r.Context(), id.Email); err != nil {
		writeDomainSyncError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validarBlocos checks the shape every bloco must have to render at
// all. Returns the first problem found, so callers can 422 with a
// single stable code -- the frontend switches on it.
func validarBlocos(blocos []bloco) (codigo, mensagem string, ok bool) {
	for _, b := range blocos {
		if b.ID == "" {
			return "bloco_id_obrigatorio", "cada bloco precisa de um id", false
		}
		if !tiposVisualizacaoValidos[b.TipoVisualizacao] {
			return "tipo_visualizacao_invalido", "tipoVisualizacao deve ser um de: linha, barra, pizza, indicador, tabela", false
		}
		if b.Posicao == nil || b.Posicao.X == nil || b.Posicao.Y == nil {
			return "posicao_invalida", "cada bloco precisa de posicao {x, y}", false
		}
		if b.Tamanho == nil || b.Tamanho.Largura == nil || b.Tamanho.Altura == nil {
			return "tamanho_invalido", "cada bloco precisa de tamanho {largura, altura}", false
		}
		if *b.Tamanho.Largura <= 0 || *b.Tamanho.Altura <= 0 {
			return "tamanho_invalido", "largura e altura precisam ser maiores que zero", false
		}
		if len(b.FonteDados) == 0 {
			return "fonte_dados_obrigatoria", "cada bloco precisa de fonteDados", false
		}
	}
	return "", "", true
}

// writeDomainSyncError classifies a domainapi.Client write error into
// the right HTTP status: a rejected command is the caller's fault
// (422), anything else (transport failure, timeout, unexpected status)
// is domain-api's/the network's fault (502).
func writeDomainSyncError(w http.ResponseWriter, err error) {
	if errors.Is(err, domainapi.ErrRejected) {
		writeError(w, http.StatusUnprocessableEntity, "layout_rejeitado", err.Error())
		return
	}
	writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
}
