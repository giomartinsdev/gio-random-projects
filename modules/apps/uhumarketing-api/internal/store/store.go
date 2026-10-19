// Package store é a persistência do uhumarketing-api. Diferente do domain-api
// (que só lê o que o worker escreve), este serviço é dono das próprias tabelas:
// o DDL vive em schema.sql, aplicado no boot de forma idempotente.
//
// Métricas nunca são colunas de contador: são agregações de `sends` na hora da
// leitura. Um contador que só sobe não sabe voltar atrás quando o webhook diz
// que a mensagem falhou depois de ter sido marcada como entregue.
package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

//go:embed schema.sql
var schema string

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, schema); err != nil {
		return fmt.Errorf("aplicar schema: %w", err)
	}
	return nil
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) Pool() *pgxpool.Pool { return s.pool }

/* ---------------------------------------------------------------- workspace */

func (s *Store) Workspace(ctx context.Context, id string) (domain.Workspace, error) {
	var w domain.Workspace
	err := s.pool.QueryRow(ctx, `
		SELECT name, segment, site, timezone, plan, whatsapp_number, email_sender,
		       quality, messaging_limit, opt_in_policy, quiet_start, quiet_end
		FROM workspaces WHERE id = $1`, id).
		Scan(&w.Name, &w.Segment, &w.Site, &w.Timezone, &w.Plan, &w.WhatsAppNumber,
			&w.EmailSender, &w.Quality, &w.MessagingLimit, &w.OptInPolicy,
			&w.QuietHours.Start, &w.QuietHours.End)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Workspace{}, domain.ErrNotFound
	}
	return w, err
}

// UpdateWorkspace grava o que a tela de Configurações edita. Quality e limite
// de conversas não entram: quem manda nisso é a Meta, não o operador.
func (s *Store) UpdateWorkspace(ctx context.Context, id string, w domain.Workspace) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE workspaces SET name=$2, segment=$3, site=$4, timezone=$5, plan=$6,
		       whatsapp_number=$7, email_sender=$8, opt_in_policy=$9,
		       quiet_start=$10, quiet_end=$11, updated_at=now()
		WHERE id=$1`,
		id, w.Name, w.Segment, w.Site, w.Timezone, w.Plan, w.WhatsAppNumber,
		w.EmailSender, w.OptInPolicy, w.QuietHours.Start, w.QuietHours.End)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) SetQuality(ctx context.Context, id, quality string) error {
	_, err := s.pool.Exec(ctx, `UPDATE workspaces SET quality=$2, updated_at=now() WHERE id=$1`, id, quality)
	return err
}

/* ---------------------------------------------------------------- templates */

func (s *Store) CreateTemplate(ctx context.Context, ws string, in domain.TemplateInput, status string, externalID string) (domain.Template, error) {
	id := "tpl_" + uuid.NewString()[:8]
	buttons, _ := json.Marshal(in.Buttons)
	vars, _ := json.Marshal(in.Variables)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO templates (id, workspace_id, name, display_name, channel, category, language,
		                       status, header_kind, header_text, header_media, body, footer,
		                       buttons, variables, external_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		id, ws, in.Name, in.DisplayName, in.Channel, in.Category, in.Language,
		status, in.Header.Kind, in.Header.Text, in.Header.MediaHint, in.Body, in.Footer,
		buttons, vars, externalID)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.Template{}, domain.ErrConflict
		}
		return domain.Template{}, err
	}
	return s.Template(ctx, ws, id)
}

func (s *Store) Templates(ctx context.Context, ws string) ([]domain.Template, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, display_name, channel, category, language, status,
		       header_kind, header_text, header_media, body, footer, buttons, variables,
		       external_id, quality, rejection_reason, created_at, updated_at
		FROM templates WHERE workspace_id=$1 ORDER BY created_at DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.Template{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	metrics, err := s.templateMetrics(ctx, ws)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].Metrics = metrics[out[i].Name]
	}
	return out, nil
}

func (s *Store) Template(ctx context.Context, ws, id string) (domain.Template, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, display_name, channel, category, language, status,
		       header_kind, header_text, header_media, body, footer, buttons, variables,
		       external_id, quality, rejection_reason, created_at, updated_at
		FROM templates WHERE workspace_id=$1 AND id=$2`, ws, id)
	t, err := scanTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Template{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Template{}, err
	}
	metrics, err := s.templateMetrics(ctx, ws)
	if err != nil {
		return domain.Template{}, err
	}
	t.Metrics = metrics[t.Name]
	return t, nil
}

