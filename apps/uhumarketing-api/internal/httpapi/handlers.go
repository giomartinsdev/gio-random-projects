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
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

type Handlers struct {
	Service *Service
	Log     *slog.Logger

	// Públicos / de dev.
	WebhookVerifyToken string
	AppSecret          string
	// RequireSignature é verdadeiro em live: o webhook é público, e sem
	// assinatura qualquer um marcaria envio como lido ou forjaria opt-out.
	// Em live sem AppSecret o webhook falha fechado (503) em vez de aceitar.
	RequireSignature bool
	AllowDevActions  bool

	// Tick força um ciclo da fila (usado só pela rota de dev).
	Tick func(ctx context.Context) (int, error)
}

/* ------------------------------------------------------------------ saúde */

func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	dbOK := "ok"
	if err := h.svc(r).Store.Pool().Ping(r.Context()); err != nil {
		dbOK = "down"
	}
	status := http.StatusOK
	if dbOK != "ok" {
		status = http.StatusServiceUnavailable
	}
	// O health é do PROCESSO, não de uma conta: em live cada workspace tem o
	// próprio canal, então "live" aqui significa "o servidor aceita envio
	// real", não "existe um token global válido".
	live := h.Service.Provider.Name() == "meta-cloud"
	if h.Service.Channels != nil {
		live = h.Service.Channels.Live()
	}
	// O estado do webhook é do PROCESSO e interessa ao deploy: callback
	// configurado, mas sem segredo, aceita o handshake e recusa todo evento —
	// melhor descobrir isso no /healthz do que num envio que nunca vira
	// "entregue".
	webhook := "unsigned"
	switch {
	case h.AppSecret != "":
		webhook = "signed"
	case h.RequireSignature:
		webhook = "missing-secret"
	}
	writeJSON(w, status, map[string]any{
		"status":   map[bool]string{true: "ok", false: "degraded"}[dbOK == "ok"],
		"database": dbOK,
		"provider": h.Service.Provider.Name(),
		"live":     live,
		"channels": "per-workspace",
		"webhook":  webhook,
	})
}

/* -------------------------------------------------------------- bootstrap */

