// domain-worker is the only binary that ever calls domain/user.Repository's
// mutating methods. It runs two concurrent loops — the bus Relay
// (bridges the pub/sub command channel into the durable queue) and the
// processing loop below (pops a command, applies it via
// internal/application/user's CommandHandler, records an
// internal/application/audit entry, publishes the resulting domain
// event).
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

	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	appanuncio "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/anuncio"
	appaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/aposta"
	appativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/ativo"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	appcchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/cchdeck"
	appcchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/cchroom"
	appclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/club"
	appclubesnapshot "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/clubesnapshot"
	appconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/conta"
	appdashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/dashboardlayout"
	appdeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/deal"
	applead "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/lead"
	appmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/message"
	apppartida "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/partida"
	apppost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/post"
	apppreferencia "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/preferencia"
	approom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/room"
	apptransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/transacao"
	appuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/user"
	domainanuncio "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/anuncio"
	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/aposta"
	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativo"
	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchdeck"
	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchroom"
	domainclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/club"
	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/conta"
	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/dashboardlayout"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
	domainlead "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/lead"
	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/message"
	domainpartida "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/partida"
	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preferencia"
	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/room"
	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/transacao"
	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
	inredis "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/redis"
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

	rdb := goredis.NewClient(&goredis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPass})
	defer rdb.Close()

	relay := inredis.NewRelay(rdb)
	commandQueue := inredis.NewCommandQueue(rdb)
	eventBus := inredis.NewEventBus(rdb, int64(cfg.EventsQueueMax))

	userRepo := postgres.NewUserRepository(pool)
	auditRepo := postgres.NewAuditRepository(pool)
	userService := appuser.NewService(userRepo)
	userHandler := appuser.NewCommandHandler(userService)

	postRepo := postgres.NewPostRepository(pool)
	postService := apppost.NewService(postRepo)
	postHandler := apppost.NewCommandHandler(postService)

	roomRepo := postgres.NewRoomRepository(pool)
	roomService := approom.NewService(roomRepo)
	roomHandler := approom.NewCommandHandler(roomService)

	messageRepo := postgres.NewMessageRepository(pool)
	messageService := appmessage.NewService(messageRepo)
	messageHandler := appmessage.NewCommandHandler(messageService)

	dealRepo := postgres.NewDealRepository(pool)
	dealService := appdeal.NewService(dealRepo)
	dealHandler := appdeal.NewCommandHandler(dealService)

	cchRoomRepo := postgres.NewCCHRoomRepository(pool)
	cchRoomService := appcchroom.NewService(cchRoomRepo)
	cchRoomHandler := appcchroom.NewCommandHandler(cchRoomService)

	cchDeckRepo := postgres.NewCCHDeckRepository(pool)
	cchDeckService := appcchdeck.NewService(cchDeckRepo)
	cchDeckHandler := appcchdeck.NewCommandHandler(cchDeckService)

	contaRepo := postgres.NewContaRepository(pool)
	contaService := appconta.NewService(contaRepo)
	contaHandler := appconta.NewCommandHandler(contaService)

	transacaoRepo := postgres.NewTransacaoRepository(pool)
	transacaoService := apptransacao.NewService(transacaoRepo)
	transacaoHandler := apptransacao.NewCommandHandler(transacaoService)

	ativoRepo := postgres.NewAtivoRepository(pool)
	ativoService := appativo.NewService(ativoRepo)
	ativoHandler := appativo.NewCommandHandler(ativoService)

	apostaRepo := postgres.NewApostaRepository(pool)
	apostaService := appaposta.NewService(apostaRepo)
	apostaHandler := appaposta.NewCommandHandler(apostaService)

	dashboardLayoutRepo := postgres.NewDashboardLayoutRepository(pool)
	dashboardLayoutService := appdashboardlayout.NewService(dashboardLayoutRepo)
	dashboardLayoutHandler := appdashboardlayout.NewCommandHandler(dashboardLayoutService)

	leadRepo := postgres.NewLeadRepository(pool)
	leadService := applead.NewService(leadRepo)
	leadHandler := applead.NewCommandHandler(leadService)

	// FC Clubs Hub (specs/003): public Pro Clubs data + the per-person
	// preferences. Same wiring shape as every other aggregate above.
	clubRepo := postgres.NewClubRepository(pool)
	clubService := appclub.NewService(clubRepo)
	clubHandler := appclub.NewCommandHandler(clubService)

	clubeTotaisRepo := postgres.NewClubeTotaisRepository(pool)
	partidaRepo := postgres.NewPartidaRepository(pool)
	partidaService := apppartida.NewService(partidaRepo, clubeTotaisRepo)
	partidaHandler := apppartida.NewCommandHandler(partidaService)

	snapshotRepo := postgres.NewClubSnapshotRepository(pool)
	snapshotService := appclubesnapshot.NewService(snapshotRepo)
	snapshotHandler := appclubesnapshot.NewCommandHandler(snapshotService)

	anuncioRepo := postgres.NewAnuncioRepository(pool)
	anuncioService := appanuncio.NewService(anuncioRepo)
	anuncioHandler := appanuncio.NewCommandHandler(anuncioService)

	preferenciaRepo := postgres.NewPreferenciaRepository(pool)
	preferenciaService := apppreferencia.NewService(preferenciaRepo)
	preferenciaHandler := apppreferencia.NewCommandHandler(preferenciaService)

	// Every aggregate's handler in one place: process() takes this
	// struct rather than a growing parameter list.
	hs := handlers{
		user: userHandler, post: postHandler, room: roomHandler, message: messageHandler,
		deal: dealHandler, cchRoom: cchRoomHandler, cchDeck: cchDeckHandler,
		conta: contaHandler, transacao: transacaoHandler, ativo: ativoHandler,
		aposta: apostaHandler, dashboardLayout: dashboardLayoutHandler, lead: leadHandler,
		club: clubHandler, partida: partidaHandler, snapshot: snapshotHandler,
		anuncio: anuncioHandler, preferencia: preferenciaHandler,
		ingestEstado: postgres.NewIngestEstadoRepository(pool),
		fetchRun:     postgres.NewFetchRunRepository(pool),
		searchRun:    postgres.NewSearchRunRepository(pool),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("relay started")
		if err := relay.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			errCh <- err
		}
	}()

	go func() {
		log.Info("processing loop started")
		for {
			cmd, err := commandQueue.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, goredis.ErrClosed) {
					return
				}
				log.Error("fetch command error", "error", err)
				continue
			}
			process(ctx, log, hs, auditRepo, eventBus, cmd)
		}
	}()

	select {
	case <-ctx.Done():
		log.Info("shutting down")
	case err := <-errCh:
		log.Error("relay error", "error", err)
		os.Exit(1)
	}
}