// TemplateByName resolve o template de um webhook/seed sem saber o id interno.
func (s *Store) TemplateByName(ctx context.Context, ws, name string) (domain.Template, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM templates WHERE workspace_id=$1 AND name=$2`, ws, name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Template{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Template{}, err
	}
	return s.Template(ctx, ws, id)
}

func scanTemplate(row pgx.Row) (domain.Template, error) {
	var t domain.Template
	var buttons, vars []byte
	err := row.Scan(&t.ID, &t.Name, &t.DisplayName, &t.Channel, &t.Category, &t.Language, &t.Status,
		&t.Header.Kind, &t.Header.Text, &t.Header.MediaHint, &t.Body, &t.Footer, &buttons, &vars,
		&t.MetaID, &t.Quality, &t.RejectionReason, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return domain.Template{}, err
	}
	_ = json.Unmarshal(buttons, &t.Buttons)
	_ = json.Unmarshal(vars, &t.Variables)
	if t.Buttons == nil {
		t.Buttons = []domain.TemplateButton{}
	}
	if t.Variables == nil {
		t.Variables = []domain.TemplateVariable{}
	}
	return t, nil
}

// UpdateTemplateContent sobrescreve o conteúdo e devolve o template para
// rascunho. Manter "aprovado" um corpo que a Meta nunca viu é o tipo de mentira
// que só aparece quando o envio é recusado em produção.
func (s *Store) UpdateTemplateContent(ctx context.Context, ws, id string, in domain.TemplateInput) (domain.Template, error) {
	buttons, _ := json.Marshal(in.Buttons)
	vars, _ := json.Marshal(in.Variables)
	tag, err := s.pool.Exec(ctx, `
		UPDATE templates SET display_name=$3, category=$4, language=$5, header_kind=$6,
		       header_text=$7, header_media=$8, body=$9, footer=$10, buttons=$11, variables=$12,
		       status='draft', updated_at=now()
		WHERE workspace_id=$1 AND id=$2`,
		ws, id, in.DisplayName, in.Category, in.Language, in.Header.Kind, in.Header.Text,
		in.Header.MediaHint, in.Body, in.Footer, buttons, vars)
	if err != nil {
		return domain.Template{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.Template{}, domain.ErrNotFound
	}
	return s.Template(ctx, ws, id)
}

func (s *Store) DeleteTemplate(ctx context.Context, ws, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM templates WHERE workspace_id=$1 AND id=$2`, ws, id)
	if err != nil {
		if isForeignKeyViolation(err) {
			return domain.Invalid("template", "este template já foi usado por uma campanha; pause a campanha em vez de apagar")
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// MarkTemplateSubmitted grava o resultado da submissão (id externo + status).
func (s *Store) MarkTemplateSubmitted(ctx context.Context, ws, id, externalID, status string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE templates SET external_id=$3, status=$4, rejection_reason='', updated_at=now()
		WHERE workspace_id=$1 AND id=$2`, ws, id, externalID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ApplyTemplateStatus é o webhook: devolve o template e `false` quando o id
// externo é desconhecido (webhook de outra WABA — 202 e segue).
func (s *Store) ApplyTemplateStatus(ctx context.Context, externalID, status, reason string) (domain.Template, string, bool, error) {
	var ws, id string
	err := s.pool.QueryRow(ctx, `SELECT workspace_id, id FROM templates WHERE external_id=$1 LIMIT 1`, externalID).
		Scan(&ws, &id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Template{}, "", false, nil
	}
	if err != nil {
		return domain.Template{}, "", false, err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE templates SET status=$2, rejection_reason=$3, updated_at=now() WHERE id=$1`, id, status, reason)
	if err != nil {
		return domain.Template{}, ws, false, err
	}
	t, err := s.Template(ctx, ws, id)
	return t, ws, true, err
}

func (s *Store) templateMetrics(ctx context.Context, ws string) (map[string]domain.TemplateMetrics, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.template_name,
		       count(*) FILTER (WHERE s.status <> 'queued' AND s.status <> 'failed'),
		       count(*) FILTER (WHERE s.status IN ('delivered','read','replied')),
		       count(*) FILTER (WHERE s.status IN ('read','replied')),
		       count(*) FILTER (WHERE s.status = 'replied'),
		       count(*) FILTER (WHERE s.status = 'failed')
		FROM sends s WHERE s.workspace_id=$1 GROUP BY s.template_name`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]domain.TemplateMetrics{}
	for rows.Next() {
		var name string
		var m domain.TemplateMetrics
		if err := rows.Scan(&name, &m.Sent, &m.Delivered, &m.Read, &m.Replied, &m.Failed); err != nil {
			return nil, err
		}
		out[name] = m
	}
	return out, rows.Err()
}

/* ---------------------------------------------------------------- contatos */

func (s *Store) CreateContact(ctx context.Context, ws string, in domain.Contact, optInSource string) (domain.Contact, error) {
	if err := in.Validate(); err != nil {
		return domain.Contact{}, err
	}
	in.ID = "ct_" + uuid.NewString()[:8]
	if in.Source == "" {
		in.Source = "manual"
	}
	if in.OptIn {
		now := time.Now().UTC()
		in.OptInAt = &now
		in.OptInSource = optInSource
	}
	tags, _ := json.Marshal(in.Tags)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Contact{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO contacts (id, workspace_id, name, phone, email, city, uf, tags, source, plan,
		                      opt_in, opt_in_source, opt_in_at, last_purchase_at, total_spent, orders)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		in.ID, ws, in.Name, in.Phone, in.Email, in.City, in.UF, tags, in.Source, in.Plan,
		in.OptIn, in.OptInSource, in.OptInAt, in.LastPurchaseAt, in.TotalSpent, in.Orders)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.Contact{}, domain.ErrConflict
		}
		return domain.Contact{}, err
	}

	// Consentimento é histórico: a linha guarda a prova do que a pessoa aceitou.
	// Sem opt-in, não há linha.
	if in.OptIn {
		if _, err := tx.Exec(ctx, `
			INSERT INTO contact_consents (contact_id, source, policy_text) VALUES ($1,$2,$3)`,
			in.ID, in.OptInSource, "Aceito receber novidades e ofertas do Café Aurora por WhatsApp."); err != nil {
			return domain.Contact{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Contact{}, err
	}
	return in, nil
}

// ContactByPhone acha o contato pelo telefone normalizado. É o caminho do
// webhook: a Meta manda o número, não o nosso id.
func (s *Store) ContactByPhone(ctx context.Context, ws, phone string) (domain.Contact, error) {
	normalized, err := domain.NormalizePhone(phone)
	if err != nil {
		return domain.Contact{}, err
	}
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, phone, email, city, uf, tags, source, plan, opt_in, opt_in_source,
		       opt_in_at, opt_out_at, last_purchase_at, total_spent, orders
		FROM contacts WHERE workspace_id=$1 AND phone=$2`, ws, normalized)
	c, err := scanContact(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Contact{}, domain.ErrNotFound
	}
	return c, err
}

