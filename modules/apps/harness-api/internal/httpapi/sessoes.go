// Handlers das sessões (US1–US5), com os shapes de resposta do
// contracts/api.md. O dono/criador/autor de toda resposta sai do cache
// usuarios (research D7) via nomes; os limites de campo chegam do store
// como ValidacaoError e viram 422 com detalhes[{campo,problema}].
package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api/internal/store"
)

// registrarRotasSessoes hangs the session routes on the server's mux;
// called from New() so every route runs behind the auth middleware.
func (s *Server) registrarRotasSessoes() {
	s.mux.HandleFunc("POST /api/sessoes", s.handleCriarSessao)
	s.mux.HandleFunc("GET /api/sessoes", s.handleListarSessoes)
	s.mux.HandleFunc("GET /api/sessoes/{id}", s.handleObterSessao)
	s.mux.HandleFunc("GET /api/sessoes/{id}/eventos", s.handleEventosSessao)
	s.mux.HandleFunc("POST /api/sessoes/{id}/retomar", s.handleRetomarSessao)
	s.mux.HandleFunc("PATCH /api/sessoes/{id}", s.handleEditarSessao)
	s.mux.HandleFunc("POST /api/sessoes/{id}/status", s.handleMudarStatus)
}

// ─── Shapes de resposta ───────────────────────────────────────────────

type usuarioView struct {
	Email string `json:"email"`
	Nome  string `json:"nome"`
}

// sessaoView is the plain session body (POST 201): every field, with
// dono_atual on it (FR-012).
type sessaoView struct {
	ID               int64       `json:"id"`
	Titulo           string      `json:"titulo"`
	Objetivo         string      `json:"objetivo"`
	Repo             *string     `json:"repo"`
	ContextoMD       *string     `json:"contexto_md"`
	ProximosPassosMD *string     `json:"proximos_passos_md"`
	Status           string      `json:"status"`
	Criador          usuarioView `json:"criador"`
	DonoAtual        usuarioView `json:"dono_atual"`
	PRLink           *string     `json:"pr_link"`
	OrigemID         *int64      `json:"origem_id"`
	CriadoEm         int64       `json:"criado_em"`
	AtualizadoEm     int64       `json:"atualizado_em"`
}

// resumoView is the embedded summary of origem/extensoes in the detail
// response. The contract spells dono_atual only for extensões; the
// omitempty keeps the origem shape exactly as documented.
type resumoView struct {
	ID        int64        `json:"id"`
	Titulo    string       `json:"titulo"`
	Status    string       `json:"status"`
	DonoAtual *usuarioView `json:"dono_atual,omitempty"`
}

// sessaoDetalheView is the GET/PATCH/retomar/status body: the session
// plus its extension links.
type sessaoDetalheView struct {
	sessaoView
	Origem    *resumoView  `json:"origem"`
	Extensoes []resumoView `json:"extensoes"`
}

type eventoView struct {
	ID       int64           `json:"id"`
	Tipo     string          `json:"tipo"`
	Autor    usuarioView     `json:"autor"`
	Payload  json.RawMessage `json:"payload"`
	CriadoEm int64           `json:"criado_em"`
}

// nomes resolves e-mails to display names through the usuarios cache
// (research D7), once per request; an e-mail never seen falls back to
// its local part.
type nomes struct {
	st    *store.Store
	cache map[string]usuarioView
}

func (s *Server) nomes() *nomes {
	return &nomes{st: s.store, cache: map[string]usuarioView{}}
}

func (n *nomes) view(email string) usuarioView {
	if v, ok := n.cache[email]; ok {
		return v
	}
	v := usuarioView{Email: email, Nome: emailLocal(email)}
	if u, ok, _ := n.st.UsuarioPorEmail(email); ok && u.Nome != "" {
		v.Nome = u.Nome
	}
	n.cache[email] = v
	return v
}