// process routes cmd to the right aggregate's CommandHandler by its
// Action prefix ("user." / "post." / "deal."), then always records an
// audit entry (success or failure) and, only on success, publishes the
// resulting domain event. One shared command queue serves every
// aggregate; this is the one place that knows how to fan a Command
// back out to its owning handler.
// handlers bundles every aggregate's CommandHandler. One struct instead of a
// twenty-parameter list: adding an aggregate is one field, and process()'s
// signature never changes again.
type handlers struct {
	user            *appuser.CommandHandler
	post            *apppost.CommandHandler
	room            *approom.CommandHandler
	message         *appmessage.CommandHandler
	deal            *appdeal.CommandHandler
	cchRoom         *appcchroom.CommandHandler
	cchDeck         *appcchdeck.CommandHandler
	conta           *appconta.CommandHandler
	transacao       *apptransacao.CommandHandler
	ativo           *appativo.CommandHandler
	aposta          *appaposta.CommandHandler
	dashboardLayout *appdashboardlayout.CommandHandler
	lead            *applead.CommandHandler
	club            *appclub.CommandHandler
	partida         *apppartida.CommandHandler
	snapshot        *appclubesnapshot.CommandHandler
	anuncio         *appanuncio.CommandHandler
	preferencia     *apppreferencia.CommandHandler
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
}

