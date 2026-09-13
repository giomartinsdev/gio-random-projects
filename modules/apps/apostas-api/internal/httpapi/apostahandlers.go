// Aposta handlers: register/list bets and resolve their result. Every
// write validates its own shape before spending a network round-trip,
// then confirms the referenced conta exists, belongs to the caller, is
// "ativa" and is a "aposta" wallet (mirrors transacional-api's own
// checarContaAtiva, plus the tipo/ownership checks that one skips --
// nothing here trusts a contaId just because it parses).
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/domainapi"
)

const dataLayout = "2006-01-02"

func dataParaDominio(raw string) (time.Time, bool) {
	t, err := time.Parse(dataLayout, raw)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// erroCampo is one entry of a 422 `detalhes` array: which field and why.
type erroCampo struct {
	Campo    string `json:"campo"`
	Problema string `json:"problema"`
}

func writeValidacao(w http.ResponseWriter, mensagem string, detalhes []erroCampo) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"erro": map[string]any{
			"codigo":   "validacao",
			"mensagem": mensagem,
			"detalhes": detalhes,
		},
	})
}

// apostaResponse is the wire shape of one GET /api/apostas item --
// camelCase per this module's frontend contract, built from
// domainapi.Aposta (snake_case), same "never pass the domain-api shape
// straight through" rule transacional-api's own transacaoResponse
// documents.
type apostaResponse struct {
	ID            string  `json:"id"`
	ContaID       string  `json:"contaId"`
	Descricao     string  `json:"descricao"`
	ValorApostado float64 `json:"valorApostado"`
	Odd           float64 `json:"odd,omitempty"`
	Status        string  `json:"status"`
	RetornoObtido float64 `json:"retornoObtido,omitempty"`
	DataAposta    string  `json:"dataAposta"`
	DataResultado string  `json:"dataResultado,omitempty"`
}

func paraApostaResponse(a domainapi.Aposta) apostaResponse {
	r := apostaResponse{
		ID: a.ID, ContaID: a.ContaID, Descricao: a.Descricao, ValorApostado: a.ValorApostado,
		Odd: a.Odd, Status: a.Status, RetornoObtido: a.RetornoObtido,
		DataAposta: a.DataAposta.Format(dataLayout),
	}
	if !a.DataResultado.IsZero() {
		r.DataResultado = a.DataResultado.Format(dataLayout)
	}
	return r
}

func (s *Server) handleListarApostas(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	apostas, err := s.domain.ListApostas(r.Context(), id.Email, r.URL.Query().Get("conta"))
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	out := make([]apostaResponse, 0, len(apostas))
	for _, a := range apostas {
		out = append(out, paraApostaResponse(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"apostas": out})
}

type registrarApostaRequest struct {
	ContaID       string  `json:"contaId"`
	Descricao     string  `json:"descricao"`
	ValorApostado float64 `json:"valorApostado"`
	Odd           float64 `json:"odd,omitempty"`
	DataAposta    string  `json:"dataAposta"`
}

// handleRegistrarAposta registers the bet (sync, confirmed) then debits
// the stake from the conta (async POST /transacoes) -- in that order:
// if the debit fails, the bet still exists as pendente and the person
// sees it in the list, rather than money silently vanishing with no
// record of why.
func (s *Server) handleRegistrarAposta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	var req registrarApostaRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido: "+err.Error())
		return
	}
	req.Descricao = strings.TrimSpace(req.Descricao)

	var detalhes []erroCampo
	if req.ContaID == "" {
		detalhes = append(detalhes, erroCampo{Campo: "contaId", Problema: "obrigatório"})
	}
	if req.Descricao == "" {
		detalhes = append(detalhes, erroCampo{Campo: "descricao", Problema: "obrigatório"})
	}
	if req.ValorApostado <= 0 {
		detalhes = append(detalhes, erroCampo{Campo: "valorApostado", Problema: "obrigatório e maior que zero"})
	}
	data, dataValida := dataParaDominio(req.DataAposta)
	if req.DataAposta == "" {
		detalhes = append(detalhes, erroCampo{Campo: "dataAposta", Problema: "obrigatório"})
	} else if !dataValida {
		detalhes = append(detalhes, erroCampo{Campo: "dataAposta", Problema: "deve estar no formato YYYY-MM-DD"})
	}
	if len(detalhes) > 0 {
		writeValidacao(w, "dados da aposta inválidos", detalhes)
		return
	}

	if apiErr := s.checarContaDeAposta(r.Context(), req.ContaID, id.Email); apiErr != nil {
		writeError(w, apiErr.status, apiErr.codigo, apiErr.mensagem)
		return
	}

	apostaID, apiErr := s.registrar(r.Context(), id.Email, req.ContaID, req.Descricao, req.ValorApostado, req.Odd, data)
	if apiErr != nil {
		writeError(w, apiErr.status, apiErr.codigo, apiErr.mensagem)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": apostaID})
}

