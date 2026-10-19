package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/seed"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

type Handlers struct {
	Service *Service
	Log     *slog.Logger

	// Públicos / de dev.
	WebhookVerifyToken string
	AppSecret          string
	AllowDevActions    bool

	// Tick força um ciclo da fila (usado só pela rota de dev).
	Tick func(ctx context.Context) (int, error)
}

/* ------------------------------------------------------------------ saúde */

func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	dbOK := "ok"
	if err := h.Service.Store.Pool().Ping(r.Context()); err != nil {
		dbOK = "down"
	}
	status := http.StatusOK
	if dbOK != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"status":   map[bool]string{true: "ok", false: "degraded"}[dbOK == "ok"],
		"database": dbOK,
		"provider": h.Service.Provider.Name(),
		"live":     h.Service.Provider.Name() == "meta-cloud",
	})
}

/* -------------------------------------------------------------- bootstrap */

func (h *Handlers) Bootstrap(w http.ResponseWriter, r *http.Request) {
	payload, err := h.Service.Bootstrap(r.Context())
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// PutState grava o documento editorial que a SPA manda. É o ponto de escrita
// das telas de edição (templates, audiências, campanhas e o canvas de fluxo):
// o canvas salva o grafo inteiro, e um PATCH por nó durante um arrasto geraria
// dezenas de requisições e estados intermediários que ninguém quer persistir.
//
// O que o servidor é dono — status de template, fila, métricas — é preservado
// pelo store, não pelo cliente. Um navegador com a tela aberta não pode
// "desfazer" um webhook de entrega só porque salvou um fluxo.
func (h *Handlers) PutState(w http.ResponseWriter, r *http.Request) {
	var doc store.EditorialState
	if err := decode(r, &doc); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	if doc.Workspace != nil && doc.Workspace.WhatsAppNumber != "" {
		normalized, err := domain.NormalizePhone(doc.Workspace.WhatsAppNumber)
		if err != nil {
			writeDomainError(w, h.Log, err)
			return
		}
		doc.Workspace.WhatsAppNumber = normalized
	}
	if err := h.Service.Store.ReplaceState(r.Context(), h.Service.Workspace, doc); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	payload, err := h.Service.Bootstrap(r.Context())
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

/* --------------------------------------------------------------- workspace */

func (h *Handlers) UpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	var in domain.Workspace
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	if in.WhatsAppNumber != "" {
		normalized, err := domain.NormalizePhone(in.WhatsAppNumber)
		if err != nil {
			writeDomainError(w, h.Log, err)
			return
		}
		in.WhatsAppNumber = normalized
	}
	if err := h.Service.Store.UpdateWorkspace(r.Context(), h.Service.Workspace, in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	h.respondWorkspace(w, r)
}

func (h *Handlers) respondWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, err := h.Service.Store.Workspace(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

/* --------------------------------------------------------------- templates */

func (h *Handlers) Templates(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Templates(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handlers) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var in domain.TemplateInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	// "Salvar rascunho" não fala com a Meta; "enviar para análise" sim. A
	// diferença é um parâmetro explícito, não um status vindo do cliente — o
	// cliente não decide o que a Meta aprovou.
	var t domain.Template
	var err error
	if r.URL.Query().Get("submit") == "false" {
		t, err = h.Service.SaveDraft(r.Context(), in)
	} else {
		t, err = h.Service.SubmitTemplate(r.Context(), in)
	}
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// UpdateTemplate: `id` na URL. Reenvia para a Meta? Não — o corpo mudou, então
// volta para rascunho; a submissão é uma ação explícita (POST /submit), para o
// operador não gastar submissão a cada tecla salva.
func (h *Handlers) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	var in domain.TemplateInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	t, err := h.Service.UpdateTemplate(r.Context(), pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *Handlers) SubmitTemplate(w http.ResponseWriter, r *http.Request) {
	tpl, err := h.Service.Store.Template(r.Context(), h.Service.Workspace, pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	in := domain.TemplateInput{
		Name: tpl.Name, DisplayName: tpl.DisplayName, Channel: tpl.Channel,
		Category: tpl.Category, Language: tpl.Language, Header: tpl.Header,
		Body: tpl.Body, Footer: tpl.Footer, Buttons: tpl.Buttons, Variables: tpl.Variables,
	}
	extID, status, err := h.Service.Provider.CreateTemplate(r.Context(), tpl)
	if err != nil {
		writeDomainError(w, h.Log, domain.Invalid("template", "a Meta recusou: "+err.Error()))
		return
	}
	if err := h.Service.Store.MarkTemplateSubmitted(r.Context(), h.Service.Workspace, tpl.ID, extID, status); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = in
	updated, err := h.Service.Store.Template(r.Context(), h.Service.Workspace, tpl.ID)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.Service.Store.LogActivity(r.Context(), h.Service.Workspace, "template",
		"Template submetido", updated.Name+" · "+status, updated.ID)
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handlers) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.DeleteTemplate(r.Context(), h.Service.Workspace, pathID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* --------------------------------------------------------------- audiências */

func (h *Handlers) Segments(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Segments(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handlers) CreateSegment(w http.ResponseWriter, r *http.Request) {
	var in domain.SegmentInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	seg, err := h.Service.Store.CreateSegment(r.Context(), h.Service.Workspace, in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.Service.Store.LogActivity(r.Context(), h.Service.Workspace, "campaign",
		"Audiência criada", seg.Name, seg.ID)
	writeJSON(w, http.StatusCreated, seg)
}

func (h *Handlers) UpdateSegment(w http.ResponseWriter, r *http.Request) {
	var in domain.SegmentInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	seg, err := h.Service.Store.UpdateSegment(r.Context(), h.Service.Workspace, pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, seg)
}

func (h *Handlers) DeleteSegment(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.DeleteSegment(r.Context(), h.Service.Workspace, pathID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ contatos */

func (h *Handlers) Contacts(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Contacts(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handlers) CreateContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		domain.Contact
		OptInSource string `json:"optInSource"`
		PolicyText  string `json:"policyText"`
	}
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	source := in.OptInSource
	if source == "" {
		source = "manual"
	}
	c, err := h.Service.Store.CreateContact(r.Context(), h.Service.Workspace, in.Contact, source)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handlers) OptOut(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.OptOut(r.Context(), h.Service.Workspace, pathID(r), "opt-out manual"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ----------------------------------------------------------------- campanha */

func (h *Handlers) Campaigns(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Campaigns(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handlers) CreateCampaign(w http.ResponseWriter, r *http.Request) {
	var in domain.CampaignInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	c, err := h.Service.Store.CreateCampaign(r.Context(), h.Service.Workspace, in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.Service.Store.LogActivity(r.Context(), h.Service.Workspace, "campaign",
		"Campanha criada", c.Name, c.ID)
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handlers) UpdateCampaign(w http.ResponseWriter, r *http.Request) {
	var in domain.CampaignInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	c, err := h.Service.Store.UpdateCampaign(r.Context(), h.Service.Workspace, pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// Launch é o botão "disparar". Idempotente por (campanha, contato) — clicar
// duas vezes não manda duas mensagens.
func (h *Handlers) LaunchCampaign(w http.ResponseWriter, r *http.Request) {
	res, err := h.Service.Launch(r.Context(), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *Handlers) TestSend(w http.ResponseWriter, r *http.Request) {
	res, err := h.Service.TestSend(r.Context(), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *Handlers) PauseCampaign(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.SetCampaignStatus(r.Context(), h.Service.Workspace, pathID(r), "paused"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.Service.Store.LogActivity(r.Context(), h.Service.Workspace, "campaign",
		"Campanha pausada", "A fila para de sair até ser retomada.", pathID(r))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) ResumeCampaign(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.SetCampaignStatus(r.Context(), h.Service.Workspace, pathID(r), "running"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* -------------------------------------------------------------------- fluxo */

func (h *Handlers) Flows(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Flows(r.Context(), h.Service.Workspace)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handlers) CreateFlow(w http.ResponseWriter, r *http.Request) {
	var in domain.FlowInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	f, err := h.Service.Store.CreateFlow(r.Context(), h.Service.Workspace, in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (h *Handlers) UpdateFlow(w http.ResponseWriter, r *http.Request) {
	var in domain.FlowInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	f, err := h.Service.Store.UpdateFlow(r.Context(), h.Service.Workspace, pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handlers) DeleteFlow(w http.ResponseWriter, r *http.Request) {
	if err := h.Service.Store.DeleteFlow(r.Context(), h.Service.Workspace, pathID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* -------------------------------------------------------------------- envios */

func (h *Handlers) Sends(w http.ResponseWriter, r *http.Request) {
	campaignID := r.URL.Query().Get("campaignId")
	limit := 120
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconvAtoi(raw); err == nil {
			limit = n
		}
	}
	items, err := h.Service.Store.Sends(r.Context(), h.Service.Workspace, campaignID, limit)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

/* --------------------------------------------------------------- atividade */

func (h *Handlers) Activity(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.Store.Activity(r.Context(), h.Service.Workspace, 40)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

/* --------------------------------------------------------------- webhook */

// WebhookHandshake é o GET de verificação da Meta: ela chama uma vez com
// hub.mode=subscribe e espera o challenge de volta em texto puro.
func (h *Handlers) WebhookHandshake(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("hub.mode") != "subscribe" {
		writeError(w, http.StatusBadRequest, "modo inválido")
		return
	}
	if q.Get("hub.verify_token") != h.WebhookVerifyToken {
		writeError(w, http.StatusForbidden, "verify token inválido")
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = io.WriteString(w, q.Get("hub.challenge"))
}

// Webhook recebe status e mensagens. Com META_APP_SECRET configurado, exige
// X-Hub-Signature-256 válido — sem isso qualquer um marcaria envios como lidos.
func (h *Handlers) Webhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "corpo ilegível")
		return
	}
	if h.AppSecret != "" {
		if !validSignature(body, r.Header.Get("X-Hub-Signature-256"), h.AppSecret) {
			writeError(w, http.StatusUnauthorized, "assinatura inválida")
			return
		}
	}

	var ev WebhookEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		writeError(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	if ev.Object != "whatsapp_business_account" {
		// Evento de outra família: 200 para a Meta não reentregar.
		w.WriteHeader(http.StatusOK)
		return
	}
	if err := h.Service.HandleWebhook(r.Context(), ev); err != nil {
		// Mesmo com erro de processamento, 200: a Meta reentrega em loop e o
		// evento já foi registrado; o log é o lugar de investigar.
		h.Log.Error("webhook: processar", "error", err)
	}
	w.WriteHeader(http.StatusOK)
}

func validSignature(body []byte, header, secret string) bool {
	const prefix = "sha256="
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	got, err := hex.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(got, mac.Sum(nil))
}

/* -------------------------------------------------------------------- dev */

// ResetDemo apaga e recria o workspace de demonstração. Só existe com
// ALLOW_DEV_ACTIONS ligado — em produção isto seria um botão de apagar tudo.
func (h *Handlers) ResetDemo(w http.ResponseWriter, r *http.Request) {
	if !h.AllowDevActions {
		writeError(w, http.StatusNotFound, "rota desabilitada")
		return
	}
	contacts, err := seed.Reset(r.Context(), h.Service.Store.Pool())
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"seeded": contacts})
}

// SimulateWebhookStatus injeta um status como se a Meta tivesse chamado. É o
// que permite testar entrega/leitura sem credencial; existe só em dev.
func (h *Handlers) SimulateWebhookStatus(w http.ResponseWriter, r *http.Request) {
	if !h.AllowDevActions {
		writeError(w, http.StatusNotFound, "rota desabilitada")
		return
	}
	var in struct {
		MessageID string `json:"messageId"`
		Status    string `json:"status"`
		Reason    string `json:"reason"`
	}
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	campaignID, _, _, ok, err := h.Service.Store.ApplyMessageStatus(r.Context(), in.MessageID, in.Status, in.Reason)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"applied": ok, "campaignId": campaignID})
}

// WorkerTick força um ciclo da fila — para provar o envio de ponta a ponta num
// teste sem esperar o ticker.
func (h *Handlers) WorkerTick(w http.ResponseWriter, r *http.Request) {
	if !h.AllowDevActions {
		writeError(w, http.StatusNotFound, "rota desabilitada")
		return
	}
	if h.Tick == nil {
		writeError(w, http.StatusServiceUnavailable, "worker não configurado")
		return
	}
	n, err := h.Tick(r.Context())
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"processed": n})
}

func pathID(r *http.Request) string {
	return chi.URLParam(r, "id")
}

func strconvAtoi(s string) (int, error) { return strconv.Atoi(s) }