func process(ctx context.Context, log *slog.Logger, h handlers, audits audit.Repository, eventBus *inredis.EventBus, cmd application.Command) {
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
	)

	// A família clubs tem três destinos que se parecem por prefixo; a decisão
	// é pura e testada (ver classifyClubsAction).
	k := classifyClubsAction(cmd.Action)

	switch {
	case strings.HasPrefix(string(cmd.Action), "user."):
		entityType = "user"
		var uevt domainuser.Event
		uevt, err = h.user.Handle(ctx, cmd)
		if uevt != nil {
			evt = uevt
			id = userEntityID(uevt)
		}
	case strings.HasPrefix(string(cmd.Action), "post."):
		entityType = "post"
		var pevt domainpost.Event
		pevt, err = h.post.Handle(ctx, cmd)
		if pevt != nil {
			evt = pevt
			id = postEntityID(pevt)
		}
	case strings.HasPrefix(string(cmd.Action), "room."):
		entityType = "room"
		var revt domainroom.Event
		revt, err = h.room.Handle(ctx, cmd)
		if revt != nil {
			evt = revt
			id = roomEntityID(revt)
		}
	case strings.HasPrefix(string(cmd.Action), "message."):
		entityType = "message"
		var mevt domainmessage.Event
		mevt, err = h.message.Handle(ctx, cmd)
		if mevt != nil {
			evt = mevt
			id = messageEntityID(mevt)
		}
	case strings.HasPrefix(string(cmd.Action), "deal."):
		// The deal handler returns the Deal even when this upsert was
		// an update (which raises no event) — either way the audit row
		// should name the exact source:source_deal_id it touched.
		entityType = "deal"
		var d domaindeal.Deal
		var devt domaindeal.Event
		d, devt, err = h.deal.Handle(ctx, cmd)
		if devt != nil {
			evt = devt
		}
		if d.Source != "" {
			id = d.EntityID()
			telemetry.RecordDealUpsert(d.Source, map[bool]string{true: "inserted", false: "updated"}[devt != nil])
		}
	case strings.HasPrefix(string(cmd.Action), "cchroom."):
		entityType = "cchroom"
		var cevt domaincchroom.Event
		cevt, err = h.cchRoom.Handle(ctx, cmd)
		if cevt != nil {
			evt = cevt
			id = cchRoomEntityID(cevt)
		}
	case strings.HasPrefix(string(cmd.Action), "cchdeck."):
		entityType = "cchdeck"
		var cevt domaincchdeck.Event
		cevt, err = h.cchDeck.Handle(ctx, cmd)
		if cevt != nil {
			evt = cevt
			id = cchDeckEntityID(cevt)
		}
	case strings.HasPrefix(string(cmd.Action), "conta."):
		entityType = "conta"
		var cevt domainconta.Event
		cevt, err = h.conta.Handle(ctx, cmd)
		if cevt != nil {
			evt = cevt
			id = contaEntityID(cevt)
		}
	case strings.HasPrefix(string(cmd.Action), "transacao."):
		entityType = "transacao"
		var tevt domaintransacao.Event
		tevt, err = h.transacao.Handle(ctx, cmd)
		if tevt != nil {
			evt = tevt
			id = transacaoEntityID(tevt)
		}
	case strings.HasPrefix(string(cmd.Action), "ativo."):
		entityType = "ativo"
		var aevt domainativo.Event
		aevt, err = h.ativo.Handle(ctx, cmd)
		if aevt != nil {
			evt = aevt
			id = ativoEntityID(aevt)
		}
	case strings.HasPrefix(string(cmd.Action), "aposta."):
		entityType = "aposta"
		var apevt domainaposta.Event
		apevt, err = h.aposta.Handle(ctx, cmd)
		if apevt != nil {
			evt = apevt
			id = apostaEntityID(apevt)
		}
	case strings.HasPrefix(string(cmd.Action), "dashboardlayout."):
		entityType = "dashboardlayout"
		var devt domaindashboardlayout.Event
		devt, err = h.dashboardLayout.Handle(ctx, cmd)
		if devt != nil {
			evt = devt
			id = dashboardLayoutEntityID(devt)
		}
	case strings.HasPrefix(string(cmd.Action), "lead."):
		entityType = "lead"
		var levt domainlead.Event
		levt, err = h.lead.Handle(ctx, cmd)
		if levt != nil {
			evt = levt
			id = leadEntityID(levt)
		}
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
		var pevt domainpartida.Event
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
		var in struct {
			ClubID string `json:"club_id"`
		}
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.ClubID
			err = h.fetchRun.Save(ctx, in.ClubID, true, 0, 0, "", false)
		}
	case k == clubsKindFetchSave:
		entityType = "clubesfetch"
		var in struct {
			ClubID    string `json:"club_id"`
			Rodando   bool   `json:"rodando"`
			Jogadores int    `json:"jogadores"`
			Partidas  int    `json:"partidas"`
			Erro      string `json:"erro"`
			Concluido bool   `json:"concluido"`
		}
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.ClubID
			err = h.fetchRun.Save(ctx, in.ClubID, in.Rodando, in.Jogadores, in.Partidas, in.Erro, in.Concluido)
		}
	case k == clubsKindSearch:
		// A tela de resgate pediu uma busca ao vivo: abre a linha como
		// rodando. O worker Python polla e é ele quem consulta a fonte.
		entityType = "clubesbusca"
		var in struct {
			Termo string `json:"termo"`
		}
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.Termo
			err = h.searchRun.Save(ctx, in.Termo, true, 0, "", false)
		}
	case k == clubsKindSearchSave:
		entityType = "clubesbusca"
		var in struct {
			Termo       string `json:"termo"`
			Rodando     bool   `json:"rodando"`
			Encontrados int    `json:"encontrados"`
			Erro        string `json:"erro"`
			Concluido   bool   `json:"concluido"`
		}
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			id = in.Termo
			err = h.searchRun.Save(ctx, in.Termo, in.Rodando, in.Encontrados, in.Erro, in.Concluido)
		}
	case k == clubsKindIngestHealth:
		// Saúde do worker de ingestão: um upsert simples, sem agregado nem
		// evento. Chega aqui porque o worker não tem host próprio para expor
		// um /healthz.
		entityType = "clubesingest"
		var in struct {
			Rodadas        int    `json:"rodadas"`
			ClubesOK       int    `json:"clubes_ok"`
			ClubesFalhos   int    `json:"clubes_falhos"`
			PartidasNovas  int    `json:"partidas_novas"`
			Snapshots      int    `json:"snapshots"`
			BootstrapFeito bool   `json:"bootstrap_feito"`
			UltimoErro     string `json:"ultimo_erro"`
		}
		if err = json.Unmarshal(cmd.Payload, &in); err == nil {
			err = h.ingestEstado.Save(ctx, in.Rodadas, in.ClubesOK, in.ClubesFalhos,
				in.PartidasNovas, in.Snapshots, in.BootstrapFeito, in.UltimoErro)
		}
	case strings.HasPrefix(string(cmd.Action), "preferencia."):
		// Per-person writes, all carrying usuario_email. The API is the
		// only producer; no domain event is raised (nothing subscribes).
		entityType = "preferencia"
		err = h.preferencia.Handle(ctx, cmd)
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
	} else if evt != nil {
		if pubErr := eventBus.Publish(ctx, evt); pubErr != nil {
			span.RecordError(pubErr)
			log.ErrorContext(ctx, "publish event failed", "error", pubErr, "command_id", cmd.ID)
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
)

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
	default:
		return clubsKindOther
	}
}

