// Ativo (position) routes: GET/POST /api/ativos, GET/POST
// /api/ativos/{id}/movimentos and GET /api/cotacoes. This file is the
// only place that combines domain-api (positions/movements, source of
// truth) with internal/quotes (brapi.dev, cache-first) into the
// rentabilidade numbers the frontend renders -- see
// specs/002-gestao-financeira-modular/contracts/asset-manager-api.md.
package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/quotes"
)

func (s *Server) registrarRotasAtivos() {
	s.mux.HandleFunc("GET /api/ativos", s.handleListAtivos)
	s.mux.HandleFunc("POST /api/ativos", s.handleCreateAtivo)
	s.mux.HandleFunc("POST /api/ativos/{id}/movimentos", s.handleRegisterMovimento)
	s.mux.HandleFunc("GET /api/ativos/{id}/movimentos", s.handleListMovimentos)
	s.mux.HandleFunc("GET /api/cotacoes", s.handleCotacoes)
}

// --- GET /api/ativos --------------------------------------------------

// ativoResponse is the wire shape of one position, raw domain-api
// fields plus the five FR-032 rentabilidade fields computed here.
type ativoResponse struct {
	ID              string  `json:"id"`
	ContaID         string  `json:"contaId"`
	Ticker          string  `json:"ticker"`
	Status          string  `json:"status"`
	QuantidadeAtual float64 `json:"quantidadeAtual"`
	CustoMedio      float64 `json:"custoMedio"`

	CotacaoAtual  float64 `json:"cotacaoAtual"`
	CotacaoEm     string  `json:"cotacaoEm,omitempty"`
	Desatualizada bool    `json:"desatualizada"`

	ValorMercadoAtual       float64 `json:"valorMercadoAtual"`
	CustoTotal              float64 `json:"custoTotal"`
	ProventosRecebidos      float64 `json:"proventosRecebidos"`
	RentabilidadeAbsoluta   float64 `json:"rentabilidadeAbsoluta"`
	RentabilidadePercentual float64 `json:"rentabilidadePercentual"`

	CriadoEm     time.Time `json:"criadoEm"`
	AtualizadoEm time.Time `json:"atualizadoEm"`
}

