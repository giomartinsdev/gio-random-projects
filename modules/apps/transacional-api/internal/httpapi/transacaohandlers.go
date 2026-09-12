// Transação handlers (US2): list/create/edit/delete lançamentos against
// the shared domain-api. Every write does its own cheap validation
// (valor/data/tipo/contaId shape) before spending a network round-trip,
// then -- for creates and any edit that changes contaId -- fetches the
// referenced conta to confirm it exists and is "ativa" (FR-024's
// conta_invalida edge case). anexoImagem is checked for size/format
// entirely locally; nothing here does OCR or any other processing of
// it, per the contract.
package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/transacional-api/internal/domainapi"
)

const dataLayout = "2006-01-02"

// apiErr is a validation/domain failure with the HTTP status and error
// code it should be answered with.
type apiErr struct {
	status   int
	codigo   string
	mensagem string
}

func (e *apiErr) Error() string { return e.mensagem }

func errValorInvalido() *apiErr {
	return &apiErr{http.StatusUnprocessableEntity, "valor_invalido", "valor deve ser numérico e maior que zero"}
}
func errDataInvalida() *apiErr {
	return &apiErr{http.StatusUnprocessableEntity, "data_invalida", "data deve estar no formato YYYY-MM-DD"}
}
func errTipoInvalido() *apiErr {
	return &apiErr{http.StatusUnprocessableEntity, "tipo_invalido", `tipo deve ser "entrada" ou "saida"`}
}
func errContaObrigatoria() *apiErr {
	return &apiErr{http.StatusUnprocessableEntity, "conta_obrigatoria", "contaId é obrigatório"}
}
func errContaInvalida() *apiErr {
	return &apiErr{http.StatusUnprocessableEntity, "conta_invalida", "conta não existe ou está arquivada"}
}
func errAnexoGrande() *apiErr {
	return &apiErr{http.StatusRequestEntityTooLarge, "anexo_muito_grande", "imagem excede o tamanho máximo permitido"}
}
func errAnexoFormato() *apiErr {
	return &apiErr{http.StatusUnsupportedMediaType, "anexo_formato_invalido", "formato de imagem não suportado (use png, jpeg ou webp)"}
}

func writeAPIErr(w http.ResponseWriter, err *apiErr) {
	writeError(w, err.status, err.codigo, err.mensagem)
}

// transacaoRequest is the wire shape of POST/PATCH /api/transacoes.
// Pointers on every field mean "not sent" for PATCH; POST requires
// ContaID/Tipo/Valor/Data/Categoria to be present (checked explicitly,
// not via required-pointer plumbing, so the 422 messages stay precise).
type transacaoRequest struct {
	ContaID     *string    `json:"contaId"`
	Tipo        *string    `json:"tipo"`
	Valor       *valorJSON `json:"valor"`
	Data        *string    `json:"data"`
	Categoria   *string    `json:"categoria"`
	Descricao   *string    `json:"descricao"`
	AnexoImagem *string    `json:"anexoImagem"`
}

// valorJSON accepts valor either as a JSON number (10.5) or as a
// numeric string ("10.5") -- frontends are inconsistent about this and
// the validation cost of accepting both is nil.
type valorJSON struct {
	raw string
}

func (v *valorJSON) UnmarshalJSON(data []byte) error {
	s := strings.Trim(string(data), `"`)
	v.raw = s
	return nil
}