// userEntityID/postEntityID pull the affected aggregate's ID out of
// its domain event for the audit row — the only place that needs it,
// since Create doesn't know its own generated ID until the event
// comes back from the handler.
func userEntityID(evt domainuser.Event) string {
	switch e := evt.(type) {
	case domainuser.Created:
		return e.UserID
	case domainuser.Updated:
		return e.UserID
	case domainuser.Deleted:
		return e.UserID
	default:
		return ""
	}
}

func postEntityID(evt domainpost.Event) string {
	switch e := evt.(type) {
	case domainpost.Created:
		return e.PostID
	case domainpost.Updated:
		return e.PostID
	case domainpost.Deleted:
		return e.PostID
	default:
		return ""
	}
}

func roomEntityID(evt domainroom.Event) string {
	switch e := evt.(type) {
	case domainroom.Created:
		return e.RoomID
	case domainroom.Updated:
		return e.RoomID
	case domainroom.Deleted:
		return e.RoomID
	default:
		return ""
	}
}

func messageEntityID(evt domainmessage.Event) string {
	switch e := evt.(type) {
	case domainmessage.Created:
		return e.MessageID
	default:
		return ""
	}
}

func cchRoomEntityID(evt domaincchroom.Event) string {
	switch e := evt.(type) {
	case domaincchroom.Created:
		return e.RoomID
	case domaincchroom.Deleted:
		return e.RoomID
	default:
		return ""
	}
}