// MarkRepliedByPhone marca como "respondida" a mensagem mais recente daquele
// telefone. É o que fecha o funil quando o cliente responde qualquer coisa.
// WorkspaceByPhone resolve o dono de um número. É o que permite ao webhook,
// que não tem sessão, saber de qual conta é a resposta recebida.
func (s *Store) WorkspaceByPhone(ctx context.Context, phone string) (string, error) {
	normalized, err := domain.NormalizePhone(phone)
	if err != nil {
		return "", err
	}
	var ws string
	err = s.pool.QueryRow(ctx, `SELECT workspace_id FROM contacts WHERE phone=$1 LIMIT 1`, normalized).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return ws, err
}

func (s *Store) MarkRepliedByPhone(ctx context.Context, ws, phone string) error {
	normalized, err := domain.NormalizePhone(phone)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE sends SET status='replied', updated_at=now()
		WHERE id = (
		    SELECT s.id FROM sends s JOIN contacts c ON c.id=s.contact_id
		    WHERE s.workspace_id=$1 AND c.phone=$2 ORDER BY s.created_at DESC LIMIT 1
		)`, ws, normalized)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) Contact(ctx context.Context, ws, id string) (domain.Contact, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, phone, email, city, uf, tags, source, plan, opt_in, opt_in_source,
		       opt_in_at, opt_out_at, last_purchase_at, total_spent, orders
		FROM contacts WHERE workspace_id=$1 AND id=$2`, ws, id)
	c, err := scanContact(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Contact{}, domain.ErrNotFound
	}
	return c, err
}

func scanContact(row pgx.Row) (domain.Contact, error) {
	var c domain.Contact
	var tags []byte
	err := row.Scan(&c.ID, &c.Name, &c.Phone, &c.Email, &c.City, &c.UF, &tags, &c.Source, &c.Plan,
		&c.OptIn, &c.OptInSource, &c.OptInAt, &c.OptOutAt, &c.LastPurchaseAt, &c.TotalSpent, &c.Orders)
	if err != nil {
		return domain.Contact{}, err
	}
	_ = json.Unmarshal(tags, &c.Tags)
	if c.Tags == nil {
		c.Tags = []string{}
	}
	return c, nil
}

