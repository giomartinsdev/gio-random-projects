package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// Worker drena a fila de envios. Roda num goroutine só (o volume da POC não
// justifica pool), mas o claim no banco é SKIP LOCKED — subir duas instâncias
// não duplica mensagem.
type Worker struct {
	Store    *store.Store
	Provider meta.Provider
	Log      *slog.Logger
	Interval time.Duration
}

// Run processa um lote a cada tick até o contexto ser cancelado.
func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := w.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
				w.Log.Error("fila: tick falhou", "error", err)
			}
		}
	}
}

// Tick processa um lote e devolve quantas mensagens tentou. Exportado para o
// teste conseguir avançar a fila sem esperar o relógio.
func (w *Worker) Tick(ctx context.Context) (int, error) {
	ws := store.DemoWorkspaceID

	// A decisão de janela é por campanha. Para a POC há uma campanha em
	// execução por vez em cada tick; pegar a mais antiga com fila é suficiente e
	// evita mandar de uma campanha fora da janela enquanto outra está aberta.
	campaignID, window, ok, err := w.nextCampaign(ctx, ws)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, nil
	}
	if !window.Open(time.Now()) {
		return 0, nil
	}

	batch := window.BatchSize(w.Interval)
	jobs, err := w.Store.ClaimQueued(ctx, ws, batch)
	if err != nil {
		return 0, err
	}
	if len(jobs) == 0 {
		// Nada na fila desta campanha: encerra quando não há mais pendentes.
		w.finishIfDrained(ctx, ws, campaignID)
		return 0, nil
	}

	for _, job := range jobs {
		w.deliver(ctx, job)
	}
	return len(jobs), nil
}

func (w *Worker) nextCampaign(ctx context.Context, ws string) (string, Window, bool, error) {
	rows, err := w.Store.Pool().Query(ctx, `
		SELECT c.id, c.schedule
		FROM campaigns c
		WHERE c.workspace_id=$1 AND c.status='running'
		  AND EXISTS (SELECT 1 FROM sends s WHERE s.campaign_id=c.id AND s.status='queued')
		ORDER BY c.created_at
		LIMIT 1`, ws)
	if err != nil {
		return "", Window{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return "", Window{}, false, rows.Err()
	}
	var id string
	var schedule []byte
	if err := rows.Scan(&id, &schedule); err != nil {
		return "", Window{}, false, err
	}
	var s domain.Schedule
	_ = json.Unmarshal(schedule, &s)
	return id, Window{
		Start:    s.WindowStart,
		End:      s.WindowEnd,
		Days:     s.Days,
		Timezone: s.Timezone,
		Throttle: s.ThrottlePerMinute,
	}, true, nil
}

// deliver entrega uma mensagem e grava o resultado. Uma falha do provedor vira
// falha do ENVIO, nunca do worker: a próxima mensagem da fila não pode parar
// porque um número não tem WhatsApp.
func (w *Worker) deliver(ctx context.Context, job store.SendJob) {
	tpl := domain.Template{
		Name:      job.TemplateName,
		Language:  job.Language,
		Variables: job.Variables,
	}
	values := job.TemplateValues()

	req := meta.SendRequest{
		To:           job.Destination,
		TemplateName: job.TemplateName,
		Language:     job.Language,
		Category:     job.Category,
		Params:       tpl.ParamValues(values),
	}

	msgID, err := w.Provider.SendTemplate(ctx, req)
	if err != nil {
		w.Log.Warn("envio falhou", "send", job.SendID, "to", job.Destination, "error", err)
		if markErr := w.Store.MarkFailed(ctx, job.SendID, err.Error()); markErr != nil {
			w.Log.Error("marcar falha", "send", job.SendID, "error", markErr)
		}
		_ = w.Store.LogActivity(ctx, store.DemoWorkspaceID, "send", "Envio falhou",
			job.Destination+" · "+err.Error(), job.CampaignID)
		return
	}

	cost := meta.CostPerMessage(job.Category)
	if err := w.Store.MarkSent(ctx, job.SendID, msgID, cost); err != nil {
		w.Log.Error("marcar enviado", "send", job.SendID, "error", err)
	}
}

// finishIfDrained encerra a campanha quando não sobra nada na fila. Só roda
// quando a fila do workspace está vazia, para não fechar uma campanha que ainda
// tem mensagens de outra.
func (w *Worker) finishIfDrained(ctx context.Context, ws, campaignID string) {
	var pending int
	if err := w.Store.Pool().QueryRow(ctx, `
		SELECT count(*) FROM sends WHERE workspace_id=$1 AND status='queued'`, ws).Scan(&pending); err != nil {
		return
	}
	if pending > 0 {
		return
	}
	var status string
	if err := w.Store.Pool().QueryRow(ctx, `
		SELECT status FROM campaigns WHERE id=$1 AND workspace_id=$2`, campaignID, ws).Scan(&status); err != nil {
		return
	}
	if status != "running" {
		return
	}
	if err := w.Store.SetCampaignStatus(ctx, ws, campaignID, "finished"); err != nil {
		w.Log.Error("encerrar campanha", "campaign", campaignID, "error", err)
		return
	}
	if err := w.Store.LogActivity(ctx, ws, "campaign", "Campanha concluída",
		"Fila drenada; todos os envios foram processados.", campaignID); err != nil {
		w.Log.Error("registrar atividade", "campaign", campaignID, "error", err)
	}
}