func (n *nomes) sessaoView(sess store.Sessao) sessaoView {
	return sessaoView{
		ID:               sess.ID,
		Titulo:           sess.Titulo,
		Objetivo:         sess.Objetivo,
		Repo:             sess.Repo,
		ContextoMD:       sess.ContextoMD,
		ProximosPassosMD: sess.ProximosPassosMD,
		Status:           sess.Status,
		Criador:          n.view(sess.CriadorEmail),
		DonoAtual:        n.view(sess.DonoAtualEmail),
		PRLink:           sess.PRLink,
		OrigemID:         sess.OrigemID,
		CriadoEm:         sess.CriadoEm,
		AtualizadoEm:     sess.AtualizadoEm,
	}
}

func (n *nomes) resumoView(sess store.Sessao, comDono bool) resumoView {
	r := resumoView{ID: sess.ID, Titulo: sess.Titulo, Status: sess.Status}
	if comDono {
		dono := n.view(sess.DonoAtualEmail)
		r.DonoAtual = &dono
	}
	return r
}

// detalheSessao assembles the detail view: origem (when the session is
// an extension) and the extensoes list (its children).
func (s *Server) detalheSessao(n *nomes, sess store.Sessao) sessaoDetalheView {
	detalhe := sessaoDetalheView{sessaoView: n.sessaoView(sess), Extensoes: []resumoView{}}
	if sess.OrigemID != nil {
		if origem, err := s.store.GetSessao(*sess.OrigemID); err == nil {
			detalhe.Origem = &resumoView{ID: origem.ID, Titulo: origem.Titulo, Status: origem.Status}
		}
	}
	id := sess.ID
	if filhas, err := s.store.ListSessoes(store.Filtros{OrigemID: &id}); err == nil {
		for _, f := range filhas {
			detalhe.Extensoes = append(detalhe.Extensoes, n.resumoView(f, true))
		}
	}
	return detalhe
}

// resumoObjetivo truncates the objetivo for list cards; 140 runes keeps
// a two-line card with pt-BR text intact.
const maxResumoObjetivo = 140

func resumoObjetivo(texto string) string {
	runes := []rune(texto)
	if len(runes) <= maxResumoObjetivo {
		return texto
	}
	return string(runes[:maxResumoObjetivo]) + "…"
}

type sessaoListaView struct {
	ID             int64       `json:"id"`
	Titulo         string      `json:"titulo"`
	Repo           *string     `json:"repo"`
	Status         string      `json:"status"`
	DonoAtual      usuarioView `json:"dono_atual"`
	Criador        usuarioView `json:"criador"`
	OrigemID       *int64      `json:"origem_id"`
	AtualizadoEm   int64       `json:"atualizado_em"`
	ResumoObjetivo string      `json:"resumo_objetivo"`
}

// ─── Handlers ─────────────────────────────────────────────────────────

// criarSessaoReq uses pointers throughout so an extension can tell
// "field not sent" (copy the origin's contexto/proximos passos) from
// "sent empty" (override the copy with nothing).
type criarSessaoReq struct {
	Titulo           *string `json:"titulo"`
	Objetivo         *string `json:"objetivo"`
	Repo             *string `json:"repo"`
	ContextoMD       *string `json:"contexto_md"`
	ProximosPassosMD *string `json:"proximos_passos_md"`
	OrigemID         *int64  `json:"origem_id"`
}

func (s *Server) handleCriarSessao(w http.ResponseWriter, r *http.Request) {
	ident, _ := IdentityFrom(r.Context())
	var req criarSessaoReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "validacao", "corpo JSON inválido")
		return
	}

	valor := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	nova := store.NovaSessao{
		Titulo:           valor(req.Titulo),
		Objetivo:         valor(req.Objetivo),
		Repo:             valor(req.Repo),
		ContextoMD:       req.ContextoMD,
		ProximosPassosMD: req.ProximosPassosMD,
		OrigemID:         req.OrigemID,
		CriadorEmail:     ident.Email,
	}
	sess, err := s.store.CreateSessao(nova)
	if s.responderErroSessao(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, s.nomes().sessaoView(sess))
}