// Contacts devolve os contatos do workspace, com filtros opcionais. `all` existe
// para a avaliação de audiência (que casa regras em Go) e para o seed.
func (s *Store) Contacts(ctx context.Context, ws string) ([]domain.Contact, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, phone, email, city, uf, tags, source, plan, opt_in, opt_in_source,
		       opt_in_at, opt_out_at, last_purchase_at, total_spent, orders
		FROM contacts WHERE workspace_id=$1 ORDER BY created_at DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Contact{}
	for rows.Next() {
		c, err := scanContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// OptOut é irreversível por este caminho: revoga o consentimento, carimba a
// data e mantém o histórico. Quem quiser voltar a receber precisa consentir de
// novo.
func (s *Store) OptOut(ctx context.Context, ws, contactID, reason string) error {
	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE contacts SET opt_in=false, opt_out_at=$3, updated_at=now()
		WHERE workspace_id=$1 AND id=$2`, ws, contactID, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if _, err := tx.Exec(ctx, `
		UPDATE contact_consents SET revoked_at=$2 WHERE contact_id=$1 AND revoked_at IS NULL`,
		contactID, now); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if reason != "" {
		_ = s.LogActivity(ctx, ws, "send", "Opt-out registrado", reason, contactID)
	}
	return nil
}

/* ---------------------------------------------------------------- audiências */

func (s *Store) CreateSegment(ctx context.Context, ws string, in domain.SegmentInput) (domain.Segment, error) {
	if err := in.Validate(); err != nil {
		return domain.Segment{}, err
	}
	id := "seg_" + uuid.NewString()[:8]
	rules, _ := json.Marshal(in.Rules)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO segments (id, workspace_id, name, description, kind, rules, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, ws, in.Name, in.Description, in.Kind, rules, in.Source)
	if err != nil {
		return domain.Segment{}, err
	}
	segs, err := s.Segments(ctx, ws)
	if err != nil {
		return domain.Segment{}, err
	}
	for _, seg := range segs {
		if seg.ID == id {
			return seg, nil
		}
	}
	return domain.Segment{}, domain.ErrNotFound
}

func (s *Store) UpdateSegment(ctx context.Context, ws, id string, in domain.SegmentInput) (domain.Segment, error) {
	if err := in.Validate(); err != nil {
		return domain.Segment{}, err
	}
	rules, _ := json.Marshal(in.Rules)
	tag, err := s.pool.Exec(ctx, `
		UPDATE segments SET name=$3, description=$4, kind=$5, rules=$6, source=$7, updated_at=now()
		WHERE workspace_id=$1 AND id=$2`,
		ws, id, in.Name, in.Description, in.Kind, rules, in.Source)
	if err != nil {
		return domain.Segment{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.Segment{}, domain.ErrNotFound
	}
	segs, err := s.Segments(ctx, ws)
	if err != nil {
		return domain.Segment{}, err
	}
	for _, seg := range segs {
		if seg.ID == id {
			return seg, nil
		}
	}
	return domain.Segment{}, domain.ErrNotFound
}

func (s *Store) DeleteSegment(ctx context.Context, ws, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM segments WHERE workspace_id=$1 AND id=$2`, ws, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Segments devolve todas as audiências com contagem e amostra calculadas a
// partir dos contatos reais — não do campo `contactsCount` que a tela mostrava
// no mock. Carrega os contatos uma vez só; a POC tem centenas, não milhões.
func (s *Store) Segments(ctx context.Context, ws string) ([]domain.Segment, error) {
	contacts, err := s.Contacts(ctx, ws)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, kind, combinator, rules, source, updated_at
		FROM segments WHERE workspace_id=$1 ORDER BY created_at DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.Segment{}
	for rows.Next() {
		var seg domain.Segment
		var combinator string
		var rules []byte
		if err := rows.Scan(&seg.ID, &seg.Name, &seg.Description, &seg.Kind, &combinator, &rules, &seg.Source, &seg.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(rules, &seg.Rules)
		if seg.Rules == nil {
			seg.Rules = []domain.SegmentRule{}
		}
		seg.Sample = []domain.Contact{}
		for _, c := range contacts {
			if !domain.MatchContact(c, seg.Rules, combinator) {
				continue
			}
			seg.ContactsCount++
			if len(seg.Sample) < 4 {
				seg.Sample = append(seg.Sample, c)
			}
		}
		out = append(out, seg)
	}
	return out, rows.Err()
}

// SegmentContacts devolve todos os contatos que casam com a audiência.
func (s *Store) SegmentContacts(ctx context.Context, ws, id string) ([]domain.Contact, error) {
	var rulesRaw []byte
	var combinator string
	err := s.pool.QueryRow(ctx, `
		SELECT rules, combinator FROM segments WHERE workspace_id=$1 AND id=$2`, ws, id).
		Scan(&rulesRaw, &combinator)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var rules []domain.SegmentRule
	_ = json.Unmarshal(rulesRaw, &rules)

	contacts, err := s.Contacts(ctx, ws)
	if err != nil {
		return nil, err
	}
	out := []domain.Contact{}
	for _, c := range contacts {
		if domain.MatchContact(c, rules, combinator) {
			out = append(out, c)
		}
	}
	return out, nil
}

/* ---------------------------------------------------------------- campanhas */

func (s *Store) CreateCampaign(ctx context.Context, ws string, in domain.CampaignInput) (domain.Campaign, error) {
	if err := in.Validate(); err != nil {
		return domain.Campaign{}, err
	}
	id := "cmp_" + uuid.NewString()[:8]
	segments, _ := json.Marshal(in.SegmentIDs)
	schedule, _ := json.Marshal(in.Schedule)
	offer, _ := json.Marshal(in.Offer)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO campaigns (id, workspace_id, name, objective, status, channel, template_id,
		                       segment_ids, flow_id, schedule, offer, requires_approval, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, ws, in.Name, in.Objective, in.Status, in.Channel, in.TemplateID, segments,
		in.FlowID, schedule, offer, in.RequiresApproval, in.Notes)
	if err != nil {
		if isForeignKeyViolation(err) {
			return domain.Campaign{}, domain.Invalid("templateId", "template inexistente")
		}
		return domain.Campaign{}, err
	}
	return s.Campaign(ctx, ws, id)
}

func (s *Store) UpdateCampaign(ctx context.Context, ws, id string, in domain.CampaignInput) (domain.Campaign, error) {
	if err := in.Validate(); err != nil {
		return domain.Campaign{}, err
	}
	segments, _ := json.Marshal(in.SegmentIDs)
	schedule, _ := json.Marshal(in.Schedule)
	offer, _ := json.Marshal(in.Offer)
	tag, err := s.pool.Exec(ctx, `
		UPDATE campaigns SET name=$3, objective=$4, status=$5, channel=$6, template_id=$7,
		       segment_ids=$8, flow_id=$9, schedule=$10, offer=$11, requires_approval=$12,
		       notes=$13, updated_at=now()
		WHERE workspace_id=$1 AND id=$2`,
		ws, id, in.Name, in.Objective, in.Status, in.Channel, in.TemplateID, segments,
		in.FlowID, schedule, offer, in.RequiresApproval, in.Notes)
	if err != nil {
		return domain.Campaign{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.Campaign{}, domain.ErrNotFound
	}
	return s.Campaign(ctx, ws, id)
}

func (s *Store) Campaigns(ctx context.Context, ws string) ([]domain.Campaign, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, objective, status, channel, template_id, segment_ids, flow_id,
		       schedule, offer, requires_approval, notes, last_run_at, created_at, updated_at,
		       skipped_count,
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='queued'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status NOT IN ('queued','failed','skipped')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status IN ('delivered','read','replied')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status IN ('read','replied')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='replied'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='failed'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='skipped')
		FROM campaigns WHERE workspace_id=$1 ORDER BY created_at DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sets, err := s.audienceSets(ctx, ws)
	if err != nil {
		return nil, err
	}
	for i := range out {
		applyAudience(&out[i], sets)
	}
	return out, nil
}

func (s *Store) Campaign(ctx context.Context, ws, id string) (domain.Campaign, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, objective, status, channel, template_id, segment_ids, flow_id,
		       schedule, offer, requires_approval, notes, last_run_at, created_at, updated_at,
		       skipped_count,
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='queued'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status NOT IN ('queued','failed','skipped')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status IN ('delivered','read','replied')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status IN ('read','replied')),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='replied'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='failed'),
		       (SELECT count(*) FROM sends s WHERE s.campaign_id=campaigns.id AND s.status='skipped')
		FROM campaigns WHERE workspace_id=$1 AND id=$2`, ws, id)
	c, err := scanCampaign(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Campaign{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Campaign{}, err
	}
	sets, err := s.audienceSets(ctx, ws)
	if err != nil {
		return domain.Campaign{}, err
	}
	applyAudience(&c, sets)
	return c, nil
}

func scanCampaign(row pgx.Row) (domain.Campaign, error) {
	var c domain.Campaign
	var segments, schedule, offer []byte
	var skipped int
	err := row.Scan(&c.ID, &c.Name, &c.Objective, &c.Status, &c.Channel, &c.TemplateID,
		&segments, &c.FlowID, &schedule, &offer, &c.RequiresApproval, &c.Notes,
		&c.LastRunAt, &c.CreatedAt, &c.UpdatedAt, &skipped,
		&c.Metrics.Queued, &c.Metrics.Sent, &c.Metrics.Delivered,
		&c.Metrics.Read, &c.Metrics.Replied, &c.Metrics.Failed, &c.Metrics.OptOut)
	if err != nil {
		return domain.Campaign{}, err
	}
	_ = json.Unmarshal(segments, &c.SegmentIDs)
	_ = json.Unmarshal(schedule, &c.Schedule)
	_ = json.Unmarshal(offer, &c.Offer)
	if c.SegmentIDs == nil {
		c.SegmentIDs = []string{}
	}
	if c.Schedule.Days == nil {
		c.Schedule.Days = []int{1, 2, 3, 4, 5}
	}
	// `skipped_count` são os contatos sem opt-in (ou telefone inválido) da
	// última execução; a tela chama isso de "optOut" no card da campanha.
	c.Metrics.OptOut = skipped
	// Converted e Revenue ficam em zero até existir um sinal REAL de conversão
	// (webhook do checkout). Derivar de "replied / 3" seria inventar receita —
	// e um dashboard que inventa receita é pior do que um zerado.
	return c, nil
}

// audienceSets devolve, por audiência, o conjunto de contatos que casa com as
// regras. Avalia tudo em memória (uma leitura de contatos + uma de segmentos):
// a POC tem centenas de linhas, e uma query por segmento por campanha seria
// N+1 sem ganho.
func (s *Store) audienceSets(ctx context.Context, ws string) (map[string]map[string]bool, error) {
	contacts, err := s.Contacts(ctx, ws)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id, combinator, rules FROM segments WHERE workspace_id=$1`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]map[string]bool{}
	for rows.Next() {
		var id, combinator string
		var rulesRaw []byte
		if err := rows.Scan(&id, &combinator, &rulesRaw); err != nil {
			return nil, err
		}
		var rules []domain.SegmentRule
		_ = json.Unmarshal(rulesRaw, &rules)
		set := map[string]bool{}
		for _, c := range contacts {
			if domain.MatchContact(c, rules, combinator) {
				set[c.ID] = true
			}
		}
		out[id] = set
	}
	return out, rows.Err()
}

// applyAudience preenche Metrics.Audience com o tamanho da UNIÃO das audiências
// da campanha. Somar os tamanhos contaria duas vezes quem está em duas
// audiências — e o número no card precisa bater com o que a fila vai gerar.
func applyAudience(c *domain.Campaign, sets map[string]map[string]bool) {
	union := map[string]bool{}
	for _, id := range c.SegmentIDs {
		for contactID := range sets[id] {
			union[contactID] = true
		}
	}
	c.Metrics.Audience = len(union)
}

func (s *Store) SetCampaignStatus(ctx context.Context, ws, id, status string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE campaigns SET status=$3, updated_at=now() WHERE workspace_id=$1 AND id=$2`, ws, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) TouchCampaignRun(ctx context.Context, ws, id string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE campaigns SET last_run_at=now(), updated_at=now() WHERE workspace_id=$1 AND id=$2`, ws, id)
	return err
}

