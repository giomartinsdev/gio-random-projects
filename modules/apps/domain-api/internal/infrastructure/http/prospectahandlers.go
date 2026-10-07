// prospecta handlers: domain-api's surface for the Prospecta context
// (specs/004-prospecta). Reads are projections straight from Postgres (só
// leitura; o domain-worker escreve); writes build the {action, payload}
// envelope and answer 202 — the sync path stays for callers that must wait.
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/prospecta"
	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

type ProspectaHandlers struct {
	reads    domainprospecta.ReadRepository
	commands application.CommandPublisher
	log      *slog.Logger
}

func NewProspectaHandlers(reads domainprospecta.ReadRepository, commands application.CommandPublisher, log *slog.Logger) *ProspectaHandlers {
	return &ProspectaHandlers{reads: reads, commands: commands, log: log}
}

// CreateCompany é o POST /companies: valida o mínimo na borda e publica o
// comando CreateCompany. 202 na hora — quem aplica é o domain-worker.
func (h *ProspectaHandlers) CreateCompany(w http.ResponseWriter, r *http.Request) {
	var in appprospecta.CreateCompanyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.TenantID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "tenant_id is required"})
		return
	}
	if in.Name == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "name is required"})
		return
	}
	h.publish(w, r, application.ActionCreateCompany, in)
}

// DefineICP é o POST /companies/{companyId}/icp.
func (h *ProspectaHandlers) DefineICP(w http.ResponseWriter, r *http.Request) {
	var in appprospecta.DefineICPInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	in.CompanyID = chi.URLParam(r, "companyId")
	if in.TenantID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "tenant_id is required"})
		return
	}
	if in.CompanyID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "company_id is required"})
		return
	}
	if in.Definition == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "definition is required"})
		return
	}
	h.publish(w, r, application.ActionDefineICP, in)
}

// GetCompany é o GET /companies/{id}?tenant_id=...: a projeção da empresa com
// o ICP quando já definido.
func (h *ProspectaHandlers) GetCompany(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	company, err := h.reads.GetCompany(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "company not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get company", err)
		return
	}
	writeJSON(w, http.StatusOK, company)
}

// GetUserByEmail é o GET /users/by-email/{email}: a leitura do login. É
// cross-tenant DE PROPÓSITO — o e-mail é único global e o login acha o usuário
// antes de saber o tenant —, então NÃO exige tenant_id (diferente de todas as
// outras leituras do Prospecta). Devolve o password_hash em rede interna, para o
// login verificar o bcrypt; 404 quando não existe.
func (h *ProspectaHandlers) GetUserByEmail(w http.ResponseWriter, r *http.Request) {
	email := chi.URLParam(r, "email")
	if email == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "email is required"})
		return
	}
	user, err := h.reads.GetUserByEmail(r.Context(), email)
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "user not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get user by email", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