// listarSessoes answers GET /api/sessoes with the team list (US-3);
// every authenticated reader sees everything, no per-user filter.
func (s *Server) handleListarSessoes(w http.ResponseWriter, r *http.Request) {
	var filtros store.Filtros
	q := r.URL.Query()
	for _, st := range q["status"] {
		if st != store.StatusEmAndamento && st != store.StatusEntregue && st != store.StatusArquivada {
			writeValidacao(w, "status inválido", []erroCampo{{
				Campo:    "status",
				Problema: "valores aceitos: em_andamento, entregue, arquivada",
			}})
			return
		}
		filtros.Statuses = append(filtros.Statuses, st)
	}
	filtros.Dono = strings.TrimSpace(q.Get("dono"))
	if origem := q.Get("origem"); origem != "" {
		id, err := strconv.ParseInt(origem, 10, 64)
		if err != nil || id <= 0 {
			writeValidacao(w, "origem inválida", []erroCampo{{
				Campo:    "origem",
				Problema: "deve ser o id numérico de uma sessão",
			}})
			return
		}
		filtros.OrigemID = &id
	}

	sessoes, err := s.store.ListSessoes(filtros)
	if s.responderErroSessao(w, err) {
		return
	}
	n := s.nomes()
	lista := make([]sessaoListaView, len(sessoes))
	for i, sess := range sessoes {
		lista[i] = sessaoListaView{
			ID:             sess.ID,
			Titulo:         sess.Titulo,
			Repo:           sess.Repo,
			Status:         sess.Status,
			DonoAtual:      n.view(sess.DonoAtualEmail),
			Criador:        n.view(sess.CriadorEmail),
			OrigemID:       sess.OrigemID,
			AtualizadoEm:   sess.AtualizadoEm,
			ResumoObjetivo: resumoObjetivo(sess.Objetivo),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessoes": lista})
}

func (s *Server) handleObterSessao(w http.ResponseWriter, r *http.Request) {
	id, ok := sessaoIDDaRota(r)
	if !ok {
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
		return
	}
	sess, err := s.store.GetSessao(id)
	if s.responderErroSessao(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.detalheSessao(s.nomes(), sess))
}

// handleEventosSessao serves the timeline in ascending order (FR-007).
func (s *Server) handleEventosSessao(w http.ResponseWriter, r *http.Request) {
	id, ok := sessaoIDDaRota(r)
	if !ok {
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
		return
	}
	if _, err := s.store.GetSessao(id); s.responderErroSessao(w, err) {
		return
	}
	eventos, err := s.store.ListEventos(id)
	if s.responderErroSessao(w, err) {
		return
	}
	n := s.nomes()
	lista := make([]eventoView, len(eventos))
	for i, e := range eventos {
		var payload json.RawMessage
		if e.Payload != "" {
			payload = json.RawMessage(e.Payload)
		}
		lista[i] = eventoView{
			ID:       e.ID,
			Tipo:     e.Tipo,
			Autor:    n.view(e.AutorEmail),
			Payload:  payload,
			CriadoEm: e.CriadoEm,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"eventos": lista})
}

// handleRetomarSessao hands the baton to the caller (US-2, FR-005). The
// body carries no fields (contract), so it is not decoded -- "{}" and a
// truly empty body are both fine.
func (s *Server) handleRetomarSessao(w http.ResponseWriter, r *http.Request) {
	ident, _ := IdentityFrom(r.Context())
	id, ok := sessaoIDDaRota(r)
	if !ok {
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
		return
	}
	sess, _, err := s.store.RetomarSessao(id, ident.Email)
	if s.responderErroSessao(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.detalheSessao(s.nomes(), sess))
}

// editarSessaoReq is the PATCH body: base_atualizado_em is what the
// client saw when it opened the editor, force overrides the conflict
// (last write wins, US-2).
type editarSessaoReq struct {
	ContextoMD       *string `json:"contexto_md"`
	ProximosPassosMD *string `json:"proximos_passos_md"`
	BaseAtualizadoEm *int64  `json:"base_atualizado_em"`
	Force            bool    `json:"force"`
}

func (s *Server) handleEditarSessao(w http.ResponseWriter, r *http.Request) {
	ident, _ := IdentityFrom(r.Context())
	id, ok := sessaoIDDaRota(r)
	if !ok {
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
		return
	}
	var req editarSessaoReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "validacao", "corpo JSON inválido")
		return
	}

	campos := store.CamposConteudo{ContextoMD: req.ContextoMD, ProximosPassosMD: req.ProximosPassosMD}
	base := int64(0)
	if req.BaseAtualizadoEm != nil {
		base = *req.BaseAtualizadoEm
	}
	sess, err := s.store.UpdateConteudo(id, ident.Email, campos, base, req.Force)
	if errors.Is(err, store.ErrConflito) {
		vigente, getErr := s.store.GetSessao(id)
		if getErr != nil {
			s.responderErroSessao(w, getErr)
			return
		}
		writeJSON(w, http.StatusConflict, map[string]any{
			"erro": map[string]any{
				"codigo":   "conflito",
				"mensagem": "conteúdo mudou desde a leitura; reenvie com force:true para sobrescrever",
			},
			"sessao": s.detalheSessao(s.nomes(), vigente),
		})
		return
	}
	if s.responderErroSessao(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.detalheSessao(s.nomes(), sess))
}