func (s *Store) AddSkipped(ctx context.Context, ws, id string, n int) error {
	if n <= 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE campaigns SET skipped_count=skipped_count+$3, updated_at=now()
		WHERE workspace_id=$1 AND id=$2`, ws, id, n)
	return err
}

/* ------------------------------------------------------------------- envios */

// EnqueueSends grava os envios numa transação. O UNIQUE (campaign_id,
// contact_id) faz a idempotência: ON CONFLICT DO NOTHING devolve quantas linhas
// entraram de fato, e é isso que a resposta informa. Disparar duas vezes não
// duplica nada.
func (s *Store) EnqueueSends(ctx context.Context, ws, campaignID, templateName, couponPattern string, contacts []domain.Contact) (int, error) {
	if len(contacts) == 0 {
		return 0, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	inserted := 0
	for _, c := range contacts {
		coupon := renderCoupon(couponPattern, c.Name)
		tag, err := tx.Exec(ctx, `
			INSERT INTO sends (id, workspace_id, campaign_id, contact_id, destination, template_name, status, coupon_code)
			VALUES ($1,$2,$3,$4,$5,$6,'queued',$7)
			ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
			"snd_"+uuid.NewString()[:10], ws, campaignID, c.ID, c.Phone, templateName, coupon)
		if err != nil {
			return 0, err
		}
		inserted += int(tag.RowsAffected())
	}
	return inserted, tx.Commit(ctx)
}