// registrar is the shared core of handleRegistrarAposta and the
// extension's handleImportarPrint: publish aposta.registrar (sync,
// confirmed), then debit the stake from the conta -- in that order, so
// a failed debit never leaves an aposta with no trace of what went
// wrong (it still exists as pendente, visible in the list).
func (s *Server) registrar(ctx context.Context, usuarioEmail, contaID, descricao string, valorApostado, odd float64, data time.Time) (string, *apiErr) {
	apostaID, err := s.domain.RegistrarAposta(ctx, domainapi.RegistrarInput{
		UsuarioEmail: usuarioEmail, ContaID: contaID, Descricao: descricao,
		ValorApostado: valorApostado, Odd: odd, Data: data,
	})
	if err != nil {
		if errors.Is(err, domainapi.ErrRejected) {
			return "", &apiErr{http.StatusUnprocessableEntity, "validacao", err.Error()}
		}
		return "", &apiErr{http.StatusBadGateway, "domain_api_indisponivel", err.Error()}
	}

	if err := s.domain.CriarTransacao(ctx, domainapi.CriarTransacaoInput{
		UsuarioEmail: usuarioEmail, ContaID: contaID, Tipo: "saida", Valor: valorApostado,
		Data: data.Format(time.RFC3339), Categoria: "aposta", Descricao: descricao,
	}); err != nil {
		return "", &apiErr{http.StatusBadGateway, "domain_api_indisponivel",
			"aposta registrada, mas o débito na conta falhou: " + err.Error()}
	}
	return apostaID, nil
}

type resolverApostaRequest struct {
	Status        string  `json:"status"`
	RetornoObtido float64 `json:"retornoObtido,omitempty"`
	DataResultado string  `json:"dataResultado"`
}

// handleResolverAposta resolves the bet (sync, confirmed) then, unless
// it was a red, credits the payout back into the conta -- same
// error-visible-on-partial-failure reasoning as the registrar above.
func (s *Server) handleResolverAposta(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	apostaID := r.PathValue("id")

	var req resolverApostaRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido: "+err.Error())
		return
	}

	var detalhes []erroCampo
	switch req.Status {
	case "green":
		if req.RetornoObtido <= 0 {
			detalhes = append(detalhes, erroCampo{Campo: "retornoObtido", Problema: "obrigatório e maior que zero para green"})
		}
	case "red", "cancelada":
		// nothing else required
	default:
		detalhes = append(detalhes, erroCampo{Campo: "status", Problema: "deve ser green, red ou cancelada"})
	}
	data, dataValida := dataParaDominio(req.DataResultado)
	if req.DataResultado == "" {
		detalhes = append(detalhes, erroCampo{Campo: "dataResultado", Problema: "obrigatório"})
	} else if !dataValida {
		detalhes = append(detalhes, erroCampo{Campo: "dataResultado", Problema: "deve estar no formato YYYY-MM-DD"})
	}
	if len(detalhes) > 0 {
		writeValidacao(w, "dados da resolução inválidos", detalhes)
		return
	}

	alvo, err := s.domain.GetAposta(r.Context(), apostaID)
	if errors.Is(err, domainapi.ErrNotFound) {
		writeError(w, http.StatusNotFound, "aposta_nao_encontrada", "aposta não encontrada")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	if alvo.UsuarioEmail != id.Email {
		writeError(w, http.StatusNotFound, "aposta_nao_encontrada", "aposta não encontrada")
		return
	}

	if err := s.domain.ResolverAposta(r.Context(), domainapi.ResolverInput{
		ApostaID: apostaID, Status: req.Status, RetornoObtido: req.RetornoObtido, Data: data,
	}); err != nil {
		s.writeDomainWriteError(w, err)
		return
	}

	if req.Status != "red" {
		retorno := req.RetornoObtido
		if req.Status == "cancelada" {
			retorno = alvo.ValorApostado
		}
		if err := s.domain.CriarTransacao(r.Context(), domainapi.CriarTransacaoInput{
			UsuarioEmail: id.Email, ContaID: alvo.ContaID, Tipo: "entrada", Valor: retorno,
			Data: data.Format(time.RFC3339), Categoria: "aposta", Descricao: alvo.Descricao,
		}); err != nil {
			writeError(w, http.StatusBadGateway, "domain_api_indisponivel",
				"resultado registrado, mas o crédito na conta falhou: "+err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resolvida"})
}

type apiErr struct {
	status   int
	codigo   string
	mensagem string
}

// checarContaDeAposta confirms contaID exists, belongs to usuarioEmail,
// is "ativa" and has tipo "aposta" -- a bet can only ever be registered
// against the caller's own betting-house wallet.
func (s *Server) checarContaDeAposta(ctx context.Context, contaID, usuarioEmail string) *apiErr {
	conta, err := s.domain.GetConta(ctx, contaID)
	if errors.Is(err, domainapi.ErrNotFound) {
		return &apiErr{http.StatusUnprocessableEntity, "conta_invalida", "conta não existe"}
	}
	if err != nil {
		return &apiErr{http.StatusBadGateway, "domain_api_indisponivel", err.Error()}
	}
	if conta.UsuarioEmail != usuarioEmail || conta.Status != "ativa" || conta.Tipo != "aposta" {
		return &apiErr{http.StatusUnprocessableEntity, "conta_invalida", "conta não existe, está arquivada ou não é do tipo aposta"}
	}
	return nil
}

// writeDomainWriteError classifies a Sync error from domainapi into the
// right HTTP status: rejected commands are the caller's fault (422),
// everything else (queued/timeout/transport) is this service's
// dependency being unavailable (502).
func (s *Server) writeDomainWriteError(w http.ResponseWriter, err error) {
	if errors.Is(err, domainapi.ErrRejected) {
		writeError(w, http.StatusUnprocessableEntity, "validacao", err.Error())
		return
	}
	writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
}
