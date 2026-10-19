package httpapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter monta as rotas. Duas zonas, como no resto do repo:
//
//   - público: /healthz, o handshake do webhook e o próprio webhook (que se
//     autentica por assinatura HMAC), além de /api/v1/auth/{signup,login} — é
//     por aqui que uma conta nova começa;
//   - autenticado: todo o resto em /api/v1, com Bearer <token de sessão>.
func NewRouter(h *Handlers, origins []string, log *slog.Logger) http.Handler {
	r := chi.NewRouter()
	r.Use(recoverPanic(log))
	r.Use(requestLog(log))

	r.Get("/healthz", h.Healthz)
	r.Get("/webhooks/whatsapp", h.WebhookHandshake)
	r.Post("/webhooks/whatsapp", h.Webhook)

	r.Route("/api/v1", func(r chi.Router) {
		// Públicas: é por aqui que se obtém uma sessão.
		r.Post("/auth/signup", h.Signup)
		r.Post("/auth/login", h.Login)

		r.Group(func(r chi.Router) {
			r.Use(sessionAuth(h.Service.Store, log))

			r.Post("/auth/logout", h.Logout)
			r.Get("/auth/me", h.Me)

			r.Get("/bootstrap", h.Bootstrap)
			r.Put("/state", h.PutState)

			r.Put("/workspace", h.UpdateWorkspace)

			r.Get("/templates", h.Templates)
			r.Post("/templates", h.CreateTemplate)
			r.Patch("/templates/{id}", h.UpdateTemplate)
			r.Post("/templates/{id}/submit", h.SubmitTemplate)
			r.Post("/templates/{id}/sync", h.SyncTemplate)

			r.Get("/channel", h.Channel)
			r.Put("/channel", h.ActivateChannel)
			r.Delete("/channel", h.DeactivateChannel)
			r.Delete("/templates/{id}", h.DeleteTemplate)

			r.Get("/segments", h.Segments)
			r.Post("/segments", h.CreateSegment)
			r.Patch("/segments/{id}", h.UpdateSegment)
			r.Delete("/segments/{id}", h.DeleteSegment)

			r.Get("/contacts", h.Contacts)
			r.Post("/contacts", h.CreateContact)
			r.Post("/contacts/{id}/opt-out", h.OptOut)

			r.Get("/campaigns", h.Campaigns)
			r.Post("/campaigns", h.CreateCampaign)
			r.Patch("/campaigns/{id}", h.UpdateCampaign)
			r.Post("/campaigns/{id}/launch", h.LaunchCampaign)
			r.Post("/campaigns/{id}/test", h.TestSend)
			r.Post("/campaigns/{id}/pause", h.PauseCampaign)
			r.Post("/campaigns/{id}/resume", h.ResumeCampaign)

			r.Get("/flows", h.Flows)
			r.Post("/flows", h.CreateFlow)
			r.Put("/flows/{id}", h.UpdateFlow)
			r.Delete("/flows/{id}", h.DeleteFlow)

			r.Get("/sends", h.Sends)
			r.Get("/activity", h.Activity)

			r.Post("/dev/reset", h.ResetAccount)
			r.Post("/dev/simulate-status", h.SimulateWebhookStatus)
			r.Post("/dev/worker-tick", h.WorkerTick)
		})
	})

	return cors(origins, r)
}

// chiURLParam existe para o handler não precisar importar chi em toda função.
func chiURLParam(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}

func recoverPanic(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic", "path", r.URL.Path, "recover", rec)
					writeError(w, http.StatusInternalServerError, "erro interno")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func requestLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
			// Silencia o ruído de health check em dev.
			if r.URL.Path == "/healthz" {
				return
			}
			log.Info("http", "method", r.Method, "path", r.URL.Path, "caller", callerFrom(r))
		})
	}
}

// Tick é a função que o handler de dev chama para forçar um ciclo da fila.
type tickFunc func(ctx context.Context) (int, error)