// renderCoupon resolve "VOLTA-{nome}" para "VOLTA-ANA".
func renderCoupon(pattern, name string) string {
	if pattern == "" {
		return ""
	}
	first := name
	if i := strings.IndexByte(name, ' '); i > 0 {
		first = name[:i]
	}
	return strings.ReplaceAll(pattern, "{nome}", strings.ToUpper(first))
}

// ClaimQueued reserva um lote da fila com SKIP LOCKED: dois workers (ou duas
// instâncias) rodando ao mesmo tempo não mandam a mesma mensagem duas vezes.
func (s *Store) ClaimQueued(ctx context.Context, ws string, limit int) ([]SendJob, error) {
	if limit <= 0 {
		limit = 25
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT s.workspace_id, s.id, s.campaign_id, s.contact_id, s.destination, s.coupon_code,
		       t.id, t.name, t.language, t.category, t.header_kind, t.header_media, t.variables,
		       c.name, c.city, c.uf, c.tags, c.orders, c.total_spent
		FROM sends s
		JOIN campaigns camp ON camp.id = s.campaign_id
		JOIN templates t ON t.id = camp.template_id
		JOIN contacts c ON c.id = s.contact_id
		WHERE s.workspace_id=$1 AND s.status='queued'
		ORDER BY s.created_at
		LIMIT $2
		FOR UPDATE OF s SKIP LOCKED`, ws, limit)
	if err != nil {
		return nil, err
	}

	jobs := []SendJob{}
	for rows.Next() {
		var j SendJob
		var vars, tags []byte
		if err := rows.Scan(&j.WorkspaceID, &j.SendID, &j.CampaignID, &j.ContactID, &j.Destination, &j.CouponCode,
			&j.TemplateID, &j.TemplateName, &j.Language, &j.Category, &j.HeaderKind, &j.HeaderMedia, &vars,
			&j.ContactName, &j.City, &j.UF, &tags, &j.Orders, &j.TotalSpent); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(vars, &j.Variables)
		_ = json.Unmarshal(tags, &j.Tags)
		jobs = append(jobs, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Marca as linhas como reservadas dentro da mesma transação para que outro
	// worker não as pegue entre o SELECT e o envio.
	for _, j := range jobs {
		if _, err := tx.Exec(ctx, `
			UPDATE sends SET attempts=attempts+1, updated_at=now() WHERE id=$1`, j.SendID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

// SendJob é o que o worker precisa para entregar uma mensagem, já com template
// e contato resolvidos (uma query, sem N+1).
type SendJob struct {
	WorkspaceID  string
	SendID       string
	CampaignID   string
	ContactID    string
	ContactName  string
	City         string
	UF           string
	Destination  string
	CouponCode   string
	TemplateID   string
	TemplateName string
	Language     string
	Category     string
	HeaderKind   string
	HeaderMedia  string
	Variables    []domain.TemplateVariable
	Tags         []string
	Orders       int
	TotalSpent   float64
}

// TemplateValues monta o mapa de variáveis do destinatário. O nó de template
// do fluxo mapeia cada índice para um campo ("1" → "primeiro_nome"); aqui esse
// campo é resolvido com o dado do contato.
func (j SendJob) TemplateValues() map[string]string {
	first := j.ContactName
	if i := strings.IndexByte(first, ' '); i > 0 {
		first = first[:i]
	}
	values := map[string]string{
		"primeiro_nome": first,
		"nome":          j.ContactName,
		"cidade":        j.City,
		"uf":            j.UF,
		"cupom":         j.CouponCode,
		"pedidos":       strconv.Itoa(j.Orders),
	}
	for _, v := range j.Variables {
		// Sem mapeamento explícito, tenta o rótulo em snake_case e cai no exemplo.
		if val, ok := values[snake(v.Label)]; ok {
			values[v.Index] = val
			continue
		}
		values[v.Index] = v.Example
	}
	return values
}

// snake transforma "Primeiro nome" em "primeiro_nome".
func snake(label string) string {
	var b strings.Builder
	pendingUnderscore := false
	for _, r := range label {
		switch {
		case r >= 'A' && r <= 'Z':
			if pendingUnderscore && b.Len() > 0 {
				b.WriteByte('_')
			}
			pendingUnderscore = false
			b.WriteRune(r + 32)
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			if pendingUnderscore && b.Len() > 0 {
				b.WriteByte('_')
			}
			pendingUnderscore = false
			b.WriteRune(r)
		default:
			pendingUnderscore = true
		}
	}
	return b.String()
}

func (s *Store) MarkSent(ctx context.Context, sendID, externalID string, cost float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sends SET status='sent', external_id=$2, cost=$3, error='', updated_at=now()
		WHERE id=$1`, sendID, externalID, cost)
	return err
}

