// Package httpapi is prospecta-api's interface layer: the JSON handlers for
// every Prospecta slice, their error mapping, the X-API-Key guard, and the CORS
// policy the SPA needs to call this host cross-origin.
//
// It holds no state beyond the application services and knows nothing about
// HTTP clients or brokers -- those live in internal/infrastructure. NewRouter
// wires the whole surface so main.go and the tests exercise the same routing.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/auth"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/infrastructure"
)

// Services bundles the use cases the HTTP layer exposes, one per slice. Passing
// them as a struct keeps NewRouter's signature stable as slices are added.
type Services struct {
	Companies *application.CompanyService
	Campaigns *application.CampaignService
	Leads     *application.LeadService
	Messaging *application.MessagingService
	Activity  *application.ActivityService
	Agent     *application.AgentService
}

// Config is everything the transport needs about identity and CORS, passed as a
// struct so adding a field never changes the constructor's arity.
//
//   - APIKey empty lets business requests through with no identity (dev);
//   - TenantID is the operator's fixed tenant, used when the caller presents
//     X-API-Key instead of a session;
//   - Auth is the password-session service; nil disables /auth (503);
//   - AllowedOrigins is the exact-origin CORS allowlist the SPA needs.
type Config struct {
	APIKey         string
	TenantID       string
	Auth           *auth.Service
	AllowedOrigins []string
}

// Handlers is the transport surface for the Prospecta context.
type Handlers struct {
	services Services
	auth     *auth.Service
	apiKey   string
	tenantID string
	log      *slog.Logger
}

func New(services Services, cfg Config, log *slog.Logger) *Handlers {
	return &Handlers{
		services: services,
		auth:     cfg.Auth,
		apiKey:   cfg.APIKey,
		tenantID: cfg.TenantID,
		log:      log,
	}
}

// NewRouter assembles the full HTTP surface:
//
//   - GET /healthz and the /auth/* routes are public;
//   - every business route sits behind the identity guard (session OR
//     X-API-Key);
//   - all of it is wrapped in the SPA's credentialed CORS policy.
//
// Kept in one place so main.go and the integration tests build the exact same
// mux -- a test that re-implemented the routing would not be testing it.
func NewRouter(cfg Config, services Services, log *slog.Logger) http.Handler {
	h := New(services, cfg, log)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	authRoutes(root, h)

	business := http.NewServeMux()
	business.HandleFunc("POST /companies", h.CreateCompany)
	business.HandleFunc("GET /companies/{id}", h.GetCompany)
	business.HandleFunc("POST /companies/{id}/icp", h.DefineICP)

	business.HandleFunc("POST /campaigns", h.CreateCampaign)
	business.HandleFunc("GET /campaigns", h.ListCampaigns)
	business.HandleFunc("GET /campaigns/{id}", h.GetCampaign)
	business.HandleFunc("POST /campaigns/{id}/start", h.StartCampaign)

	business.HandleFunc("GET /leads", h.ListLeads)
	business.HandleFunc("GET /leads/{id}", h.GetLead)
	business.HandleFunc("POST /leads", h.CreateLead)
	business.HandleFunc("POST /leads/{id}/qualify", h.QualifyLead)

	business.HandleFunc("GET /conversations", h.ListConversations)
	business.HandleFunc("GET /conversations/{id}", h.GetConversation)
	business.HandleFunc("POST /messages", h.CreateMessage)
	business.HandleFunc("POST /messages/{id}/approve", h.ApproveMessage)

	// Agent routes. The run is created by RequestProspect (it arrives in the
	// ProspectRequested event with its run_id): there is deliberately NO
	// POST /agent/runs — only the update.
	business.HandleFunc("POST /agent/runs/{id}", h.UpdateAgentRun)

	// LGPD guardrail (never 404) and cross-tenant WhatsApp-number resolution.
	business.HandleFunc("GET /opt-outs/{lead_id}", h.GetOptOut)
	business.HandleFunc("GET /leads/by-phone/{number}", h.GetLeadByPhone)

	business.HandleFunc("GET /agent/activity", h.AgentActivity)

	root.Handle("/", h.requireIdentity(business))

	return cors(cfg.AllowedOrigins, root)
}

