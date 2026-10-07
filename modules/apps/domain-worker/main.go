// domain-worker is the only binary that ever mutates the domain tables.
// It runs one processing loop: RabbitMQ delivers a
// command from the durable domain.commands.queue, the loop applies it
// via the matching aggregate's CommandHandler, records an
// internal/application/audit entry, and publishes the resulting domain
// event to the domain.events exchange.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	appannouncement "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/announcement"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	appclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/club"
	appclubsnapshot "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/clubsnapshot"
	appfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/finance"
	appmatch "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/match"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
	apppreference "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/preference"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/prospecta"
	domainannouncement "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/announcement"
	domainclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/club"
	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
	domainmatch "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/match"
	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preference"
	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
	inamqp "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/amqp"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/telemetry"
)

func main() {
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Telemetry failing to start must never stop command processing —
	// degrade to no telemetry and carry on. Empty
	// OTEL_EXPORTER_OTLP_ENDPOINT (local dev) skips init entirely; see
	// internal/telemetry.
	shutdownTelemetry, err := telemetry.Init(ctx, "domain-worker")
	if err != nil {
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	if err := telemetry.InitMetrics(); err != nil {
		log.Error("metric init failed; continuing without them", "error", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect error", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := postgres.Migrate(ctx, pool); err != nil {
		log.Error("migration error", "error", err)
		os.Exit(1)
	}

	bus, err := inamqp.Dial(cfg.RabbitMQURL)
	if err != nil {
		log.Error("rabbitmq connect error", "error", err)
		os.Exit(1)
	}
	defer bus.Close()

	eventBus, err := inamqp.NewEventBus(bus, cfg.EventsQueueMax)
	if err != nil {
		log.Error("event bus error", "error", err)
		os.Exit(1)
	}
	defer eventBus.Close()

	commandQueue, err := inamqp.NewCommandQueue(bus)
	if err != nil {
		log.Error("command queue error", "error", err)
		os.Exit(1)
	}

	auditRepo := postgres.NewAuditRepository(pool)

	// Outbox durável (§4.3): cada evento vira uma linha pendente ANTES da
	// tentativa de publish, então um broker fora do ar não perde um evento já
	// aplicado. O relay em background reescreve os pendentes quando ele volta.
	outboxRepo := postgres.NewOutboxRepository(pool)
	relay := outbox.NewRelay(outboxRepo, eventBus, log)
	go relay.Run(ctx, 5*time.Second)

	// FC Clubs Hub (specs/003): public Pro Clubs data + the per-person
	// preferences. Same wiring shape as every other aggregate above.
	clubRepo := postgres.NewClubRepository(pool)
	clubService := appclub.NewService(clubRepo)
	clubHandler := appclub.NewCommandHandler(clubService)

	clubeTotaisRepo := postgres.NewClubeTotaisRepository(pool)
	partidaRepo := postgres.NewPartidaRepository(pool)
	partidaService := appmatch.NewService(partidaRepo, clubeTotaisRepo)
	partidaHandler := appmatch.NewCommandHandler(partidaService)

	snapshotRepo := postgres.NewClubSnapshotRepository(pool)
	snapshotService := appclubsnapshot.NewService(snapshotRepo)
	snapshotHandler := appclubsnapshot.NewCommandHandler(snapshotService)

	anuncioRepo := postgres.NewAnuncioRepository(pool)
	anuncioService := appannouncement.NewService(anuncioRepo)
	anuncioHandler := appannouncement.NewCommandHandler(anuncioService)

	preferenciaRepo := postgres.NewPreferenciaRepository(pool)
	preferenciaService := apppreference.NewService(preferenciaRepo)
	preferenciaHandler := apppreference.NewCommandHandler(preferenciaService)

	// Financeiro (docs/finance-system-spec.md): a finance-api relaya o comando,
	// o worker aplica e grava a auditoria. Sem banco na ACL — a escrita é toda
	// aqui (§1.1).
	financeRepo := postgres.NewFinanceRepository(pool)
	financeService := appfinance.NewService(financeRepo)
	financeHandler := appfinance.NewCommandHandler(financeService)

	// Prospecta (specs/004-prospecta): primeiro vertical slice Company + ICP.
	// A prospecta-api (ACL sem banco) publica os comandos; o worker é o único
	// escritor das tabelas prospecta_* (§1.1).
	prospectaRepo := postgres.NewProspectaRepository(pool)
	prospectaService := appprospecta.NewService(prospectaRepo)
	prospectaHandler := appprospecta.NewCommandHandler(prospectaService)

	// Every aggregate's handler in one place: process() takes this
	// struct rather than a growing parameter list.
	hs := handlers{
		club: clubHandler, partida: partidaHandler, snapshot: snapshotHandler,
		anuncio: anuncioHandler, preferencia: preferenciaHandler,
		finance:      financeHandler,
		prospecta:    prospectaHandler,
		ingestEstado: postgres.NewIngestEstadoRepository(pool),
		fetchRun:     postgres.NewFetchRunRepository(pool),
		searchRun:    postgres.NewSearchRunRepository(pool),
		career:       postgres.NewPlayerCareerRepository(pool),
	}

	go func() {
		log.Info("processing loop started")
		for {
			cmd, err := commandQueue.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Error("fetch command error", "error", err)
				continue
			}
			process(ctx, log, hs, auditRepo, relay, cmd)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
}

// process routes cmd to the right aggregate's CommandHandler by its
// Action family ("club." / "partida." / the clubs.* queue actions), then
// always records an audit entry (success or failure) and, only on success,
// publishes the resulting domain event. One shared command queue serves
// every aggregate; this is the one place that knows how to fan a Command
// back out to its owning handler.
// handlers bundles every aggregate's CommandHandler. One struct instead of a
// twenty-parameter list: adding an aggregate is one field, and process()'s
// signature never changes again.
type handlers struct {
	club        *appclub.CommandHandler
	partida     *appmatch.CommandHandler
	snapshot    *appclubsnapshot.CommandHandler
	anuncio     *appannouncement.CommandHandler
	preferencia *apppreference.CommandHandler
	// Financeiro (finance.*): o handler devolve uma LISTA de eventos (um
	// comando de orçamento pode cruzar várias réguas), por isso o case dele é
	// tratado à parte no process().
	finance *appfinance.CommandHandler
	// Prospecta (specs/004-prospecta): Company + ICP. Um evento por comando;
	// a reentrega idempotente devolve nil e não republica.
	prospecta *appprospecta.CommandHandler
	// Saúde do worker de ingestão: um upsert direto, não um agregado -- o
	// worker é um poller sem host, e esta é a única forma de a saúde dele
	// chegar até a API.
	ingestEstado *postgres.IngestEstadoRepository
	// Fila de fetch sob demanda de um clube: escrita pela tela de resgate,
	// consumida pelo worker de ingestão (Python), que grava o resultado por
	// aqui.
	fetchRun *postgres.FetchRunRepository
	// Fila de busca ao vivo na fonte: escrita pela tela de resgate para um
	// clube que o hub ainda não viu, consumida pelo worker de ingestão.
	searchRun *postgres.SearchRunRepository
	// Totais de carreira de um jogador num clube (members/career/stats), que
	// a temporada corrente não dá.
	career *postgres.PlayerCareerRepository
}

func process(ctx context.Context, log *slog.Logger, h handlers, audits audit.Repository, relay *outbox.Relay, cmd application.Command) {
	// One span per command: the handler, the audit write and the event
	// publish below are the whole story of that write, and the
	// trace_id stamped into the log lines ties every one of them to it.
	ctx, span := otel.Tracer("domain-worker").Start(ctx, "process "+string(cmd.Action),
		trace.WithAttributes(
			attribute.String("command.id", cmd.ID),
			attribute.String("command.action", string(cmd.Action)),
		))
	defer span.End()

	var (
		evt        interface{ EventName() string }
		err        error
		entityType string
		id         string
		// O financeiro devolve N eventos (réguas de orçamento). Ficam aqui e
		// são publicados todos, além do evt único das outras famílias.
		financeEvents []domainfinance.Event
	)

	// A família clubs tem três destinos que se parecem por prefixo; a decisão
	// é pura e testada (ver classifyClubsAction).
	k := classifyClubsAction(cmd.Action)

	switch {
	case strings.HasPrefix(string(cmd.Action), "club."):
		entityType = "club"
		var cevt domainclub.Event
		cevt, err = h.club.Handle(ctx, cmd)
		if cevt != nil {
			evt = cevt
			id = clubEntityID(cevt)
		}
	case strings.HasPrefix(string(cmd.Action), "clubetotais."):
		// Routed through the partida handler: the two travel in the same
		// ingest cycle and the totals repository lives beside the matches one.
		entityType = "clubetotais"
		_, err = h.partida.Handle(ctx, cmd)
		if in, ok := cmd.Payload, err == nil; ok && in != nil {
			// The action carries no event; the entity id comes from the payload.
			var p struct {
				ClubID string `json:"club_id"`
			}
			_ = json.Unmarshal(cmd.Payload, &p)
			id = p.ClubID
		}
	case strings.HasPrefix(string(cmd.Action), "partida."):
		entityType = "partida"
		var pevt domainmatch.Event
		pevt, err = h.partida.Handle(ctx, cmd)
		if pevt != nil {
			evt = pevt
			id = partidaEntityID(pevt)
		}
	case strings.HasPrefix(string(cmd.Action), "clubesnapshot."):
		// The snapshot handler raises no event -- the division change is
		// recorded in the same transaction and read back by the API.
		entityType = "clubesnapshot"
		_, err = h.snapshot.Handle(ctx, cmd)
	case strings.HasPrefix(string(cmd.Action), "anuncio."):
		entityType = "anuncio"
		_, err = h.anuncio.Handle(ctx, cmd)
	// Os três destinos da família clubs. Vêm de classifyClubsAction, que é
	// pura e testada -- foi uma colisão de prefixo aqui (o genérico "clubs."
	// engolindo clubs.fetchRun) que fez a fila de fetch nunca ser criada.
	case k == clubsKindFetch:
		entityType = "clubesfetch"
		var in clubsFetchPayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.TargetID
			err = h.fetchRun.Save(ctx, in.Target, in.TargetID, in.Label, true, 0, 0, 0, "", false)
		}
	case k == clubsKindFetchSave:
		entityType = "clubesfetch"
		var in clubsFetchSavePayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.TargetID
			err = h.fetchRun.Save(ctx, in.Target, in.TargetID, in.Label, in.Running,
				in.Players, in.Matches, in.Clubs, in.Error, in.Concluido)
		}
	case k == clubsKindSearch:
		// A tela de resgate pediu uma busca ao vivo: abre a linha como
		// rodando. O worker Python polla e é ele quem consulta a fonte.
		entityType = "clubesbusca"
		var in clubsSearchPayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.Termo
			err = h.searchRun.Save(ctx, in.Termo, true, 0, "", false)
		}
	case k == clubsKindSearchSave:
		entityType = "clubesbusca"
		var in clubsSearchSavePayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.Termo
			err = h.searchRun.Save(ctx, in.Termo, in.Running, in.Found, in.Error, in.Concluido)
		}
	case k == clubsKindCareer:
		// Totais de carreira de um jogador num clube, do members/career/stats.
		// Alta volumetria e append-only (uma leitura substitui a anterior),
		// então sem agregado nem evento -- upsert direto.
		entityType = "clubescarreira"
		var in clubsCareerPayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.ClubID
			err = h.career.Save(ctx, in.ClubID, in.Gamertag, in.Played, in.Goals,
				in.Assists, in.ManOfTheMatch, in.Rating, in.Position)
		}
	case k == clubsKindIngestHealth:
		// Saúde do worker de ingestão: um upsert simples, sem agregado nem
		// evento. Chega aqui porque o worker não tem host próprio para expor
		// um /healthz.
		entityType = "clubesingest"
		var in clubsIngestPayload
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			err = h.ingestEstado.Save(ctx, in.Cycles, in.ClubsOK, in.ClubsFailed,
				in.NewMatches, in.Snapshots, in.Bootstrapped, in.LastError,
				in.SourceAvailable, in.SourceError)
		}
	case strings.HasPrefix(string(cmd.Action), "preferencia."):
		// Per-person writes, all carrying usuario_email. The API is the
		// only producer; no domain event is raised (nothing subscribes).
		entityType = "preferencia"
		err = h.preferencia.Handle(ctx, cmd)
	case strings.HasPrefix(string(cmd.Action), "finance."):
		// Financeiro (§4.1): o handler devolve N eventos (réguas de orçamento
		// podem cruzar várias de uma vez). O id da entidade vem do próprio
		// payload/evento -- não há um agregado único. Publicamos todos aqui.
		entityType = "finance"
		var events []domainfinance.Event
		events, err = h.finance.Handle(ctx, cmd)
		if err == nil {
			financeEvents = events
			if len(events) > 0 {
				id = financeEntityID(events[0])
			}
		}
	case isProspectaAction(cmd.Action):
		// Prospecta (specs/004-prospecta): Company/ICP + os agregados de
		// campanha, lead, mensagem e conversa. A action é o nome do comando em
		// PascalCase (contrato §7.2), por isso o case casa por igualdade e não
		// por prefixo. Um evento por comando; a reentrega idempotente devolve
		// nil (sem republicar).
		entityType = "prospecta"
		var pevt domainprospecta.Event
		pevt, err = h.prospecta.Handle(ctx, cmd)
		if pevt != nil {
			evt = pevt
			id = prospectaEntityID(pevt)
		}
	default:
		err = fmt.Errorf("unknown action: %q", cmd.Action)
	}

	switch {
	case err != nil:
		telemetry.RecordCommand(string(cmd.Action), "error")
	default:
		telemetry.RecordCommand(string(cmd.Action), "ok")
	}

	entry := audit.Entry{
		CommandID:  cmd.ID,
		EntityType: entityType,
		EntityID:   id,
		Action:     string(cmd.Action),
		Payload:    cmd.Payload,
		Success:    err == nil,
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		entry.Error = err.Error()
		log.ErrorContext(ctx, "command failed", "error", err, "command_id", cmd.ID, "action", cmd.Action)
	} else {
		// Publica via outbox durável (§4.3/§12.5): grava pendente antes de
		// tentar. Um broker fora do ar deixa a linha pendente para o relay —
		// a escrita já aplicada nunca se perde. Relay.Publish devolve erro só
		// quando o ENQUEUE falha (marshal/DB), não quando o publish atrasa.
		events := make([]outbox.Event, 0, 1+len(financeEvents))
		if evt != nil {
			events = append(events, evt)
		}
		for _, fe := range financeEvents {
			events = append(events, fe)
		}
		if pubErr := relay.Publish(ctx, cmd.ID, events); pubErr != nil {
			span.RecordError(pubErr)
			entry.Error = pubErr.Error()
			entry.Success = false
			log.ErrorContext(ctx, "outbox enqueue failed", "error", pubErr, "command_id", cmd.ID)
		}
	}
	if auditErr := audits.Record(ctx, entry); auditErr != nil {
		span.RecordError(auditErr)
		log.ErrorContext(ctx, "audit write failed", "error", auditErr, "command_id", cmd.ID)
	}
}