func cchDeckEntityID(evt domaincchdeck.Event) string {
	switch e := evt.(type) {
	case domaincchdeck.Upserted:
		return e.DeckID
	case domaincchdeck.Played:
		return e.DeckID
	default:
		return ""
	}
}

func contaEntityID(evt domainconta.Event) string {
	switch e := evt.(type) {
	case domainconta.Created:
		return e.ContaID
	case domainconta.Updated:
		return e.ContaID
	default:
		return ""
	}
}

func transacaoEntityID(evt domaintransacao.Event) string {
	switch e := evt.(type) {
	case domaintransacao.Created:
		return e.TransacaoID
	case domaintransacao.Updated:
		return e.TransacaoID
	case domaintransacao.Deleted:
		return e.TransacaoID
	default:
		return ""
	}
}

func apostaEntityID(evt domainaposta.Event) string {
	switch e := evt.(type) {
	case domainaposta.Registrada:
		return e.ApostaID
	case domainaposta.Resolvida:
		return e.ApostaID
	default:
		return ""
	}
}

func ativoEntityID(evt domainativo.Event) string {
	switch e := evt.(type) {
	case domainativo.Created:
		return e.AtivoID
	case domainativo.MovimentoRegistrado:
		return e.AtivoID
	case domainativo.CotacaoAtualizada:
		return e.AtivoID
	default:
		return ""
	}
}

func dashboardLayoutEntityID(evt domaindashboardlayout.Event) string {
	switch e := evt.(type) {
	case domaindashboardlayout.Saved:
		return e.UsuarioEmail
	case domaindashboardlayout.Deleted:
		return e.UsuarioEmail
	default:
		return ""
	}
}

func leadEntityID(evt domainlead.Event) string {
	switch e := evt.(type) {
	case domainlead.Captured:
		return e.LeadID
	default:
		return ""
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

func partidaEntityID(evt domainpartida.Event) string {
	switch e := evt.(type) {
	case domainpartida.Upserted:
		return e.MatchID
	default:
		return ""
	}
}

// domainpref is imported for the preferencia handler's type; the blank
// reference keeps the import meaningful even as the aggregate grows.
var _ = domainpref.OrigemManual
var _ domainanuncio.Event
