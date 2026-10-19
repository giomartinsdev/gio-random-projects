package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/dispatch"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// Service é a camada de caso de uso: junta store + provedor e é o que os
// handlers chamam. Existe para o handler não decidir "template aprovado?" nem
// "tem telefone?" — decisões que precisam valer em qualquer entrada (HTTP hoje,
// CLI amanhã).
type Service struct {
	Store     *store.Store
	Provider  meta.Provider
	Log       *slog.Logger
	Workspace string
	User      domain.User
}

// For devolve o serviço escopado numa conta. O workspace e o usuário vêm
// SEMPRE da sessão, nunca do corpo da requisição — é isso que impede uma conta
// de operar sobre a outra. Uma cópia rasa basta porque as dependências são as
// mesmas.
func (s *Service) For(sess store.Session) *Service {
	cp := *s
	cp.Workspace = sess.WorkspaceID
	cp.User = domain.User{Name: sess.Name, Email: sess.Email, Role: "owner"}
	return &cp
}

/* --------------------------------------------------------------- templates */

// SubmitTemplate valida, sobe para o provedor e grava o resultado. Uma falha do
// provedor NÃO cria template local: um registro que parece existir mas nunca
// foi submetido é pior do que um erro claro na tela.
func (s *Service) SubmitTemplate(ctx context.Context, in domain.TemplateInput) (domain.Template, error) {
	if err := in.Validate(); err != nil {
		return domain.Template{}, err
	}

	// Cria em rascunho para ter um id antes de falar com a Meta (o dry-run usa
	// esse id no id externo).
	draft, err := s.Store.CreateTemplate(ctx, s.Workspace, in, "draft", "")
	if err != nil {
		return domain.Template{}, err
	}

	extID, status, err := s.Provider.CreateTemplate(ctx, draft)
	if err != nil {
		// Desfaz o rascunho: deixar um template que nunca foi submetido faria a
		// tela mostrar "pendente" para algo que a Meta jamais viu.
		_ = s.Store.DeleteTemplate(ctx, s.Workspace, draft.ID)
		return domain.Template{}, domain.Invalid("template", "a Meta recusou a submissão: "+err.Error())
	}

	if err := s.Store.MarkTemplateSubmitted(ctx, s.Workspace, draft.ID, extID, status); err != nil {
		return domain.Template{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "template", "Template submetido",
		draft.Name+" · "+status, draft.ID)

	return s.Store.Template(ctx, s.Workspace, draft.ID)
}

// SaveDraft grava um template sem falar com a Meta. É o "salvar rascunho" da
// tela: submeter é uma ação explícita, porque cada submissão consome uma cota e
// uma revisão humana do outro lado.
func (s *Service) SaveDraft(ctx context.Context, in domain.TemplateInput) (domain.Template, error) {
	if err := in.Validate(); err != nil {
		return domain.Template{}, err
	}
	tpl, err := s.Store.CreateTemplate(ctx, s.Workspace, in, "draft", "")
	if err != nil {
		return domain.Template{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "template", "Rascunho salvo", tpl.Name, tpl.ID)
	return tpl, nil
}

// UpdateTemplate edita o conteúdo e devolve para rascunho (o corpo mudou, a
// aprovação antiga não vale mais).
func (s *Service) UpdateTemplate(ctx context.Context, id string, in domain.TemplateInput) (domain.Template, error) {
	if err := in.Validate(); err != nil {
		return domain.Template{}, err
	}
	t, err := s.Store.UpdateTemplateContent(ctx, s.Workspace, id, in)
	if err != nil {
		return domain.Template{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "template", "Template editado",
		t.Name+" voltou para rascunho até nova aprovação", t.ID)
	return t, nil
}

/* --------------------------------------------------------------- campanhas */

// LaunchResults é a resposta do disparo: quantos entraram na fila e quantos
// ficaram de fora por consentimento.
type LaunchResults struct {
	CampaignID string `json:"campaignId"`
	Queued     int    `json:"queued"`
	Skipped    int    `json:"skipped"`
	Duplicate  int    `json:"duplicate"`
}

// Launch valida as pré-condições de envio, resolve a audiência e enfileira.
//
// A ordem das checagens é deliberada: template e telefone primeiro (falha
// barata, antes de tocar em contato), opt-in por último e em silêncio (não é
// erro do operador, é a base dele).
func (s *Service) Launch(ctx context.Context, campaignID string) (LaunchResults, error) {
	campaign, err := s.Store.Campaign(ctx, s.Workspace, campaignID)
	if err != nil {
		return LaunchResults{}, err
	}
	tpl, err := s.Store.Template(ctx, s.Workspace, campaign.TemplateID)
	if err != nil {
		return LaunchResults{}, err
	}
	if tpl.Status != "approved" {
		return LaunchResults{}, domain.Invalid("templateId",
			"o template "+tpl.Name+" está "+statusLabel(tpl.Status)+"; a Meta precisa aprovar antes de enviar")
	}
	ws, err := s.Store.Workspace(ctx, s.Workspace)
	if err != nil {
		return LaunchResults{}, err
	}
	if ws.WhatsAppNumber == "" {
		return LaunchResults{}, domain.Invalid("whatsappNumber",
			"configure o telefone do WhatsApp em Configurações antes de disparar")
	}
	if campaign.RequiresApproval && campaign.Status == "draft" {
		return LaunchResults{}, domain.Invalid("status",
			"esta campanha exige aprovação humana; publique o fluxo antes de disparar")
	}

	audience := map[string]domain.Contact{}
	for _, segID := range campaign.SegmentIDs {
		contacts, err := s.Store.SegmentContacts(ctx, s.Workspace, segID)
		if err != nil {
			return LaunchResults{}, err
		}
		for _, c := range contacts {
			audience[c.ID] = c
		}
	}

	eligible := make([]domain.Contact, 0, len(audience))
	skipped := 0
	for _, c := range audience {
		if !c.CanReceiveMarketing() {
			skipped++
			continue
		}
		if _, err := domain.NormalizePhone(c.Phone); err != nil {
			// Telefone inválido numa base grande é esperado; o contato fica de
			// fora e o operador vê o número no relatório de ignorados.
			skipped++
			continue
		}
		eligible = append(eligible, c)
	}

	queued, err := s.Store.EnqueueSends(ctx, s.Workspace, campaign.ID, tpl.Name, campaign.Offer.CodePattern, eligible)
	if err != nil {
		return LaunchResults{}, err
	}

	if err := s.Store.AddSkipped(ctx, s.Workspace, campaign.ID, skipped); err != nil {
		return LaunchResults{}, err
	}
	if err := s.Store.SetCampaignStatus(ctx, s.Workspace, campaign.ID, "running"); err != nil {
		return LaunchResults{}, err
	}
	if err := s.Store.TouchCampaignRun(ctx, s.Workspace, campaign.ID); err != nil {
		return LaunchResults{}, err
	}
	if campaign.FlowID != "" {
		_ = s.Store.RecordFlowRun(ctx, s.Workspace, campaign.FlowID, true)
	}
	detail := plural(queued, "envio na fila", "envios na fila")
	if skipped > 0 {
		detail += " · " + plural(skipped, "contato ignorado", "contatos ignorados") + " (sem opt-in ou telefone inválido)"
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "campaign", "Campanha disparada",
		campaign.Name+" · "+detail, campaign.ID)

	return LaunchResults{
		CampaignID: campaign.ID,
		Queued:     queued,
		Skipped:    skipped,
		Duplicate:  len(eligible) - queued,
	}, nil
}

// TestSend enfileira UM envio real para o primeiro contato elegível da
// campanha. É o "enviar teste" da tela: passa por template aprovado, telefone e
// opt-in exatamente como um disparo — um teste que ignora as regras não testa
// nada. O UNIQUE (campanha, contato) continua valendo.
func (s *Service) TestSend(ctx context.Context, campaignID string) (LaunchResults, error) {
	campaign, err := s.Store.Campaign(ctx, s.Workspace, campaignID)
	if err != nil {
		return LaunchResults{}, err
	}
	tpl, err := s.Store.Template(ctx, s.Workspace, campaign.TemplateID)
	if err != nil {
		return LaunchResults{}, err
	}
	if tpl.Status != "approved" {
		return LaunchResults{}, domain.Invalid("templateId",
			"o template "+tpl.Name+" está "+statusLabel(tpl.Status)+"; a Meta precisa aprovar antes de enviar")
	}
	ws, err := s.Store.Workspace(ctx, s.Workspace)
	if err != nil {
		return LaunchResults{}, err
	}
	if ws.WhatsAppNumber == "" {
		return LaunchResults{}, domain.Invalid("whatsappNumber",
			"configure o telefone do WhatsApp em Configurações antes de enviar")
	}

	audience := map[string]domain.Contact{}
	for _, segID := range campaign.SegmentIDs {
		contacts, err := s.Store.SegmentContacts(ctx, s.Workspace, segID)
		if err != nil {
			return LaunchResults{}, err
		}
		for _, c := range contacts {
			if c.CanReceiveMarketing() {
				audience[c.ID] = c
			}
		}
	}
	if len(audience) == 0 {
		return LaunchResults{}, domain.Invalid("segmentIds",
			"a audiência desta campanha não tem nenhum contato com opt-in")
	}
	one := make([]domain.Contact, 0, 1)
	for _, c := range audience {
		one = append(one, c)
		break
	}

	queued, err := s.Store.EnqueueSends(ctx, s.Workspace, campaign.ID, tpl.Name, campaign.Offer.CodePattern, one)
	if err != nil {
		return LaunchResults{}, err
	}
	if queued > 0 {
		if err := s.Store.SetCampaignStatus(ctx, s.Workspace, campaign.ID, "running"); err != nil {
			return LaunchResults{}, err
		}
		if err := s.Store.TouchCampaignRun(ctx, s.Workspace, campaign.ID); err != nil {
			return LaunchResults{}, err
		}
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "send", "Envio de teste",
		campaign.Name+" · "+plural(queued, "mensagem enfileirada", "mensagens enfileiradas"), campaign.ID)
	return LaunchResults{CampaignID: campaign.ID, Queued: queued, Duplicate: len(one) - queued}, nil
}

func statusLabel(status string) string {
	switch status {
	case "pending":
		return "em análise"
	case "rejected":
		return "rejeitado"
	case "paused":
		return "pausado"
	case "draft":
		return "em rascunho"
	}
	return status
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return itoa(n) + " " + many
}

/* --------------------------------------------------------------- bootstrap */

// Bootstrap é o payload inicial da SPA: tudo que a tela precisa numa chamada.
// A POC tem uma empresa; quando houver muitas, isto ganha paginação — mas o
// formato (um objeto com as coleções) é o mesmo.
type Bootstrap struct {
	Workspace domain.Workspace  `json:"workspace"`
	User      domain.User       `json:"user"`
	Templates []domain.Template `json:"templates"`
	Segments  []domain.Segment  `json:"segments"`
	Campaigns []domain.Campaign `json:"campaigns"`
	Sends     []domain.Send     `json:"sends"`
	Flows     []domain.Flow     `json:"flows"`
	// Contacts vai no bootstrap porque a tela de audiências mostra a base real
	// ("contatos únicos") e a amostra de cada segmento sem uma segunda chamada.
	Contacts   []domain.Contact       `json:"contacts"`
	Activity   []domain.ActivityEvent `json:"activity"`
	Series     []domain.MetricPoint   `json:"series"`
	Provider   ProviderInfo           `json:"provider"`
	Queue      []QueueInfo            `json:"queue"`
	ServerTime time.Time              `json:"serverTime"`
}

// QueueInfo é o estado da fila de cada campanha em execução, com o motivo de
// ela estar parada. É o que permite a tela dizer "esperando a janela das 9h" em
// vez de mostrar 29 na fila e nenhuma enviada, sem explicação.
type QueueInfo struct {
	CampaignID string `json:"campaignId"`
	Queued     int    `json:"queued"`
	BlockedBy  string `json:"blockedBy"`
	// Ponteiro porque `omitempty` não tem efeito em time.Time (struct): sem
	// isso, uma fila livre mandava "nextOpenAt": "0001-01-01T00:00:00Z" e a
	// tela oferecia abrir em 01/01/0001.
	NextOpenAt *time.Time `json:"nextOpenAt,omitempty"`
	Timezone   string     `json:"timezone,omitempty"`
}

// ProviderInfo é o que a tela mostra em Configurações: em que modo o serviço
// está e se ele realmente consegue mandar mensagem.
type ProviderInfo struct {
	Name      string `json:"name"`
	Mode      string `json:"mode"`
	Live      bool   `json:"live"`
	HasNumber bool   `json:"hasNumber"`
	Note      string `json:"note"`
}

func (s *Service) Bootstrap(ctx context.Context) (Bootstrap, error) {
	ws, err := s.Store.Workspace(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	templates, err := s.Store.Templates(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	segments, err := s.Store.Segments(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	campaigns, err := s.Store.Campaigns(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	sends, err := s.Store.Sends(ctx, s.Workspace, "", 120)
	if err != nil {
		return Bootstrap{}, err
	}
	flows, err := s.Store.Flows(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	contacts, err := s.Store.Contacts(ctx, s.Workspace)
	if err != nil {
		return Bootstrap{}, err
	}
	activity, err := s.Store.Activity(ctx, s.Workspace, 40)
	if err != nil {
		return Bootstrap{}, err
	}

	live := s.Provider.Name() == "meta-cloud"
	note := "Provedor dry-run: as mensagens são registradas e marcadas como enviadas, sem sair para a Meta."
	if live {
		note = "Conectado à Cloud API da Meta. Cada envio é uma mensagem real e cobrada."
	}

	series, err := s.Store.DailySeries(ctx, s.Workspace, 90)
	if err != nil {
		return Bootstrap{}, err
	}
	queue, err := s.queueState(ctx, campaigns)
	if err != nil {
		return Bootstrap{}, err
	}

	return Bootstrap{
		Workspace: ws,
		User:      s.User,
		Templates: templates,
		Segments:  segments,
		Campaigns: campaigns,
		Sends:     sends,
		Flows:     flows,
		Contacts:  contacts,
		Activity:  activity,
		Series:    series,
		Queue:     queue,
		Provider: ProviderInfo{
			Name:      s.Provider.Name(),
			Mode:      providerMode(live),
			Live:      live,
			HasNumber: ws.WhatsAppNumber != "",
			Note:      note,
		},
		ServerTime: time.Now().UTC(),
	}, nil
}

// queueState calcula, para cada campanha em execução com pendências, por que a
// fila está parada. Uma consulta por campanha em execução é aceitável: são
// poucas, e o bootstrap já é a chamada mais pesada da tela.
func (s *Service) queueState(ctx context.Context, campaigns []domain.Campaign) ([]QueueInfo, error) {
	out := []QueueInfo{}
	now := time.Now()
	for _, c := range campaigns {
		if c.Status != "running" || c.Metrics.Queued == 0 {
			continue
		}
		window := dispatch.Window{
			Start: c.Schedule.WindowStart, End: c.Schedule.WindowEnd,
			Days: c.Schedule.Days, Timezone: c.Schedule.Timezone,
		}
		state := dispatch.ExplainQueue(now, c.ID, window, c.Metrics.Queued)
		info := QueueInfo{
			CampaignID: c.ID,
			Queued:     c.Metrics.Queued,
			BlockedBy:  state.BlockedBy,
			Timezone:   state.Timezone,
		}
		if state.BlockedBy == "window" {
			next := state.NextOpenAt
			info.NextOpenAt = &next
		}
		out = append(out, info)
	}
	return out, nil
}

func providerMode(live bool) string {
	if live {
		return "live"
	}
	return "dry-run"
}

/* ------------------------------------------------------------------ webhook */

// WebhookEvent é o pedaço do payload da Meta que interessa. A Meta manda muito
// mais; decodificar só o que se usa evita quebrar quando ela adicionar campo.
type WebhookEvent struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Field string `json:"field"`
			Value struct {
				// message_template_status_update
				Event             string `json:"event"`
				MessageTemplateID string `json:"message_template_id"`
				Reason            string `json:"reason"`
				// messages
				MessagingProduct string `json:"messaging_product"`
				Metadata         struct {
					PhoneNumberID string `json:"phone_number_id"`
				} `json:"metadata"`
				Statuses []struct {
					ID          string `json:"id"`
					Status      string `json:"status"`
					RecipientID string `json:"recipient_id"`
					Errors      []struct {
						Code  int    `json:"code"`
						Title string `json:"title"`
					} `json:"errors"`
				} `json:"statuses"`
				Messages []struct {
					ID   string `json:"id"`
					From string `json:"from"`
					Text struct {
						Body string `json:"body"`
					} `json:"text"`
					Button *struct {
						Text    string `json:"text"`
						Payload string `json:"payload"`
					} `json:"button"`
				} `json:"messages"`
			} `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

// HandleWebhook aplica os eventos. É idempotente por chave de evento e devolve
// sempre 200 quando o corpo é válido: responder erro faz a Meta reentregar em
// loop, o que costuma piorar o incidente.
func (s *Service) HandleWebhook(ctx context.Context, ev WebhookEvent) error {
	for _, entry := range ev.Entry {
		for _, change := range entry.Changes {
			v := change.Value

			if v.MessageTemplateID != "" || change.Field == "message_template_status_update" {
				s.applyTemplateStatus(ctx, v.MessageTemplateID, v.Event, v.Reason)
				continue
			}

			for _, st := range v.Statuses {
				s.applyMessageStatus(ctx, st.ID, st.Status, st.Errors)
			}
			for _, msg := range v.Messages {
				s.applyInbound(ctx, msg.From, inboundText(msg.Text.Body, msg.Button))
			}
		}
	}
	return nil
}

func inboundText(body string, button *struct {
	Text    string `json:"text"`
	Payload string `json:"payload"`
}) string {
	if body != "" {
		return body
	}
	if button != nil {
		return button.Text
	}
	return ""
}

func (s *Service) applyTemplateStatus(ctx context.Context, externalID, event, reason string) {
	if externalID == "" {
		return
	}
	status := ""
	switch event {
	case "APPROVED":
		status = "approved"
	case "REJECTED":
		status = "rejected"
	case "PAUSED":
		status = "paused"
	case "DISABLED":
		status = "paused"
	case "PENDING":
		status = "pending"
	default:
		return
	}
	tpl, ws, ok, err := s.Store.ApplyTemplateStatus(ctx, externalID, status, reason)
	if err != nil {
		s.Log.Error("webhook: template", "external", externalID, "error", err)
		return
	}
	if !ok {
		return // não é nosso: 200 e segue
	}
	title := "Template " + statusLabel(status)
	// O webhook não tem sessão: o workspace é o dono do template que a Meta
	// citou, resolvido no banco.
	_ = s.Store.LogActivity(ctx, ws, "template", title, tpl.Name+reasonSuffix(reason), tpl.ID)
}

func reasonSuffix(reason string) string {
	if reason == "" {
		return ""
	}
	return " · " + reason
}

func (s *Service) applyMessageStatus(ctx context.Context, externalID, status string, errs []struct {
	Code  int    `json:"code"`
	Title string `json:"title"`
}) {
	if externalID == "" || !validSendStatus(status) {
		return
	}
	reason := ""
	if len(errs) > 0 {
		reason = itoa(errs[0].Code) + " · " + errs[0].Title
	}
	owner, campaignID, contactID, _, ok, err := s.Store.ApplyMessageStatus(ctx, "", externalID, status, reason)
	if err != nil {
		s.Log.Error("webhook: status", "external", externalID, "error", err)
		return
	}
	if !ok {
		return
	}

	if status == "failed" {
		_ = s.Store.LogActivity(ctx, owner, "send", "Envio falhou",
			"Webhook da Meta: "+reason, campaignID)
		return
	}
	// Opt-out por resposta: é o caminho que a Meta e o bom senso exigem. A
	// mensagem de resposta chega no bloco `messages`, não aqui; este é só o
	// registro de leitura/entrega.
	_ = contactID
}

func validSendStatus(s string) bool {
	switch s {
	case "sent", "delivered", "read", "failed":
		return true
	}
	return false
}

// applyInbound trata resposta do destinatário. Palavra de opt-out revoga o
// consentimento na hora; qualquer outra resposta marca o envio como respondido.
func (s *Service) applyInbound(ctx context.Context, from, text string) {
	if from == "" {
		return
	}
	// Sem sessão, o workspace vem do telefone: um número pertence a uma conta
	// só (UNIQUE workspace_id+phone), então a resposta identifica o dono sem
	// ambiguidade.
	ws := s.Workspace
	if ws == "" {
		owner, err := s.Store.WorkspaceByPhone(ctx, from)
		if err != nil || owner == "" {
			s.Log.Warn("webhook: telefone de workspace desconhecido", "from", from)
			return
		}
		ws = owner
	}
	contact, err := s.Store.ContactByPhone(ctx, ws, from)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			s.Log.Error("webhook: contato", "from", from, "error", err)
		}
		return
	}
	if isOptOut(text) {
		if err := s.Store.OptOut(ctx, ws, contact.ID, "respondeu \""+text+"\""); err != nil {
			s.Log.Error("webhook: opt-out", "contact", contact.ID, "error", err)
			return
		}
		_ = s.Store.LogActivity(ctx, ws, "send", "Opt-out pelo WhatsApp",
			contact.Name+" pediu para não receber mais", contact.ID)
		return
	}
	if err := s.Store.MarkRepliedByPhone(ctx, ws, from); err != nil {
		s.Log.Error("webhook: resposta", "from", from, "error", err)
	}
}

func isOptOut(text string) bool {
	normalized := lowerTrim(text)
	switch normalized {
	case "parar", "sair", "cancelar", "descadastrar", "não quero", "nao quero",
		"não quero receber", "nao quero receber", "pare", "stop", "unsubscribe":
		return true
	}
	return false
}