// clubsKind é o destino de uma ação da família "clubs." dentro do worker.
type clubsKind int

const (
	clubsKindOther clubsKind = iota
	clubsKindIngestHealth
	clubsKindFetch
	clubsKindFetchSave
	clubsKindSearch
	clubsKindSearchSave
	clubsKindCareer
)

// Os payloads que chegam pelo barramento. As tags JSON têm que casar com o
// que os produtores publicam -- domain-api's appclubs.*Input e o
// clubs-ingest (Python). Ficam como tipos nomeados, e não structs anônimos
// inline, porque um campo que não casa NÃO dá erro: json.Unmarshal só deixa o
// campo no zero. Já aconteceu: o codemod renomeou os produtores mas pulou este
// arquivo (ele está na raiz do módulo, fora de internal/), e a tela de resgate
// passou a gravar linhas vazias sem sintoma nenhum. main_test.go trava o
// contrato contra os payloads reais.
type clubsFetchPayload struct {
	Target   string `json:"target"`
	TargetID string `json:"target_id"`
	Label    string `json:"label"`
}

type clubsFetchSavePayload struct {
	Target    string `json:"target"`
	TargetID  string `json:"target_id"`
	Label     string `json:"label"`
	Running   bool   `json:"running"`
	Players   int    `json:"players"`
	Matches   int    `json:"matches"`
	Clubs     int    `json:"clubs"`
	Error     string `json:"error"`
	Concluido bool   `json:"concluido"`
}

