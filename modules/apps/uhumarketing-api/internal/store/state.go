package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// EditorialState é o documento que a SPA manda em PUT /state: tudo que o
// operador edita (workspace, templates, audiências, campanhas e fluxos).
//
// Fica separado do que o SERVIDOR é dono — status de template, fila de envio,
// métricas, contadores de execução — porque essas coisas não podem ser
// sobrescritas pelo último navegador que salvou. Misturar as duas camadas num
// único JSON faria a tela "desfazer" uma entrega de webhook.
type EditorialState struct {
	Workspace *domain.Workspace `json:"workspace"`
	Templates []domain.Template `json:"templates"`
	Segments  []domain.Segment  `json:"segments"`
	Campaigns []domain.Campaign `json:"campaigns"`
	Flows     []domain.Flow     `json:"flows"`
}

// ReplaceState grava o documento editorial numa transação. Regras de merge:
//
//   - template cujo CONTEÚDO mudou volta para rascunho (a aprovação antiga não
//     vale para um corpo novo) e mantém o id externo para auditoria;
//   - template cujo conteúdo não mudou mantém status, id externo e qualidade —
//     senão um salvamento de outra tela apagaria a aprovação da Meta;
//   - campanha mantém métricas, última execução e contagem de ignorados, que
//     são derivados de sends;
//   - fluxo mantém os contadores de execução;
//   - linhas ausentes do documento são removidas, exceto template em uso por
//     campanha (o banco recusa e a resposta diz por quê).
func (s *Store) ReplaceState(ctx context.Context, ws string, doc EditorialState) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if doc.Workspace != nil {
		w := *doc.Workspace
		if _, err := tx.Exec(ctx, `
			UPDATE workspaces SET name=$2, segment=$3, site=$4, timezone=$5, plan=$6,
			       whatsapp_number=$7, email_sender=$8, opt_in_policy=$9,
			       quiet_start=$10, quiet_end=$11, updated_at=now()
			WHERE id=$1`,
			ws, w.Name, w.Segment, w.Site, w.Timezone, w.Plan, w.WhatsAppNumber,
			w.EmailSender, w.OptInPolicy, w.QuietHours.Start, w.QuietHours.End); err != nil {
			return err
		}
	}

	if err := s.replaceTemplates(ctx, tx, ws, doc.Templates); err != nil {
		return err
	}
	if err := s.replaceSegments(ctx, tx, ws, doc.Segments); err != nil {
		return err
	}
	if err := s.replaceCampaigns(ctx, tx, ws, doc.Campaigns); err != nil {
		return err
	}
	if err := s.replaceFlows(ctx, tx, ws, doc.Flows); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type templateRow struct {
	status     string
	externalID string
	quality    int
	hash       string
}

