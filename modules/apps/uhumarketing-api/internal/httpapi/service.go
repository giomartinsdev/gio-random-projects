package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	channelpkg "github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/channel"
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
	Store *store.Store
	// Provider é o provedor de FALLBACK: o dry-run do processo, usado quando o
	// serviço roda em desenvolvimento. Em live, quem manda é o canal da conta
	// (Channels); não existe provider global que fale pela conta dos outros.
	Provider meta.Provider
	Channels *channelpkg.Resolver
	Log      *slog.Logger
	// Workspace e User vêm da sessão, nunca do corpo.
	Workspace string
	User      domain.User
}

// provider resolve o provedor da conta da sessão. Sem canal ativado em live, o
// erro é 422 com o caminho — nunca uma mensagem simulada em silêncio.
func (s *Service) provider(ctx context.Context) (meta.Provider, error) {
	if s.Channels == nil {
		return s.Provider, nil
	}
	return s.Channels.ProviderFor(ctx, s.Workspace)
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

	provider, err := s.provider(ctx)
	if err != nil {
		_ = s.Store.DeleteTemplate(ctx, s.Workspace, draft.ID)
		return domain.Template{}, domain.Invalid("channel", err.Error())
	}
	extID, status, err := provider.CreateTemplate(ctx, draft)
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
	// Canal antes do número: em live, conta sem canal tem como próximo passo
	// ATIVAR o WhatsApp, não digitar um telefone à mão. A ordem da mensagem é a
	// ordem da ação.
	if s.Channels != nil {
		if err := s.Channels.CanSendErr(ctx, s.Workspace); err != nil {
			return LaunchResults{}, domain.Invalid("channel", err.Error())
		}
	}
	if !s.hasNumber(ctx, ws.WhatsAppNumber) {
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
	if s.Channels != nil {
		if err := s.Channels.CanSendErr(ctx, s.Workspace); err != nil {
			return LaunchResults{}, domain.Invalid("channel", err.Error())
		}
	}
	if !s.hasNumber(ctx, ws.WhatsAppNumber) {
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
	// Escolha DETERMINÍSTICA, não a primeira de um map: em live isso mandaria
	// uma mensagem real para um cliente aleatório da audiência. O teste é do
	// operador, então vai para o opt-in mais recente — na prática, o contato
	// que ele acabou de cadastrar com o próprio número.
	var target domain.Contact
	for _, c := range audience {
		if target.ID == "" || newerOptIn(c, target) {
			target = c
		}
	}

	queued, err := s.Store.EnqueueTestSend(ctx, s.Workspace, campaign.ID, tpl.Name, campaign.Offer.CodePattern, target)
	if err != nil {
		return LaunchResults{}, err
	}
	if queued == 0 {
		// Só acontece quando o contato já recebeu o disparo REAL desta campanha:
		// o teste não sobrescreve entrega real.
		return LaunchResults{}, domain.Invalid("campaignId",
			"este contato já recebeu o disparo real desta campanha; use uma campanha separada para testar")
	}
	if err := s.Store.SetCampaignStatus(ctx, s.Workspace, campaign.ID, "running"); err != nil {
		return LaunchResults{}, err
	}
	if err := s.Store.TouchCampaignRun(ctx, s.Workspace, campaign.ID); err != nil {
		return LaunchResults{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "send", "Envio de teste",
		campaign.Name+" · "+plural(queued, "mensagem enfileirada", "mensagens enfileiradas"), campaign.ID)
	return LaunchResults{CampaignID: campaign.ID, Queued: queued}, nil
}

// hasNumber diz se a conta tem um número para assinar o envio: o digitado em
// Configurações ou o que a Meta confirmou na ativação do canal. Em live, exigir
// o campo manual seria pedir que o operador redigitasse o que a Meta já disse.
func (s *Service) hasNumber(ctx context.Context, manual string) bool {
	if manual != "" {
		return true
	}
	if s.Channels == nil {
		return false
	}
	// Canal ativo já prova que existe um número: em live a Meta confirmou o
	// Phone Number ID, em dry-run o operador informou qual está simulando.
	c, err := s.Store.Channel(ctx, s.Workspace)
	return err == nil && c.Active()
}

// CheckChannel pergunta ao provedor se o canal está de pé e devolve o que ele
// respondeu. A tela mostra isso em vez de um "conectado" deduzido da
// configuração: ter um número digitado em Configurações não prova que a Meta
// conhece o token.
func (s *Service) CheckChannel(ctx context.Context) (meta.ChannelInfo, error) {
	ws, err := s.Store.Workspace(ctx, s.Workspace)
	if err != nil {
		return meta.ChannelInfo{}, err
	}
	// Com canal próprio, o número vem da Meta (display_phone_number); o campo
	// digitado à mão é só a referência da conta. Sem canal, ele é o mínimo para
	// haver o que verificar.
	hasChannel := false
	if s.Channels != nil {
		if c, err := s.Store.Channel(ctx, s.Workspace); err == nil && c.Active() {
			hasChannel = true
		}
	}
	if ws.WhatsAppNumber == "" && !hasChannel {
		return meta.ChannelInfo{}, domain.Invalid("whatsappNumber",
			"configure o telefone do WhatsApp em Configurações antes de verificar o canal")
	}
	// Falha do provedor vira diagnóstico (ok=false), não erro HTTP: a tela
	// precisa mostrar o texto da Meta — "token expirado" é o que resolve o
	// problema, e um 500 genérico esconderia isso.
	provider, err := s.provider(ctx)
	if err != nil {
		return meta.ChannelInfo{}, domain.Invalid("channel", err.Error())
	}
	info, err := provider.Check(ctx)
	if err != nil {
		return meta.ChannelInfo{
			Live: provider.Name() == "meta-cloud",
			OK:   false,
			Note: err.Error(),
		}, nil
	}
	info.OK = true
	return info, nil
}

/* ------------------------------------------------------------- canal da conta */

// ActivateChannelInput é o que a tela manda ao conectar o WhatsApp. O token é
// write-only: entra na ativação e nunca mais volta.
type ActivateChannelInput struct {
	Mode    string `json:"mode,omitempty"`
	WABAID  string `json:"wabaId"`
	PhoneID string `json:"phoneId"`
	Token   string `json:"token"`
}

// ActivateChannel valida as credenciais na Meta e grava o canal da CONTA.
//
// Ativar não é colar um token e sair disparando: em live, a Graph responde
// antes de gravar. Um canal gravado sem verificação pareceria conectado e
// falharia no primeiro envio — pior do que recusar agora, com o motivo.
func (s *Service) ActivateChannel(ctx context.Context, in ActivateChannelInput) (ProviderInfo, error) {
	if s.Channels == nil {
		return ProviderInfo{}, domain.Invalid("channel", "ativação de canal indisponível neste servidor")
	}
	in.WABAID = strings.TrimSpace(in.WABAID)
	in.PhoneID = strings.TrimSpace(in.PhoneID)
	in.Token = strings.TrimSpace(in.Token)

	var missing []string
	if in.WABAID == "" {
		missing = append(missing, "WABA ID")
	}
	if in.PhoneID == "" {
		missing = append(missing, "Phone Number ID")
	}
	if in.Token == "" {
		missing = append(missing, "token")
	}
	if len(missing) > 0 {
		return ProviderInfo{}, domain.Invalid("channel",
			"faltam credenciais do WhatsApp: "+strings.Join(missing, ", ")+
				". Copie os três valores em API Setup do app da Meta")
	}

	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode == "" {
		mode = s.Channels.Mode
	}
	if mode != "live" && mode != "dry-run" {
		return ProviderInfo{}, domain.Invalid("mode", "modo do canal inválido: use live ou dry-run")
	}

	channel := store.Channel{
		WorkspaceID: s.Workspace,
		Mode:        mode,
		WABAID:      in.WABAID,
		PhoneID:     in.PhoneID,
	}
	if mode == "live" {
		info, err := s.Channels.Verify(ctx, channelpkg.Credentials{
			WABAID: in.WABAID, PhoneID: in.PhoneID, Token: in.Token,
		})
		if err != nil {
			// Erro da Graph vira 422 com a orientação (token, banimento,
			// parâmetro), não 500: é o operador que resolve.
			return ProviderInfo{}, domain.Invalid("channel", "a Meta recusou as credenciais: "+err.Error())
		}
		channel.DisplayPhone = info.Number
		channel.VerifiedName = info.VerifiedName
		channel.Quality = info.Quality
	}

	sealed, err := s.Channels.Seal(in.Token)
	if err != nil {
		return ProviderInfo{}, domain.Invalid("channel", err.Error())
	}
	channel.TokenCipher = sealed

	if err := s.Store.SaveChannel(ctx, channel); err != nil {
		if errors.Is(err, store.ErrPhoneInUse) {
			return ProviderInfo{}, domain.Invalid("phoneId", err.Error())
		}
		return ProviderInfo{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "channel", "WhatsApp ativado",
		map[bool]string{true: "Cloud API da Meta", false: "modo simulado"}[mode == "live"], "")
	return s.channelInfo(ctx)
}

// DeactivateChannel apaga as credenciais. O workspace continua existindo —
// desativar não é apagar a conta.
func (s *Service) DeactivateChannel(ctx context.Context) error {
	if err := s.Store.DeleteChannel(ctx, s.Workspace); err != nil {
		return err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "channel", "WhatsApp desativado",
		"as credenciais do canal foram apagadas", "")
	return nil
}

// SyncTemplateStatus pergunta à Meta o status de um template que ainda não
// recebeu webhook — o caminho normal quando não há URL pública. Sem isso, um
// template aprovado no painel da Meta continuaria "em análise" aqui para
// sempre, e o disparo ficaria bloqueado por um status local desatualizado.
func (s *Service) SyncTemplateStatus(ctx context.Context, templateID string) (domain.Template, error) {
	tpl, err := s.Store.Template(ctx, s.Workspace, templateID)
	if err != nil {
		return domain.Template{}, err
	}
	if tpl.MetaID == "" {
		return domain.Template{}, domain.Invalid("templateId",
			"este template ainda não foi submetido à Meta; envie para análise antes de consultar")
	}
	provider, err := s.provider(ctx)
	if err != nil {
		return domain.Template{}, domain.Invalid("channel", err.Error())
	}
	status, reason, err := provider.TemplateStatus(ctx, tpl.MetaID)
	if err != nil {
		if errors.Is(err, meta.ErrNotLive) {
			return domain.Template{}, domain.Invalid("templateId", err.Error())
		}
		return domain.Template{}, domain.Invalid("templateId", "a Meta recusou a consulta: "+err.Error())
	}
	if _, _, _, err := s.Store.ApplyTemplateStatus(ctx, tpl.MetaID, status, reason); err != nil {
		return domain.Template{}, err
	}
	_ = s.Store.LogActivity(ctx, s.Workspace, "template", "Status consultado na Meta",
		tpl.Name+" · "+statusLabel(status), tpl.ID)
	return s.Store.Template(ctx, s.Workspace, tpl.ID)
}

// newerOptIn ordena por opt-in mais recente e, no empate, por id — sem critério
// de desempate a escolha voltaria a ser aleatória, que é o que se quer evitar.
func newerOptIn(a, b domain.Contact) bool {
	switch {
	case a.OptInAt != nil && b.OptInAt != nil && !a.OptInAt.Equal(*b.OptInAt):
		return a.OptInAt.After(*b.OptInAt)
	case a.OptInAt != nil && b.OptInAt == nil:
		return true
	case a.OptInAt == nil && b.OptInAt != nil:
		return false
	}
	return a.ID > b.ID
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

// ProviderInfo é o que a tela mostra em Configurações. Ele descreve o canal DA
// CONTA, não o processo: em live, uma conta conectada e outra não convivem no
// mesmo servidor.
type ProviderInfo struct {
	Name         string `json:"name"`
	Mode         string `json:"mode"`
	Live         bool   `json:"live"`
	Activated    bool   `json:"activated"`
	HasNumber    bool   `json:"hasNumber"`
	DisplayPhone string `json:"displayPhone,omitempty"`
	VerifiedName string `json:"verifiedName,omitempty"`
	Quality      string `json:"quality,omitempty"`
	WABAID       string `json:"wabaId,omitempty"`
	Note         string `json:"note"`
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

	channelInfo, err := s.channelInfo(ctx)
	if err != nil {
		return Bootstrap{}, err
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
		Provider: channelInfo,
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
		if s.Channels != nil {
			if err := s.Channels.CanSendErr(ctx, s.Workspace); err != nil {
				out = append(out, QueueInfo{CampaignID: c.ID, Queued: c.Metrics.Queued,
					BlockedBy: "channel", Timezone: c.Schedule.Timezone})
				continue
			}
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

// channelInfo descreve o canal da conta para a tela.
//
// Em live, conta sem canal aparece como "inactive" — e a tela mostra o caminho
// de ativação, em vez de um "conectado" deduzido de configuração.
func (s *Service) channelInfo(ctx context.Context) (ProviderInfo, error) {
	ws, err := s.Store.Workspace(ctx, s.Workspace)
	if err != nil {
		return ProviderInfo{}, err
	}
	hasNumber := s.hasNumber(ctx, ws.WhatsAppNumber)

	// Serviço sem resolvedor é o modo de teste unitário: vale o provider
	// injetado, como antes.
	if s.Channels == nil {
		live := s.Provider.Name() == "meta-cloud"
		note := "Provedor dry-run: as mensagens são registradas e marcadas como enviadas, sem sair para a Meta."
		if live {
			note = "Conectado à Cloud API da Meta. Cada envio é uma mensagem real e cobrada."
		}
		return ProviderInfo{
			Name:      s.Provider.Name(),
			Mode:      providerMode(live),
			Live:      live,
			Activated: live,
			HasNumber: hasNumber,
			Note:      note,
		}, nil
	}

	c, err := s.Store.Channel(ctx, s.Workspace)
	if errors.Is(err, domain.ErrNotFound) || (err == nil && !c.Active()) {
		if !s.Channels.Live() {
			return ProviderInfo{
				Name: "dry-run", Mode: "dry-run", Live: false, Activated: false,
				HasNumber: hasNumber,
				Note: "Provedor dry-run: as mensagens são simuladas e não chegam a nenhum WhatsApp. " +
					"Ative o WhatsApp para conectar o número da empresa.",
			}, nil
		}
		return ProviderInfo{
			Name: "none", Mode: "inactive", Live: true, Activated: false,
			HasNumber: hasNumber,
			Note:      channelpkg.ErrNotActivated.Error(),
		}, nil
	}
	if err != nil {
		return ProviderInfo{}, err
	}

	live := c.Live()
	info := ProviderInfo{
		Name:         map[bool]string{true: "meta-cloud", false: "dry-run"}[live],
		Mode:         map[bool]string{true: "live", false: "dry-run"}[live],
		Live:         live,
		Activated:    true,
		HasNumber:    hasNumber,
		DisplayPhone: c.DisplayPhone,
		VerifiedName: c.VerifiedName,
		Quality:      c.Quality,
		WABAID:       c.WABAID,
	}
	if live {
		info.Note = "Conectado à Cloud API da Meta com o número desta conta. Cada envio é uma mensagem real e cobrada."
	} else {
		info.Note = "Canal ativado em dry-run: as mensagens continuam simuladas e não chegam a nenhum WhatsApp."
	}
	return info, nil
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
				s.applyInbound(ctx, v.Metadata.PhoneNumberID, msg.From, inboundText(msg.Text.Body, msg.Button))
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
func (s *Service) applyInbound(ctx context.Context, phoneID, from, text string) {
	if from == "" {
		return
	}
	// Sem sessão, o workspace vem do canal que RECEBEU a mensagem: com uma WABA
	// por conta, o metadata.phone_number_id identifica o dono sem ambiguidade.
	// O telefone do remetente é só o fallback (webhook antigo/sem metadata).
	ws := s.Workspace
	if ws == "" && phoneID != "" {
		if c, err := s.Store.ChannelByPhoneID(ctx, phoneID); err == nil {
			ws = c.WorkspaceID
		}
	}
	if ws == "" {
		owner, err := s.Store.WorkspaceByPhone(ctx, from)
		if err != nil || owner == "" {
			s.Log.Warn("webhook: telefone de workspace desconhecido", "from", from, "phoneId", phoneID)
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