func (s *Store) MarkFailed(ctx context.Context, sendID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sends SET status='failed', error=$2, updated_at=now() WHERE id=$1`, sendID, reason)
	return err
}

// ApplyMessageStatus é o webhook de mensagem. Devolve a campanha e o id do
// contato para o handler registrar atividade; `false` quando o id externo é
// desconhecido (reentrega ou webhook de outro serviço).
//
// `ws` vazio significa "webhook da Meta": o id externo é único e não há sessão
// para escopar. Fora desse caso o handler passa o workspace da sessão, para um
// cliente não conseguir mexer no envio de outra conta pelo id interno.
func (s *Store) ApplyMessageStatus(ctx context.Context, ws, externalID, status, reason string) (owner, campaignID, contactID, sendID string, ok bool, err error) {
	var current string
	// Aceita o wamid da Meta ou o id interno do envio: a tela de Envios mostra
	// o id interno, e o endpoint de desenvolvimento precisa conseguir simular
	// status a partir dele sem expor o id externo.
	//
	// Sem workspace aqui de propósito: o webhook da Meta não carrega sessão, e
	// o id externo é único no banco. Quem chama assume a responsabilidade de
	// escopar quando a origem é o cliente (o handler de dev faz isso).
	err = s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, contact_id, status, workspace_id FROM sends
		WHERE (external_id=$1 OR id=$1) AND ($2='' OR workspace_id=$2) LIMIT 1`, externalID, ws).
		Scan(&sendID, &campaignID, &contactID, &current, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", "", false, nil
	}
	if err != nil {
		return "", "", "", "", false, err
	}

	// Fora de ordem: "lido" depois de "entregue" não regride. A resposta diz
	// applied=false para a tela poder explicar por que nada mudou.
	if !domain.Advances(current, status) {
		return owner, campaignID, contactID, sendID, false, nil
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE sends SET status=$2,
		       error = CASE WHEN $3 <> '' THEN $3 ELSE error END,
		       updated_at=now()
		WHERE id=$1`, sendID, status, reason)
	if err != nil {
		return owner, campaignID, contactID, sendID, false, err
	}
	return owner, campaignID, contactID, sendID, true, nil
}

func (s *Store) Sends(ctx context.Context, ws, campaignID string, limit int) ([]domain.Send, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.campaign_id, c.name, s.destination, s.template_name, s.status,
		       s.created_at, s.coupon_code, s.error, s.cost
		FROM sends s JOIN contacts c ON c.id = s.contact_id
		WHERE s.workspace_id=$1 AND ($2='' OR s.campaign_id=$2)
		ORDER BY s.created_at DESC LIMIT $3`, ws, campaignID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Send{}
	for rows.Next() {
		var s domain.Send
		if err := rows.Scan(&s.ID, &s.CampaignID, &s.ContactName, &s.Destination, &s.TemplateName,
			&s.Status, &s.At, &s.CouponCode, &s.Error, &s.Cost); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

/* -------------------------------------------------------------------- fluxo */

func (s *Store) CreateFlow(ctx context.Context, ws string, in domain.FlowInput) (domain.Flow, error) {
	if err := in.Validate(); err != nil {
		return domain.Flow{}, err
	}
	id := "flow_" + uuid.NewString()[:8]
	nodes, _ := json.Marshal(in.Nodes)
	edges, _ := json.Marshal(in.Edges)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO flows (id, workspace_id, name, description, status, nodes, edges, campaign_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, ws, in.Name, in.Description, in.Status, nodes, edges, in.CampaignID)
	if err != nil {
		return domain.Flow{}, err
	}
	return s.Flow(ctx, ws, id)
}

func (s *Store) UpdateFlow(ctx context.Context, ws, id string, in domain.FlowInput) (domain.Flow, error) {
	if err := in.Validate(); err != nil {
		return domain.Flow{}, err
	}
	nodes, _ := json.Marshal(in.Nodes)
	edges, _ := json.Marshal(in.Edges)
	tag, err := s.pool.Exec(ctx, `
		UPDATE flows SET name=$3, description=$4, status=$5, nodes=$6, edges=$7,
		       campaign_id=$8, updated_at=now()
		WHERE workspace_id=$1 AND id=$2`,
		ws, id, in.Name, in.Description, in.Status, nodes, edges, in.CampaignID)
	if err != nil {
		return domain.Flow{}, err
	}
	if tag.RowsAffected() == 0 {
		return domain.Flow{}, domain.ErrNotFound
	}
	return s.Flow(ctx, ws, id)
}

func (s *Store) DeleteFlow(ctx context.Context, ws, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM flows WHERE workspace_id=$1 AND id=$2`, ws, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (s *Store) Flows(ctx context.Context, ws string) ([]domain.Flow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, name, description, status, nodes, edges, campaign_id,
		       runs_total, runs_success, runs_failed, last_run_at, created_at, updated_at
		FROM flows WHERE workspace_id=$1 ORDER BY created_at DESC`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Flow{}
	for rows.Next() {
		f, err := scanFlow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) Flow(ctx context.Context, ws, id string) (domain.Flow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, name, description, status, nodes, edges, campaign_id,
		       runs_total, runs_success, runs_failed, last_run_at, created_at, updated_at
		FROM flows WHERE workspace_id=$1 AND id=$2`, ws, id)
	f, err := scanFlow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Flow{}, domain.ErrNotFound
	}
	return f, err
}

func scanFlow(row pgx.Row) (domain.Flow, error) {
	var f domain.Flow
	var nodes, edges []byte
	err := row.Scan(&f.ID, &f.Name, &f.Description, &f.Status, &nodes, &edges, &f.CampaignID,
		&f.Runs.Total, &f.Runs.Success, &f.Runs.Failed, &f.LastRunAt, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return domain.Flow{}, err
	}
	_ = json.Unmarshal(nodes, &f.Nodes)
	_ = json.Unmarshal(edges, &f.Edges)
	if f.Nodes == nil {
		f.Nodes = []domain.FlowNode{}
	}
	if f.Edges == nil {
		f.Edges = []domain.FlowEdge{}
	}
	return f, nil
}

// RecordFlowRun soma uma execução ao contador do fluxo.
func (s *Store) RecordFlowRun(ctx context.Context, ws, id string, success bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE flows SET runs_total=runs_total+1,
		       runs_success=runs_success + CASE WHEN $3 THEN 1 ELSE 0 END,
		       runs_failed=runs_failed + CASE WHEN $3 THEN 0 ELSE 1 END,
		       last_run_at=now(), updated_at=now()
		WHERE workspace_id=$1 AND id=$2`, ws, id, success)
	return err
}

/* ---------------------------------------------------------------- atividade */

func (s *Store) LogActivity(ctx context.Context, ws, kind, title, detail, refID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO activity (id, workspace_id, kind, title, detail, ref_id)
		VALUES ($1,$2,$3,$4,$5,$6)`, "act_"+uuid.NewString()[:8], ws, kind, title, detail, refID)
	return err
}

func (s *Store) Activity(ctx context.Context, ws string, limit int) ([]domain.ActivityEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, created_at, kind, title, detail, ref_id FROM activity
		WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2`, ws, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ActivityEvent{}
	for rows.Next() {
		var a domain.ActivityEvent
		if err := rows.Scan(&a.ID, &a.At, &a.Kind, &a.Title, &a.Detail, &a.RefID); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

/* ------------------------------------------------------- webhook idempotência */

// FirstDelivery devolve true na primeira vez que a chave é vista. A Meta
// reentrega webhooks quando a resposta demora; sem isso, uma entrega contaria
// duas vezes nos relatórios.
func (s *Store) FirstDelivery(ctx context.Context, key string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO webhook_events (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, key)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

/* ------------------------------------------------------------------ helpers */

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

/* ------------------------------------------------------------------- série */

// DailySeries agrega envios por dia e por status. Feito em SQL porque a série
// cobre TODOS os envios do workspace, não a página de 120 que a tela carrega:
// somar a página faria o gráfico divergir do KPI no primeiro dia movimentado.
//
// O status guardado é o mais avançado, então um envio "read" conta também em
// sent/delivered. É o funil, não contadores por etapa.
func (s *Store) DailySeries(ctx context.Context, ws string, days int) ([]domain.MetricPoint, error) {
	if days <= 0 || days > 180 {
		days = 30
	}
	rows, err := s.pool.Query(ctx, `
		WITH dias AS (
			SELECT generate_series(
				(current_date - ($2 * interval '1 day'))::date + 1,
				current_date,
				interval '1 day'
			)::date AS dia
		)
		SELECT d.dia,
		       count(*) FILTER (WHERE s.status <> 'queued')                          AS sent,
		       count(*) FILTER (WHERE s.status IN ('delivered','read','replied'))     AS delivered,
		       count(*) FILTER (WHERE s.status IN ('read','replied'))                 AS read,
		       count(*) FILTER (WHERE s.status = 'replied')                           AS replied
		FROM dias d
		LEFT JOIN sends s
		       ON s.workspace_id = $1
		      AND s.created_at::date = d.dia
		GROUP BY d.dia
		ORDER BY d.dia`, ws, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.MetricPoint{}
	for rows.Next() {
		var p domain.MetricPoint
		var day time.Time
		if err := rows.Scan(&day, &p.Sent, &p.Delivered, &p.Read, &p.Replied); err != nil {
			return nil, err
		}
		p.Date = day.Format("2006-01-02")
		out = append(out, p)
	}
	return out, rows.Err()
}