// CreateCompany handles POST /companies. Validates, publishes CreateCompany,
// answers 202 with the command id.
func (h *Handlers) CreateCompany(w http.ResponseWriter, r *http.Request) {
	var in application.CreateCompanyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Companies.CreateCompany(r.Context(), in)
	if err != nil {
		h.writeCommandError(w, r, "CreateCompany", err)
		return
	}
	writeAccepted(w, id)
}

// GetCompany handles GET /companies/{id}. A missing projection is 404.
func (h *Handlers) GetCompany(w http.ResponseWriter, r *http.Request) {
	company, err := h.services.Companies.GetCompany(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeReadError(w, r, "empresa não encontrada", "ler a empresa", err)
		return
	}
	writeJSON(w, http.StatusOK, company)
}

// DefineICP handles POST /companies/{id}/icp. The company id comes from the
// path; an empty definition is rejected before publishing (422).
func (h *Handlers) DefineICP(w http.ResponseWriter, r *http.Request) {
	var in application.DefineICPInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Companies.DefineICP(r.Context(), r.PathValue("id"), in)
	if err != nil {
		h.writeCommandError(w, r, "DefineICP", err)
		return
	}
	writeAccepted(w, id)
}

// writeCommandError maps a publish failure to a status. Validation errors are
// 422 (nothing was published); a not-drafted message is 409; a missing target
// is 404; an unconfigured pair is 503; anything else is 502 because the command
// did not reach the domain pair.
func (h *Handlers) writeCommandError(w http.ResponseWriter, r *http.Request, action string, err error) {
	switch {
	case errors.Is(err, domain.ErrCompanyNameRequired),
		errors.Is(err, domain.ErrCompanyIDRequired),
		errors.Is(err, domain.ErrICPDefinitionRequired),
		errors.Is(err, domain.ErrCampaignCompanyRequired),
		errors.Is(err, domain.ErrCampaignNameRequired),
		errors.Is(err, domain.ErrCampaignICPRequired),
		errors.Is(err, domain.ErrCampaignIDRequired),
		errors.Is(err, domain.ErrLeadIDRequired),
		errors.Is(err, domain.ErrFitOutOfRange),
		errors.Is(err, domain.ErrMessageLeadRequired),
		errors.Is(err, domain.ErrMessageChannelRequired),
		errors.Is(err, domain.ErrMessageContentRequired),
		errors.Is(err, domain.ErrCampaignRequired),
		errors.Is(err, domain.ErrDomainRequired),
		errors.Is(err, domain.ErrRunIDRequired),
		errors.Is(err, domain.ErrInvalidRunState):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, domain.ErrMessageNotDrafted):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "recurso não encontrado")
	case errors.Is(err, infrastructure.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, "par de domínio não configurado")
	default:
		h.log.ErrorContext(r.Context(), "publish command", "action", action, "error", err)
		writeError(w, http.StatusBadGateway, "falha ao publicar o comando")
	}
}

// writeReadError maps a read failure to a status. A missing record is 404, an
// unconfigured pair is 503, anything else is 502.
func (h *Handlers) writeReadError(w http.ResponseWriter, r *http.Request, notFoundMsg, what string, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, notFoundMsg)
	case errors.Is(err, application.ErrOptOutUnavailable),
		errors.Is(err, infrastructure.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, "par de domínio não configurado")
	default:
		h.log.ErrorContext(r.Context(), "read", "what", what, "error", err)
		writeError(w, http.StatusBadGateway, "falha ao ler do par de domínio")
	}
}

// cors allows the SPA's origin(s) to call this host. An empty allowlist sends
// no CORS headers (curl and server-to-server still work).
//
// For the session cookie to ride a cross-origin fetch, the response must echo
// the EXACT origin (never "*") and set Access-Control-Allow-Credentials: true.
func cors(origins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && originAllowed(origins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers",
				"Content-Type, X-API-Key, traceparent, tracestate, baggage")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func originAllowed(origins []string, origin string) bool {
	for _, allowed := range origins {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return false
}

// intQuery parses an optional integer query param; absent or malformed yields 0
// (meaning "unset" for the service layer).
func intQuery(r *http.Request, name string) int {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	return n
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeAccepted is the 202 command body: the pair's command id plus the status
// marker the contract fixes.
func writeAccepted(w http.ResponseWriter, id string) {
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id, "status": "accepted"})
}