type clubsSearchPayload struct {
	Termo string `json:"termo"`
}

type clubsSearchSavePayload struct {
	Termo     string `json:"termo"`
	Running   bool   `json:"running"`
	Found     int    `json:"found"`
	Error     string `json:"error"`
	Concluido bool   `json:"concluido"`
}

type clubsCareerPayload struct {
	ClubID        string  `json:"club_id"`
	Gamertag      string  `json:"gamertag"`
	Played        int     `json:"played"`
	Goals         int     `json:"goals"`
	Assists       int     `json:"assists"`
	ManOfTheMatch int     `json:"man_of_the_match"`
	Rating        float64 `json:"rating"`
	Position      string  `json:"position"`
}

type clubsIngestPayload struct {
	Cycles       int    `json:"cycles"`
	ClubsOK      int    `json:"clubs_ok"`
	ClubsFailed  int    `json:"clubs_failed"`
	NewMatches   int    `json:"new_matches"`
	Snapshots    int    `json:"snapshots"`
	Bootstrapped bool   `json:"bootstrapped"`
	LastError    string `json:"last_error"`
	// Saúde da fonte, separada do erro do ciclo: source_available=false é a
	// fonte inteira fora (403/CDN), o que a interface traduz no aviso de
	// dificuldade de falar com a fornecedora dos dados.
	SourceAvailable bool   `json:"source_available"`
	SourceError     string `json:"source_error"`
}