func (s *Store) replaceTemplates(ctx context.Context, tx pgx.Tx, ws string, items []domain.Template) error {
	// O hash é calculado em Go, com a MESMA função usada para o documento que
	// chegou. Fazer isso em SQL exigiria pgcrypto e uma segunda implementação
	// da serialização — duas fontes de verdade para "o conteúdo mudou?".
	existing := map[string]templateRow{}
	rows, err := tx.Query(ctx, `
		SELECT id, status, external_id, quality, name, display_name, category, language,
		       header_kind, header_text, header_media, body, footer, buttons, variables
		FROM templates WHERE workspace_id=$1`, ws)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var r templateRow
		var in domain.TemplateInput
		var buttons, vars []byte
		if err := rows.Scan(&id, &r.status, &r.externalID, &r.quality,
			&in.Name, &in.DisplayName, &in.Category, &in.Language,
			&in.Header.Kind, &in.Header.Text, &in.Header.MediaHint, &in.Body, &in.Footer,
			&buttons, &vars); err != nil {
			rows.Close()
			return err
		}
		_ = json.Unmarshal(buttons, &in.Buttons)
		_ = json.Unmarshal(vars, &in.Variables)
		r.hash = contentHash(in)
		existing[id] = r
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	keep := map[string]bool{}
	for _, t := range items {
		in := domain.TemplateInput{
			Name: t.Name, DisplayName: t.DisplayName, Channel: t.Channel, Category: t.Category,
			Language: t.Language, Header: t.Header, Body: t.Body, Footer: t.Footer,
			Buttons: t.Buttons, Variables: t.Variables,
		}
		if err := in.Validate(); err != nil {
			return err
		}
		if t.ID == "" {
			return domain.Invalid("templates", "template sem id")
		}
		keep[t.ID] = true

		buttons, _ := json.Marshal(in.Buttons)
		vars, _ := json.Marshal(in.Variables)
		hash := contentHash(in)

		prev, found := existing[t.ID]
		status, externalID, quality := "draft", "", 0
		if found {
			status, externalID, quality = prev.status, prev.externalID, prev.quality
			if prev.hash != hash {
				// Conteúdo mudou: a aprovação anterior não cobre este corpo.
				status = "draft"
			}
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO templates (id, workspace_id, name, display_name, channel, category, language,
			                       status, header_kind, header_text, header_media, body, footer,
			                       buttons, variables, external_id, quality)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
			ON CONFLICT (id) DO UPDATE SET
			       name=EXCLUDED.name, display_name=EXCLUDED.display_name, channel=EXCLUDED.channel,
			       category=EXCLUDED.category, language=EXCLUDED.language, status=EXCLUDED.status,
			       header_kind=EXCLUDED.header_kind, header_text=EXCLUDED.header_text,
			       header_media=EXCLUDED.header_media, body=EXCLUDED.body, footer=EXCLUDED.footer,
			       buttons=EXCLUDED.buttons, variables=EXCLUDED.variables, updated_at=now()`,
			t.ID, ws, in.Name, in.DisplayName, in.Channel, in.Category, in.Language,
			status, in.Header.Kind, in.Header.Text, in.Header.MediaHint, in.Body, in.Footer,
			buttons, vars, externalID, quality); err != nil {
			if isUniqueViolation(err) {
				return domain.Invalid("templates", "já existe um template com o nome "+in.Name)
			}
			return err
		}
	}

	// Remoções: só o que não está em uso. O banco recusa por FK; traduzimos para
	// uma mensagem que o operador entende em vez de vazar erro de constraint.
	rows, err = tx.Query(ctx, `SELECT id FROM templates WHERE workspace_id=$1`, ws)
	if err != nil {
		return err
	}
	stale := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if !keep[id] {
			stale = append(stale, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range stale {
		if _, err := tx.Exec(ctx, `DELETE FROM templates WHERE workspace_id=$1 AND id=$2`, ws, id); err != nil {
			if isForeignKeyViolation(err) {
				return domain.Invalid("templates", "um template em uso por campanha não pode ser apagado; pause a campanha antes")
			}
			return err
		}
	}
	return nil
}

func (s *Store) replaceSegments(ctx context.Context, tx pgx.Tx, ws string, items []domain.Segment) error {
	keep := map[string]bool{}
	for _, seg := range items {
		in := domain.SegmentInput{
			Name: seg.Name, Description: seg.Description, Kind: seg.Kind,
			Rules: seg.Rules, Source: seg.Source,
		}
		if err := in.Validate(); err != nil {
			return err
		}
		if seg.ID == "" {
			return domain.Invalid("segments", "audiência sem id")
		}
		keep[seg.ID] = true
		rules, _ := json.Marshal(in.Rules)
		if _, err := tx.Exec(ctx, `
			INSERT INTO segments (id, workspace_id, name, description, kind, rules, source)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (id) DO UPDATE SET
			       name=EXCLUDED.name, description=EXCLUDED.description, kind=EXCLUDED.kind,
			       rules=EXCLUDED.rules, source=EXCLUDED.source, updated_at=now()`,
			seg.ID, ws, in.Name, in.Description, in.Kind, rules, in.Source); err != nil {
			return err
		}
	}
	return deleteMissing(ctx, tx, `segments`, ws, keep)
}

func (s *Store) replaceCampaigns(ctx context.Context, tx pgx.Tx, ws string, items []domain.Campaign) error {
	keep := map[string]bool{}
	for _, c := range items {
		in := domain.CampaignInput{
			Name: c.Name, Objective: c.Objective, Status: c.Status, Channel: c.Channel,
			TemplateID: c.TemplateID, SegmentIDs: c.SegmentIDs, FlowID: c.FlowID,
			Schedule: c.Schedule, Offer: c.Offer, RequiresApproval: c.RequiresApproval, Notes: c.Notes,
		}
		if err := in.Validate(); err != nil {
			return err
		}
		if c.ID == "" {
			return domain.Invalid("campaigns", "campanha sem id")
		}
		keep[c.ID] = true
		segments, _ := json.Marshal(in.SegmentIDs)
		schedule, _ := json.Marshal(in.Schedule)
		offer, _ := json.Marshal(in.Offer)
		if _, err := tx.Exec(ctx, `
			INSERT INTO campaigns (id, workspace_id, name, objective, status, channel, template_id,
			                       segment_ids, flow_id, schedule, offer, requires_approval, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			ON CONFLICT (id) DO UPDATE SET
			       name=EXCLUDED.name, objective=EXCLUDED.objective, status=EXCLUDED.status,
			       channel=EXCLUDED.channel, template_id=EXCLUDED.template_id,
			       segment_ids=EXCLUDED.segment_ids, flow_id=EXCLUDED.flow_id,
			       schedule=EXCLUDED.schedule, offer=EXCLUDED.offer,
			       requires_approval=EXCLUDED.requires_approval, notes=EXCLUDED.notes,
			       updated_at=now()`,
			c.ID, ws, in.Name, in.Objective, in.Status, in.Channel, in.TemplateID, segments,
			in.FlowID, schedule, offer, in.RequiresApproval, in.Notes); err != nil {
			if isForeignKeyViolation(err) {
				return domain.Invalid("campaigns", "campanha aponta para um template inexistente")
			}
			return err
		}
	}
	return deleteMissing(ctx, tx, `campaigns`, ws, keep)
}

func (s *Store) replaceFlows(ctx context.Context, tx pgx.Tx, ws string, items []domain.Flow) error {
	keep := map[string]bool{}
	for _, f := range items {
		in := domain.FlowInput{
			Name: f.Name, Description: f.Description, Status: f.Status,
			Nodes: f.Nodes, Edges: f.Edges, CampaignID: f.CampaignID,
		}
		if err := in.Validate(); err != nil {
			return err
		}
		if f.ID == "" {
			return domain.Invalid("flows", "fluxo sem id")
		}
		keep[f.ID] = true
		nodes, _ := json.Marshal(in.Nodes)
		edges, _ := json.Marshal(in.Edges)
		if _, err := tx.Exec(ctx, `
			INSERT INTO flows (id, workspace_id, name, description, status, nodes, edges, campaign_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (id) DO UPDATE SET
			       name=EXCLUDED.name, description=EXCLUDED.description, status=EXCLUDED.status,
			       nodes=EXCLUDED.nodes, edges=EXCLUDED.edges, campaign_id=EXCLUDED.campaign_id,
			       updated_at=now()`,
			f.ID, ws, in.Name, in.Description, in.Status, nodes, edges, in.CampaignID); err != nil {
			return err
		}
	}
	return deleteMissing(ctx, tx, `flows`, ws, keep)
}

func deleteMissing(ctx context.Context, tx pgx.Tx, table, ws string, keep map[string]bool) error {
	rows, err := tx.Query(ctx, `SELECT id FROM `+table+` WHERE workspace_id=$1`, ws)
	if err != nil {
		return err
	}
	stale := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if !keep[id] {
			stale = append(stale, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range stale {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE workspace_id=$1 AND id=$2`, ws, id); err != nil {
			// Campanha com envios não pode sumir: o histórico é a prova do que
			// foi mandado para quem. Traduzimos a FK em vez de vazar o erro.
			if isForeignKeyViolation(err) {
				return domain.Invalid(table, "há histórico de envios ligado a este item; pause em vez de apagar")
			}
			return fmt.Errorf("remover %s %s: %w", table, id, err)
		}
	}
	return nil
}

func contentHash(in domain.TemplateInput) string {
	buttons, _ := json.Marshal(in.Buttons)
	vars, _ := json.Marshal(in.Variables)
	raw := fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s",
		in.Name, in.DisplayName, in.Category, in.Language,
		in.Header.Kind, in.Header.Text, in.Header.MediaHint, in.Body, in.Footer,
		string(buttons), string(vars))
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