func (v *valorJSON) float() (float64, bool) {
	if v == nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(v.raw, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// handleListarTransacoes lists the logged-in person's transações,
// forwarding every optional filter as-is to domain-api.
func (s *Server) handleListarTransacoes(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	q := r.URL.Query()

	transacoes, err := s.domain.ListTransacoes(r.Context(), id.Email, q.Get("conta"), q.Get("de"), q.Get("ate"), q.Get("categoria"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	if transacoes == nil {
		transacoes = []domainapi.Transacao{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"transacoes": transacoes})
}

// handleCriarTransacao validates the body, confirms the conta is ativa,
// then issues the async POST /transacoes write.
func (s *Server) handleCriarTransacao(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	var req transacaoRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido")
		return
	}

	contaID := stringOrEmpty(req.ContaID)
	if contaID == "" {
		writeAPIErr(w, errContaObrigatoria())
		return
	}
	tipo := stringOrEmpty(req.Tipo)
	if tipo != "entrada" && tipo != "saida" {
		writeAPIErr(w, errTipoInvalido())
		return
	}
	valor, ok := req.Valor.float()
	if !ok || valor <= 0 {
		writeAPIErr(w, errValorInvalido())
		return
	}
	data := stringOrEmpty(req.Data)
	if _, err := time.Parse(dataLayout, data); err != nil {
		writeAPIErr(w, errDataInvalida())
		return
	}
	anexo := ""
	if req.AnexoImagem != nil {
		var apiErr *apiErr
		if anexo, apiErr = validarAnexo(*req.AnexoImagem, s.cfg.MaxAnexoBytes); apiErr != nil {
			writeAPIErr(w, apiErr)
			return
		}
	}

	if apiErr := s.checarContaAtiva(r.Context(), contaID); apiErr != nil {
		writeAPIErr(w, apiErr)
		return
	}

	err := s.domain.CriarTransacao(r.Context(), domainapi.CriarInput{
		UsuarioEmail: id.Email,
		ContaID:      contaID,
		Tipo:         tipo,
		Valor:        strconv.FormatFloat(valor, 'f', -1, 64),
		Data:         data,
		Categoria:    stringOrEmpty(req.Categoria),
		Descricao:    stringOrEmpty(req.Descricao),
		AnexoImagem:  anexo,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "aceito"})
}

// handleEditarTransacao validates only the fields actually sent, checks
// the conta again when contaId is being changed, then issues the async
// PATCH write.
func (s *Server) handleEditarTransacao(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	transacaoID := r.PathValue("id")

	var req transacaoRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido")
		return
	}

	in := domainapi.EditarInput{UsuarioEmail: id.Email}

	if req.ContaID != nil {
		if *req.ContaID == "" {
			writeAPIErr(w, errContaObrigatoria())
			return
		}
		if apiErr := s.checarContaAtiva(r.Context(), *req.ContaID); apiErr != nil {
			writeAPIErr(w, apiErr)
			return
		}
		in.ContaID = req.ContaID
	}
	if req.Tipo != nil {
		if *req.Tipo != "entrada" && *req.Tipo != "saida" {
			writeAPIErr(w, errTipoInvalido())
			return
		}
		in.Tipo = req.Tipo
	}
	if req.Valor != nil {
		f, ok := req.Valor.float()
		if !ok || f <= 0 {
			writeAPIErr(w, errValorInvalido())
			return
		}
		valorStr := strconv.FormatFloat(f, 'f', -1, 64)
		in.Valor = &valorStr
	}
	if req.Data != nil {
		if _, err := time.Parse(dataLayout, *req.Data); err != nil {
			writeAPIErr(w, errDataInvalida())
			return
		}
		in.Data = req.Data
	}
	if req.Categoria != nil {
		in.Categoria = req.Categoria
	}
	if req.Descricao != nil {
		in.Descricao = req.Descricao
	}
	if req.AnexoImagem != nil {
		anexo, apiErr := validarAnexo(*req.AnexoImagem, s.cfg.MaxAnexoBytes)
		if apiErr != nil {
			writeAPIErr(w, apiErr)
			return
		}
		in.AnexoImagem = &anexo
	}

	if err := s.domain.EditarTransacao(r.Context(), transacaoID, in); err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "aceito"})
}

// handleExcluirTransacao issues the async DELETE write.
func (s *Server) handleExcluirTransacao(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	transacaoID := r.PathValue("id")

	if err := s.domain.ExcluirTransacao(r.Context(), transacaoID, id.Email); err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "aceito"})
}

// checarContaAtiva does the one validation that costs a network call:
// GET /contas/{id} on domain-api, confirming it exists and is "ativa".
// A 404 or a wrong status both answer conta_invalida (per the
// contract); a transport/unexpected-status failure is a 502, not a
// 422 -- the caller didn't do anything wrong.
func (s *Server) checarContaAtiva(ctx context.Context, contaID string) *apiErr {
	conta, err := s.domain.GetConta(ctx, contaID)
	if errors.Is(err, domainapi.ErrNotFound) {
		return errContaInvalida()
	}
	if err != nil {
		return &apiErr{http.StatusBadGateway, "domain_api_indisponivel", err.Error()}
	}
	if conta.Status != "ativa" {
		return errContaInvalida()
	}
	return nil
}

// validarAnexo decodes anexoImagem (either a raw base64 string or a
// data: URL) and enforces size/format. Returns the raw base64 payload
// (without any data-URL prefix) to forward to domain-api, or an *apiErr
// with the right status/code from the contract:
//   - 413 when the decoded bytes exceed maxBytes
//   - 415 when a data-URL's embedded content-type isn't png/jpeg/webp
//
// A plain base64 string with no data-URL prefix skips the content-type
// check entirely -- there is no format to read.
func validarAnexo(raw string, maxBytes int64) (string, *apiErr) {
	payload := raw
	if strings.HasPrefix(raw, "data:") {
		comma := strings.IndexByte(raw, ',')
		if comma < 0 {
			return "", &apiErr{http.StatusBadRequest, "corpo_invalido", "anexoImagem: data URL malformada"}
		}
		header := raw[len("data:"):comma]
		mime, _, _ := strings.Cut(header, ";")
		switch mime {
		case "image/png", "image/jpeg", "image/webp":
			// ok
		default:
			return "", errAnexoFormato()
		}
		payload = raw[comma+1:]
	}

	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", &apiErr{http.StatusBadRequest, "corpo_invalido", "anexoImagem: base64 inválido"}
	}
	if maxBytes > 0 && int64(len(decoded)) > maxBytes {
		return "", errAnexoGrande()
	}
	return payload, nil
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