func (h *Handlers) Bootstrap(w http.ResponseWriter, r *http.Request) {
	payload, err := h.svc(r).Bootstrap(r.Context())
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
	if err := h.svc(r).Store.ReplaceState(r.Context(), workspaceID(r), doc); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	payload, err := h.svc(r).Bootstrap(r.Context())
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
	if err := h.svc(r).Store.UpdateWorkspace(r.Context(), workspaceID(r), in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	h.respondWorkspace(w, r)
}

func (h *Handlers) respondWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, err := h.svc(r).Store.Workspace(r.Context(), workspaceID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

/* --------------------------------------------------------------- templates */

func (h *Handlers) Templates(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Templates(r.Context(), workspaceID(r))
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
		t, err = h.svc(r).SaveDraft(r.Context(), in)
	} else {
		t, err = h.svc(r).SubmitTemplate(r.Context(), in)
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
	t, err := h.svc(r).UpdateTemplate(r.Context(), pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *Handlers) SubmitTemplate(w http.ResponseWriter, r *http.Request) {
	tpl, err := h.svc(r).Store.Template(r.Context(), workspaceID(r), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	in := domain.TemplateInput{
		Name: tpl.Name, DisplayName: tpl.DisplayName, Channel: tpl.Channel,
		Category: tpl.Category, Language: tpl.Language, Header: tpl.Header,
		Body: tpl.Body, Footer: tpl.Footer, Buttons: tpl.Buttons, Variables: tpl.Variables,
	}
	extID, status, err := h.svc(r).Provider.CreateTemplate(r.Context(), tpl)
	if err != nil {
		writeDomainError(w, h.Log, domain.Invalid("template", "a Meta recusou: "+err.Error()))
		return
	}
	if err := h.svc(r).Store.MarkTemplateSubmitted(r.Context(), workspaceID(r), tpl.ID, extID, status); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = in
	updated, err := h.svc(r).Store.Template(r.Context(), workspaceID(r), tpl.ID)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.svc(r).Store.LogActivity(r.Context(), workspaceID(r), "template",
		"Template submetido", updated.Name+" · "+status, updated.ID)
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handlers) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.DeleteTemplate(r.Context(), workspaceID(r), pathID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Channel responde "o canal está de pé?" com o que o provedor disse. Em
// dry-run é 200 com live=false — não é erro, é o modo. O 422 é só para falta
// de configuração local, que o operador resolve na tela.
func (h *Handlers) Channel(w http.ResponseWriter, r *http.Request) {
	info, err := h.svc(r).CheckChannel(r.Context())
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// ActivateChannel grava o canal da conta depois de a Meta confirmar que as
// credenciais respondem. O token entra no corpo e não sai em nenhuma resposta.
func (h *Handlers) ActivateChannel(w http.ResponseWriter, r *http.Request) {
	var in ActivateChannelInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	info, err := h.svc(r).ActivateChannel(r.Context(), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// DeactivateChannel apaga as credenciais do canal da conta.
func (h *Handlers) DeactivateChannel(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).DeactivateChannel(r.Context()); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SyncTemplate consulta a Meta sem esperar webhook. É o caminho de quem roda
// local: sem URL pública, a aprovação nunca chegaria sozinha.
func (h *Handlers) SyncTemplate(w http.ResponseWriter, r *http.Request) {
	tpl, err := h.svc(r).SyncTemplateStatus(r.Context(), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, tpl)
}

/* --------------------------------------------------------------- audiências */

func (h *Handlers) Segments(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Segments(r.Context(), workspaceID(r))
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
	seg, err := h.svc(r).Store.CreateSegment(r.Context(), workspaceID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.svc(r).Store.LogActivity(r.Context(), workspaceID(r), "campaign",
		"Audiência criada", seg.Name, seg.ID)
	writeJSON(w, http.StatusCreated, seg)
}

func (h *Handlers) UpdateSegment(w http.ResponseWriter, r *http.Request) {
	var in domain.SegmentInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	seg, err := h.svc(r).Store.UpdateSegment(r.Context(), workspaceID(r), pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, seg)
}

func (h *Handlers) DeleteSegment(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.DeleteSegment(r.Context(), workspaceID(r), pathID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ contatos */

func (h *Handlers) Contacts(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Contacts(r.Context(), workspaceID(r))
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
	c, err := h.svc(r).Store.CreateContact(r.Context(), workspaceID(r), in.Contact, source)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handlers) OptOut(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.OptOut(r.Context(), workspaceID(r), pathID(r), "opt-out manual"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ----------------------------------------------------------------- campanha */

func (h *Handlers) Campaigns(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Campaigns(r.Context(), workspaceID(r))
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
	c, err := h.svc(r).Store.CreateCampaign(r.Context(), workspaceID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.svc(r).Store.LogActivity(r.Context(), workspaceID(r), "campaign",
		"Campanha criada", c.Name, c.ID)
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handlers) UpdateCampaign(w http.ResponseWriter, r *http.Request) {
	var in domain.CampaignInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	c, err := h.svc(r).Store.UpdateCampaign(r.Context(), workspaceID(r), pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// Launch é o botão "disparar". Idempotente por (campanha, contato) — clicar
// duas vezes não manda duas mensagens.
func (h *Handlers) LaunchCampaign(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc(r).Launch(r.Context(), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *Handlers) TestSend(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc(r).TestSend(r.Context(), pathID(r))
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

func (h *Handlers) PauseCampaign(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.SetCampaignStatus(r.Context(), workspaceID(r), pathID(r), "paused"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	_ = h.svc(r).Store.LogActivity(r.Context(), workspaceID(r), "campaign",
		"Campanha pausada", "A fila para de sair até ser retomada.", pathID(r))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) ResumeCampaign(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.SetCampaignStatus(r.Context(), workspaceID(r), pathID(r), "running"); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* -------------------------------------------------------------------- fluxo */

func (h *Handlers) Flows(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Flows(r.Context(), workspaceID(r))
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
	f, err := h.svc(r).Store.CreateFlow(r.Context(), workspaceID(r), in)
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
	f, err := h.svc(r).Store.UpdateFlow(r.Context(), workspaceID(r), pathID(r), in)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handlers) DeleteFlow(w http.ResponseWriter, r *http.Request) {
	if err := h.svc(r).Store.DeleteFlow(r.Context(), workspaceID(r), pathID(r)); err != nil {
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
	items, err := h.svc(r).Store.Sends(r.Context(), workspaceID(r), campaignID, limit)
	if err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

/* --------------------------------------------------------------- atividade */

func (h *Handlers) Activity(w http.ResponseWriter, r *http.Request) {
	items, err := h.svc(r).Store.Activity(r.Context(), workspaceID(r), 40)
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

// Webhook recebe status e mensagens. Em live a assinatura é OBRIGATÓRIA: o
// endpoint é público e qualquer um marcaria envios como lidos ou forjaria
// opt-out. Com a exigência ligada e sem META_APP_SECRET, falha fechado (503):
// aceitar sem verificar "para funcionar" é pior do que não receber evento.
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
	} else if h.RequireSignature {
		h.Log.Error("webhook: META_APP_SECRET ausente em modo live — evento recusado")
		writeError(w, http.StatusServiceUnavailable,
			"META_APP_SECRET não configurado: o webhook não aceita evento sem assinatura")
		return
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

// ResetAccount apaga os dados DA CONTA (não a conta). O workspace vem da
// sessão; não existe caminho para apagar o dado de outra pessoa.
//
// Não repõe demonstração: recomeçar significa ficar vazio. Um botão que
// "restaura os dados de exemplo" é exatamente o mock que a conta real não tem.
func (h *Handlers) ResetAccount(w http.ResponseWriter, r *http.Request) {
	if !h.AllowDevActions {
		writeError(w, http.StatusNotFound, "rota desabilitada")
		return
	}
	if err := h.svc(r).Store.WipeAccount(r.Context(), workspaceID(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cleared": true})
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
	_, campaignID, _, _, ok, err := h.svc(r).Store.ApplyMessageStatus(r.Context(), workspaceID(r), in.MessageID, in.Status, in.Reason)
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
