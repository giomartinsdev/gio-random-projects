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
//
// O worker é GLOBAL: ele não pertence a um workspace. Cada conta tem a própria
// janela de envio e a própria fila, então o tick percorre as contas com
// campanha em execução e aplica a janela de cada uma. Um worker preso a um
// workspace fixo deixaria a conta nova sem entrega.
func (w *Worker) Tick(ctx context.Context) (int, error) {
	workspaces, err := w.activeWorkspaces(ctx)
	if err != nil {
		return 0, err
	}

	total := 0
	for _, ws := range workspaces {
		_, window, ok, err := w.nextCampaign(ctx, ws)
		if err != nil {
			return total, err
		}
		if !ok {
			// Sem campanha com fila: é exatamente aqui que uma campanha acaba
			// de drenar. Sem esta chamada, ela ficava "em execução" para
			// sempre — nada errado aparecia na tela, só um status que nunca
			// fechava.
			w.finishDrained(ctx, ws)
			continue
		}
		if !window.Open(time.Now()) {
			continue
		}

		batch := window.BatchSize(w.Interval)
		jobs, err := w.Store.ClaimQueued(ctx, ws, batch)
		if err != nil {
			return total, err
		}
		if len(jobs) == 0 {
			// Nada na fila desta campanha: pode ter drenado agora.
			w.finishDrained(ctx, ws)
			continue
		}

		for _, job := range jobs {
			w.deliver(ctx, job)
		}
		total += len(jobs)
	}
	return total, nil
}

// activeWorkspaces lista as contas com campanha em execução — inclusive as que
// já esvaziaram a fila e só faltam ser encerradas.
func (w *Worker) activeWorkspaces(ctx context.Context) ([]string, error) {
	rows, err := w.Store.Pool().Query(ctx,
		`SELECT DISTINCT workspace_id FROM campaigns WHERE status='running'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var ws string
		if err := rows.Scan(&ws); err != nil {
			return nil, err
		}
		out = append(out, ws)
	}
	return out, rows.Err()
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
		_ = w.Store.LogActivity(ctx, job.WorkspaceID, "send", "Envio falhou",
			job.Destination+" · "+err.Error(), job.CampaignID)
		return
	}

	cost := meta.CostPerMessage(job.Category)
	if err := w.Store.MarkSent(ctx, job.SendID, msgID, cost); err != nil {
		w.Log.Error("marcar enviado", "send", job.SendID, "error", err)
	}
}

// finishDrained encerra toda campanha em execução cuja fila acabou.
//
// Não recebe um id porque o caso que importava (a fila esvaziou) é justamente
// quando `nextCampaign` não devolve nenhuma campanha. Fechar só a "última
// escolhida" deixaria órfã qualquer campanha que drenou num tick anterior. Uma
// campanha em execução sem nenhum envio na fila está concluída por definição.
func (w *Worker) finishDrained(ctx context.Context, ws string) {
	rows, err := w.Store.Pool().Query(ctx, `
		SELECT c.id
		FROM campaigns c
		WHERE c.workspace_id=$1 AND c.status='running'
		  AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.campaign_id=c.id AND s.status='queued')`, ws)
	if err != nil {
		w.Log.Error("encerrar campanhas: consulta", "error", err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			w.Log.Error("encerrar campanhas: leitura", "error", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		w.Log.Error("encerrar campanhas: linhas", "error", rows.Err())
		return
	}
	for _, id := range ids {
		if err := w.Store.SetCampaignStatus(ctx, ws, id, "finished"); err != nil {
			w.Log.Error("encerrar campanha", "campaign", id, "error", err)
			continue
		}
		if err := w.Store.LogActivity(ctx, ws, "campaign", "Campanha concluída",
			"Fila drenada; todos os envios foram processados.", id); err != nil {
			w.Log.Error("registrar atividade", "campaign", id, "error", err)
		}
	}
}