// classifyClubsAction decide PARA ONDE vai uma ação da família clubs.
//
// Existe porque o match por prefixo ("clubs.") engolia clubs.fetchRun: o
// pedido de fetch caía no case da saúde do worker, que gravava a saúde com
// zeros e nunca criava a linha da fila -- o clique na tela de resgate não
// fazia nada, sem erro nenhum. Isolar a decisão numa função pura é o que
// torna essa colisão testável.
func classifyClubsAction(a application.Action) clubsKind {
	switch a {
	case application.ActionSaveIngestEstado:
		return clubsKindIngestHealth
	case application.ActionRequestFetchRun:
		return clubsKindFetch
	case application.ActionSaveFetchRun:
		return clubsKindFetchSave
	case application.ActionRequestSearchRun:
		return clubsKindSearch
	case application.ActionSaveSearchRun:
		return clubsKindSearchSave
	case application.ActionSaveCareer:
		return clubsKindCareer
	default:
		return clubsKindOther
	}
}

func clubEntityID(evt domainclub.Event) string {
	switch e := evt.(type) {
	case domainclub.Upserted:
		return e.ClubID
	default:
		return ""
	}
}

func partidaEntityID(evt domainmatch.Event) string {
	switch e := evt.(type) {
	case domainmatch.Upserted:
		return e.MatchID
	default:
		return ""
	}
}