// ListCampaigns é o GET /campaigns?tenant_id=&limit=&cursor=.
func (h *ProspectaHandlers) ListCampaigns(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	page, err := h.reads.ListCampaigns(r.Context(), tenantID, limitQuery(r), r.URL.Query().Get("cursor"))
	if err != nil {
		h.readError(w, r, "list campaigns", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetCampaign é o GET /campaigns/{id}?tenant_id=.
func (h *ProspectaHandlers) GetCampaign(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	campaign, err := h.reads.GetCampaign(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "campaign not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get campaign", err)
		return
	}
	writeJSON(w, http.StatusOK, campaign)
}

// ListLeads é o GET /leads?tenant_id=&campaign_id=&status=&fit_min=&limit=&cursor=.
func (h *ProspectaHandlers) ListLeads(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	filter := domainprospecta.LeadFilter{
		CampaignID: r.URL.Query().Get("campaign_id"),
		Status:     r.URL.Query().Get("status"),
		FitMin:     intQuery(r, "fit_min"),
	}
	page, err := h.reads.ListLeads(r.Context(), tenantID, filter, limitQuery(r), r.URL.Query().Get("cursor"))
	if err != nil {
		h.readError(w, r, "list leads", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetLead é o GET /leads/{id}?tenant_id= (detalhe: enriched, timeline, última
// mensagem).
func (h *ProspectaHandlers) GetLead(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	lead, err := h.reads.GetLead(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "lead not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get lead", err)
		return
	}
	writeJSON(w, http.StatusOK, lead)
}

// ListConversations é o GET /conversations?tenant_id=&limit=&cursor=.
func (h *ProspectaHandlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	page, err := h.reads.ListConversations(r.Context(), tenantID, limitQuery(r), r.URL.Query().Get("cursor"))
	if err != nil {
		h.readError(w, r, "list conversations", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetConversation é o GET /conversations/{id}?tenant_id= (thread completa).
func (h *ProspectaHandlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	conv, err := h.reads.GetConversation(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "conversation not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get conversation", err)
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

// GetMessage é o GET /messages/{id}?tenant_id=: a projeção que a prospecta-api
// lê para o guardrail do approve (409 fora de "drafted").
func (h *ProspectaHandlers) GetMessage(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	message, err := h.reads.GetMessage(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "message not found"})
		return
	}
	if err != nil {
		h.readError(w, r, "get message", err)
		return
	}
	writeJSON(w, http.StatusOK, message)
}

// AgentActivity é o GET /agent/activity?tenant_id=: um stream SSE dos runs mais
// recentes do tenant. O feed é um poll do banco a cada 2s (o domain-api não tem
// broker de eventos do worker para assinar); cada run novo — por (run_id, state,
// metric) — é emitido uma vez, do mais antigo para o mais novo, no formato do
// contrato:
//
//	event: agent
//	data: {"run_id":"...","agent":"prospector","state":"running","metric":{...}}
//
// O ctx do request é a vida do stream: quando o cliente desconecta, r.Context()
// é cancelado, o ticker para e o handler retorna — sem goroutine pendurada.
func (h *ProspectaHandlers) AgentActivity(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "tenant_id is required"})
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "streaming not supported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	seen := map[string]struct{}{}
	poll := func() {
		events, err := h.reads.ListActivity(r.Context(), tenantID, 50)
		if err != nil {
			// Um erro que coincide com o cliente indo embora é a desconexão
			// normal, não uma falha: não vira log de erro.
			if r.Context().Err() != nil {
				return
			}
			h.log.ErrorContext(r.Context(), "prospecta activity poll", "error", err)
			return
		}
		// ListActivity devolve os mais recentes primeiro; o feed conta a
		// história na ordem em que aconteceu, então emite do mais antigo.
		for i := len(events) - 1; i >= 0; i-- {
			ev := events[i]
			key := eventKey(ev)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			payload, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: agent\ndata: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}

	for {
		poll()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func eventKey(ev domainprospecta.AgentRunEvent) string {
	metric, _ := json.Marshal(ev.Metric)
	return ev.RunID + "|" + ev.State + "|" + string(metric)
}

// tenant lê o tenant_id da query (o padrão de GetCompany) e responde 400 se
// faltar.
func (h *ProspectaHandlers) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "tenant_id is required"})
		return "", false
	}
	return tenantID, true
}

func (h *ProspectaHandlers) readError(w http.ResponseWriter, r *http.Request, op string, err error) {
	h.log.ErrorContext(r.Context(), "prospecta "+op, "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}

func (h *ProspectaHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.log.ErrorContext(r.Context(), "marshal prospecta command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.log.ErrorContext(r.Context(), "publish prospecta command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

// limitQuery normaliza o limit como a prospecta-api (default 20, teto 100),
// para o teto ser o mesmo dos dois lados.
func limitQuery(r *http.Request) int {
	n := intQuery(r, "limit")
	if n <= 0 {
		return 20
	}
	if n > 100 {
		return 100
	}
	return n
}

func intQuery(r *http.Request, key string) int {
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return 0
	}
	return n
}