// mudarStatusReq is the POST /status body: acao picks the transition,
// pr_link only matters for entregar (contract).
type mudarStatusReq struct {
	Acao   string  `json:"acao"`
	PRLink *string `json:"pr_link"`
}

func (s *Server) handleMudarStatus(w http.ResponseWriter, r *http.Request) {
	ident, _ := IdentityFrom(r.Context())
	id, ok := sessaoIDDaRota(r)
	if !ok {
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
		return
	}
	var req mudarStatusReq
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "validacao", "corpo JSON inválido")
		return
	}

	sess, err := s.store.UpdateStatus(id, ident.Email, req.Acao, req.PRLink)
	if s.responderErroSessao(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.detalheSessao(s.nomes(), sess))
}

// ─── Helpers ──────────────────────────────────────────────────────────

// sessaoIDDaRota parses the {id} path segment; anything that is not a
// positive number is simply a session that does not exist (404).
func sessaoIDDaRota(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// responderErroSessao maps the store's typed errors to the contract
// bodies. ErrConflito is deliberately left out: only PATCH can answer it
// and it needs the current state in the body. Returns true when it
// wrote a response.
func (s *Server) responderErroSessao(w http.ResponseWriter, err error) bool {
	var validacao *store.ValidacaoError
	var transicao *store.TransicaoInvalidaError
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNaoEncontrado):
		writeError(w, http.StatusNotFound, "nao_encontrado", "sessão não encontrada")
	case errors.As(err, &validacao):
		detalhes := make([]erroCampo, len(validacao.Problemas))
		for i, p := range validacao.Problemas {
			detalhes[i] = erroCampo{Campo: p.Campo, Problema: p.Problema}
		}
		writeValidacao(w, "dados inválidos", detalhes)
	case errors.As(err, &transicao):
		writeError(w, http.StatusUnprocessableEntity, "transicao_invalida", transicao.Error())
	case errors.Is(err, store.ErrOrigemInexistente):
		writeValidacao(w, err.Error(), []erroCampo{{
			Campo:    "origem_id",
			Problema: "sessão de origem não existe",
		}})
	default:
		log.Printf("[harness] erro inesperado: %v", err)
		writeError(w, http.StatusInternalServerError, "erro_interno", "erro inesperado")
	}
	return true
}