// financeEntityID extrai o id relevante de um evento financeiro para a linha
// de auditoria: a transação (registered/categorized), a transferência, ou a
// régua de orçamento. Um evento que não casa devolve "".
func financeEntityID(evt domainfinance.Event) string {
	switch e := evt.(type) {
	case domainfinance.TransactionRegistered:
		return e.TransactionID
	case domainfinance.TransactionCategorized:
		return e.TransactionID
	case domainfinance.TransferCompleted:
		return e.TransactionID
	case domainfinance.BudgetThresholdReached:
		return e.BudgetID
	default:
		return ""
	}
}

// prospectaEntityID extrai o id relevante de um evento do Prospecta para a
// linha de auditoria: a empresa no CompanyRegistered, o ICP no ICPDefined, e
// assim por diante. A ação do Prospecta é o nome do comando em PascalCase, não
// uma família dotted, então o roteamento é por igualdade (isProspectaAction).
func prospectaEntityID(evt domainprospecta.Event) string {
	switch e := evt.(type) {
	case domainprospecta.CompanyRegistered:
		return e.CompanyID
	case domainprospecta.ICPDefined:
		return e.ICPID
	case domainprospecta.CampaignStarted:
		return e.CampaignID
	case domainprospecta.ProspectRequested:
		return e.RunID
	case domainprospecta.LeadDiscovered:
		return e.LeadID
	case domainprospecta.LeadEnriched:
		return e.LeadID
	case domainprospecta.LeadQualified:
		return e.LeadID
	case domainprospecta.MessageDrafted:
		return e.MessageID
	case domainprospecta.MessageApproved:
		return e.MessageID
	case domainprospecta.MessageSent:
		return e.MessageID
	case domainprospecta.ReplyReceived:
		return e.ConversationID
	case domainprospecta.MeetingBooked:
		return e.LeadID
	case domainprospecta.UserRegistered:
		return e.UserID
	default:
		return ""
	}
}

// prospectaActions é o conjunto fechado de comandos da família Prospecta. A
// action é o nome do comando em PascalCase (contrato §7.2) — diferente das
// outras famílias, que usam prefixo dotted — então o process() casa por
// pertinência a este conjunto, não por prefixo.
var prospectaActions = map[application.Action]bool{
	application.ActionCreateCompany:  true,
	application.ActionDefineICP:      true,
	application.ActionCreateCampaign: true,
	application.ActionStartCampaign:  true,
	application.ActionRequestProspect: true,
	application.ActionUpsertLead:     true,
	application.ActionQualifyLead:    true,
	application.ActionDraftMessage:   true,
	application.ActionApproveMessage: true,
	application.ActionSendMessage:    true,
	application.ActionReceiveReply:   true,
	application.ActionBookMeeting:    true,
	application.ActionCreateUser:     true,
}

func isProspectaAction(a application.Action) bool { return prospectaActions[a] }

// domainpref is imported for the preferencia handler's type; the blank
// reference keeps the import meaningful even as the aggregate grows.
var _ = domainpref.OrigemManual
var _ domainannouncement.Event