func (s *Server) handleListAtivos(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	contaID := r.URL.Query().Get("conta")

	ativos, err := s.domain.ListAtivos(r.Context(), id.Email, contaID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_indisponivel", "não foi possível carregar as posições: "+err.Error())
		return
	}

	out := make([]ativoResponse, 0, len(ativos))
	for _, a := range ativos {
		out = append(out, s.montarAtivoResponse(r.Context(), a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ativos": out})
}

// montarAtivoResponse resolves the ativo's current quote (cache-first,
// falling back to domain-api's own last-known value per FR-035) and
// computes the five rentabilidade fields. A fresh (non-cached)
// brapi.dev quote is persisted back to domain-api here -- this is the
// only place in the service that has both the ativoId and the ticker
// together, which is why the quote-persist call lives in this flow and
// not in GET /api/cotacoes.
func (s *Server) montarAtivoResponse(ctx context.Context, a domainapi.Ativo) ativoResponse {
	cotacaoAtual := a.UltimaCotacao
	var cotacaoEm time.Time
	if !a.UltimaCotacaoEm.IsZero() {
		cotacaoEm = a.UltimaCotacaoEm
	}
	desatualizada := true

	q, err := s.quotes.Get(ctx, a.Ticker)
	switch {
	case err == nil:
		cotacaoAtual = q.Preco
		cotacaoEm = q.ObtidoEm
		desatualizada = false
		if q.Fresh {
			// Fire-and-forget by contract (202, not /sync); doing it
			// synchronously here is fine per FR-035's own guidance --
			// it never blocks a person on this write's outcome, it just
			// happens to run before the response is written.
			if perr := s.domain.AtualizarCotacao(ctx, a.ID, domainapi.CotacaoInput{
				Cotacao:  q.Preco,
				ObtidaEm: q.ObtidoEm,
			}); perr != nil {
				log.Printf("[asset-manager] persistir cotação de %s (%s): %v", a.Ticker, a.ID, perr)
			}
		}
	default:
		// brapi.dev failed AND there was no valid cache entry (quotes.Get
		// only returns an error in that case) -- fall back to whatever
		// domain-api last knew, flagged stale. Never surface as a 5xx.
		log.Printf("[asset-manager] cotação de %s indisponível, usando último valor conhecido: %v", a.Ticker, err)
	}

	proventos := s.somarProventos(ctx, a.ID)

	custoTotal := a.QuantidadeAtual * a.CustoMedio
	valorMercado := a.QuantidadeAtual * cotacaoAtual
	rentAbs := valorMercado + proventos - custoTotal
	var rentPct float64
	if custoTotal != 0 {
		rentPct = rentAbs / custoTotal
	}

	resp := ativoResponse{
		ID:                      a.ID,
		ContaID:                 a.ContaID,
		Ticker:                  a.Ticker,
		Status:                  a.Status,
		QuantidadeAtual:         a.QuantidadeAtual,
		CustoMedio:              a.CustoMedio,
		CotacaoAtual:            cotacaoAtual,
		Desatualizada:           desatualizada,
		ValorMercadoAtual:       valorMercado,
		CustoTotal:              custoTotal,
		ProventosRecebidos:      proventos,
		RentabilidadeAbsoluta:   rentAbs,
		RentabilidadePercentual: rentPct,
		CriadoEm:                a.CriadoEm,
		AtualizadoEm:            a.AtualizadoEm,
	}
	if !cotacaoEm.IsZero() {
		resp.CotacaoEm = cotacaoEm.Format(time.RFC3339)
	}
	return resp
}

// somarProventos sums valor_provento across an ativo's "provento"
// movements. domain-api does not (yet) return this pre-aggregated, so
// it is computed here from the full history on every call -- see the
// contract note this diverges from an eventual aggregate field.
func (s *Server) somarProventos(ctx context.Context, ativoID string) float64 {
	movimentos, err := s.domain.ListMovimentos(ctx, ativoID)
	if err != nil {
		log.Printf("[asset-manager] histórico de %s indisponível para somar proventos: %v", ativoID, err)
		return 0
	}
	var total float64
	for _, m := range movimentos {
		if m.Tipo == "provento" {
			total += m.ValorProvento
		}
	}
	return total
}

// --- POST /api/ativos ---------------------------------------------------

// dataLayout is the date-only shape the frontend contract speaks; the
// RFC3339 conversion is what domain-api's time.Time fields decode.
const dataLayout = "2006-01-02"

// dataParaDominio converts "YYYY-MM-DD" into the RFC3339 timestamp the
// domain-worker's command payloads decode; ok=false means invalid.
// Midnight UTC carries no meaning of its own -- the worker's domain
// layer treats movement dates as calendar dates, so the day the person
// picked is what lands.
func dataParaDominio(raw string) (string, bool) {
	t, err := time.Parse(dataLayout, raw)
	if err != nil {
		return "", false
	}
	return t.Format(time.RFC3339), true
}

type criarAtivoRequest struct {
	ContaID       string  `json:"contaId"`
	Ticker        string  `json:"ticker"`
	Quantidade    float64 `json:"quantidade"`
	PrecoUnitario float64 `json:"precoUnitario"`
	Data          string  `json:"data"`
}

func (s *Server) handleCreateAtivo(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())

	var req criarAtivoRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido: "+err.Error())
		return
	}

	var detalhes []erroCampo
	if strings.TrimSpace(req.ContaID) == "" {
		detalhes = append(detalhes, erroCampo{Campo: "contaId", Problema: "obrigatório"})
	}
	if strings.TrimSpace(req.Ticker) == "" {
		detalhes = append(detalhes, erroCampo{Campo: "ticker", Problema: "obrigatório"})
	}
	if req.Quantidade <= 0 {
		detalhes = append(detalhes, erroCampo{Campo: "quantidade", Problema: "deve ser maior que zero"})
	}
	if req.PrecoUnitario <= 0 {
		detalhes = append(detalhes, erroCampo{Campo: "precoUnitario", Problema: "deve ser maior que zero"})
	}
	data := strings.TrimSpace(req.Data)
	dataDominio, dataValida := dataParaDominio(data)
	if data == "" {
		detalhes = append(detalhes, erroCampo{Campo: "data", Problema: "obrigatório"})
	} else if !dataValida {
		detalhes = append(detalhes, erroCampo{Campo: "data", Problema: "deve estar no formato YYYY-MM-DD"})
	}
	if len(detalhes) > 0 {
		writeValidacao(w, "dados do ativo inválidos", detalhes)
		return
	}

	novoID, err := s.domain.CreateAtivo(r.Context(), domainapi.CreateAtivoInput{
		UsuarioEmail:  id.Email,
		ContaID:       req.ContaID,
		Ticker:        strings.ToUpper(strings.TrimSpace(req.Ticker)),
		Quantidade:    req.Quantidade,
		PrecoUnitario: req.PrecoUnitario,
		Data:          dataDominio,
	})
	if err != nil {
		s.writeDomainWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": novoID})
}

// --- POST /api/ativos/{id}/movimentos -----------------------------------

type registrarMovimentoRequest struct {
	Tipo          string   `json:"tipo"`
	Quantidade    *float64 `json:"quantidade,omitempty"`
	PrecoUnitario *float64 `json:"precoUnitario,omitempty"`
	ValorProvento *float64 `json:"valorProvento,omitempty"`
	Data          string   `json:"data"`
}

func (s *Server) handleRegisterMovimento(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	ativoID := r.PathValue("id")

	var req registrarMovimentoRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido: "+err.Error())
		return
	}

	var detalhes []erroCampo
	switch req.Tipo {
	case "compra", "venda":
		if req.Quantidade == nil || *req.Quantidade <= 0 {
			detalhes = append(detalhes, erroCampo{Campo: "quantidade", Problema: "obrigatório e maior que zero para compra/venda"})
		}
		if req.PrecoUnitario == nil || *req.PrecoUnitario <= 0 {
			detalhes = append(detalhes, erroCampo{Campo: "precoUnitario", Problema: "obrigatório e maior que zero para compra/venda"})
		}
	case "provento":
		if req.ValorProvento == nil || *req.ValorProvento <= 0 {
			detalhes = append(detalhes, erroCampo{Campo: "valorProvento", Problema: "obrigatório e maior que zero para provento"})
		}
	default:
		detalhes = append(detalhes, erroCampo{Campo: "tipo", Problema: "deve ser compra, venda ou provento"})
	}
	movData := strings.TrimSpace(req.Data)
	movDataDominio, movDataValida := dataParaDominio(movData)
	if movData == "" {
		detalhes = append(detalhes, erroCampo{Campo: "data", Problema: "obrigatório"})
	} else if !movDataValida {
		detalhes = append(detalhes, erroCampo{Campo: "data", Problema: "deve estar no formato YYYY-MM-DD"})
	}
	if len(detalhes) > 0 {
		writeValidacao(w, "dados do movimento inválidos", detalhes)
		return
	}

	novoID, err := s.domain.RegisterMovement(r.Context(), domainapi.RegisterMovementInput{
		AtivoID:       ativoID,
		UsuarioEmail:  id.Email,
		Tipo:          req.Tipo,
		Quantidade:    req.Quantidade,
		PrecoUnitario: req.PrecoUnitario,
		ValorProvento: req.ValorProvento,
		Data:          movDataDominio,
	})
	if err != nil {
		s.writeDomainWriteError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": novoID})
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
	writeError(w, http.StatusBadGateway, "domain_indisponivel", err.Error())
}

// --- GET /api/ativos/{id}/movimentos -------------------------------------

type movimentoResponse struct {
	ID                 string    `json:"id"`
	AtivoID            string    `json:"ativoId"`
	Tipo               string    `json:"tipo"`
	Quantidade         float64   `json:"quantidade"`
	PrecoUnitario      float64   `json:"precoUnitario"`
	ValorProvento      float64   `json:"valorProvento"`
	ResultadoRealizado float64   `json:"resultadoRealizado"`
	Data               time.Time `json:"data"`
	CriadoEm           time.Time `json:"criadoEm"`
}

func (s *Server) handleListMovimentos(w http.ResponseWriter, r *http.Request) {
	ativoID := r.PathValue("id")

	movimentos, err := s.domain.ListMovimentos(r.Context(), ativoID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_indisponivel", "não foi possível carregar o histórico: "+err.Error())
		return
	}

	out := make([]movimentoResponse, 0, len(movimentos))
	for _, m := range movimentos {
		out = append(out, movimentoResponse{
			ID:                 m.ID,
			AtivoID:            m.AtivoID,
			Tipo:               m.Tipo,
			Quantidade:         m.Quantidade,
			PrecoUnitario:      m.PrecoUnitario,
			ValorProvento:      m.ValorProvento,
			ResultadoRealizado: m.ResultadoRealizado,
			Data:               m.Data,
			CriadoEm:           m.CriadoEm,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"movimentos": out})
}

// --- GET /api/cotacoes ----------------------------------------------------

type cotacaoResponse struct {
	Ticker   string  `json:"ticker"`
	Cotacao  float64 `json:"cotacao,omitempty"`
	ObtidaEm string  `json:"obtidaEm,omitempty"`
	Erro     string  `json:"erro,omitempty"`
}

// handleCotacoes is the manual-refresh route used directly by the
// frontend (not by GET /api/ativos, which resolves its own quotes).
// There is no ativoId here, so there is no FR-035 domain-api fallback
// to reach for -- a ticker that fails just comes back with an "erro"
// note instead of a price; the whole request still answers 200.
func (s *Server) handleCotacoes(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("tickers")
	tickers := splitCSV(raw)
	if len(tickers) == 0 {
		writeValidacao(w, "informe ao menos um ticker", []erroCampo{{Campo: "tickers", Problema: "obrigatório"}})
		return
	}

	found, err := s.quotes.GetMany(r.Context(), tickers)
	out := make([]cotacaoResponse, 0, len(tickers))
	for _, t := range tickers {
		t = strings.ToUpper(strings.TrimSpace(t))
		if q, ok := found[t]; ok {
			out = append(out, cotacaoResponse{
				Ticker:   t,
				Cotacao:  q.Preco,
				ObtidaEm: q.ObtidoEm.Format(time.RFC3339),
			})
			continue
		}
		msg := "cotação indisponível"
		if err != nil {
			msg = err.Error()
		} else if errors.Is(err, quotes.ErrNotFound) {
			msg = "ticker não encontrado"
		}
		out = append(out, cotacaoResponse{Ticker: t, Erro: msg})
	}
	writeJSON(w, http.StatusOK, map[string]any{"cotacoes": out})
}

// splitCSV reads a comma-separated query value into a trimmed,
// non-empty slice.
func splitCSV(v string) []string {
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
