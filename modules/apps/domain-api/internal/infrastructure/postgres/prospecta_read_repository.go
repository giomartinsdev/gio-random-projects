package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

// ProspectaReadRepository implements domain/prospecta.ReadRepository against
// Postgres. Read-only: as tabelas prospecta_* são escritas só pelo
// domain-worker. Multi-tenant com RLS — a sessão fixa app.current_tenant na
// transação, como o repositório do worker.
type ProspectaReadRepository struct {
	pool *pgxpool.Pool
}

func NewProspectaReadRepository(pool *pgxpool.Pool) *ProspectaReadRepository {
	return &ProspectaReadRepository{pool: pool}
}

func (r *ProspectaReadRepository) withTenant(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin prospecta read tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.current_tenant', $1, true)`, tenantID); err != nil {
		return fmt.Errorf("set prospecta read tenant: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ProspectaReadRepository) GetCompany(ctx context.Context, tenantID, id string) (domainprospecta.CompanyView, error) {
	var v domainprospecta.CompanyView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var created time.Time
		// O WHERE filtra o tenant além do RLS (defesa em profundidade: a role
		// pode ser owner/BYPASSRLS).
		err := tx.QueryRow(ctx, `
			SELECT id::text, tenant_id::text, name, site, description, created_at
			  FROM prospecta_company WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.TenantID, &v.Name, &v.Site, &v.Description, &created)
		if err != nil {
			return err
		}
		v.CreatedAt = created.UTC().Format(time.RFC3339)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.CompanyView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.CompanyView{}, err
	}
	// O ICP é opcional: uma empresa recém-cadastrada ainda não o definiu.
	icp, err := r.ICPByCompany(ctx, tenantID, id)
	if err == nil {
		v.ICP = &icp
	} else if !errors.Is(err, domainprospecta.ErrNotFound) {
		return domainprospecta.CompanyView{}, err
	}
	return v, nil
}

func (r *ProspectaReadRepository) ICPByCompany(ctx context.Context, tenantID, companyID string) (domainprospecta.ICPView, error) {
	var v domainprospecta.ICPView
	var created time.Time
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT id::text, company_id::text, definition, signals, created_at
			  FROM prospecta_icp WHERE company_id = $1 AND tenant_id = $2
			  ORDER BY created_at DESC LIMIT 1`, companyID, tenantID).
			Scan(&v.ID, &v.CompanyID, &v.Definition, &v.Signals, &created)
		if err != nil {
			return err
		}
		v.CreatedAt = created.UTC().Format(time.RFC3339)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.ICPView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.ICPView{}, err
	}
	if v.Signals == nil {
		v.Signals = []string{}
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// User (leitura cross-tenant do login)
// ---------------------------------------------------------------------------

// GetUserByEmail busca a conta pelo e-mail SEM fixar tenant: é a única leitura
// cross-tenant do Prospecta, de propósito (o e-mail é único global e é a
// identidade do login). Como prospecta_user tem RLS por tenant_id, e a sessão
// não fixa um tenant aqui, a query roda com bypass — a role do par de domínio é
// a dona das tabelas. Documentado no schema.sql. Devolve o password_hash para o
// login verificar o bcrypt (rede interna).
func (r *ProspectaReadRepository) GetUserByEmail(ctx context.Context, email string) (domainprospecta.UserView, error) {
	var v domainprospecta.UserView
	var created time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, tenant_id::text, COALESCE(company_id::text,''), name, email, password_hash, role, created_at
		  FROM prospecta_user WHERE lower(email) = lower($1) LIMIT 1`, email).
		Scan(&v.ID, &v.TenantID, &v.CompanyID, &v.Name, &v.Email, &v.PasswordHash, &v.Role, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.UserView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.UserView{}, err
	}
	v.CreatedAt = created.UTC().Format(time.RFC3339)
	return v, nil
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

func (r *ProspectaReadRepository) ListCampaigns(ctx context.Context, tenantID string, limit int, cursor string) (domainprospecta.Page[domainprospecta.CampaignView], error) {
	// Cursor por id (uuid): a ordenação é estável, então "próximo" é o último id
	// devolvido. Busca limit+1 para saber se há uma próxima página.
	var out []domainprospecta.CampaignView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT c.id::text, c.company_id::text, COALESCE(c.icp_id::text,''), c.name, c.channels, c.status,
			       COALESCE((SELECT count(*) FROM prospecta_lead l WHERE l.campaign_id = c.id), 0)
			  FROM prospecta_campaign c
			 WHERE c.tenant_id = $1 AND ($2::uuid IS NULL OR c.id > $2::uuid)
			 ORDER BY c.id
			 LIMIT $3`, tenantID, cursorPtr(cursor), limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v domainprospecta.CampaignView
			if err := rows.Scan(&v.ID, &v.CompanyID, &v.ICPID, &v.Name, &v.Channels, &v.Status, &v.LeadsCount); err != nil {
				return err
			}
			if v.Channels == nil {
				v.Channels = []string{}
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return domainprospecta.Page[domainprospecta.CampaignView]{}, err
	}
	return pageOf(out, limit, func(v domainprospecta.CampaignView) string { return v.ID }), nil
}

func (r *ProspectaReadRepository) GetCampaign(ctx context.Context, tenantID, id string) (domainprospecta.CampaignView, error) {
	var v domainprospecta.CampaignView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT c.id::text, c.company_id::text, COALESCE(c.icp_id::text,''), c.name, c.channels, c.status,
			       COALESCE((SELECT count(*) FROM prospecta_lead l WHERE l.campaign_id = c.id), 0)
			  FROM prospecta_campaign c
			 WHERE c.id = $1 AND c.tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.CompanyID, &v.ICPID, &v.Name, &v.Channels, &v.Status, &v.LeadsCount)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.CampaignView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.CampaignView{}, err
	}
	if v.Channels == nil {
		v.Channels = []string{}
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

func (r *ProspectaReadRepository) ListLeads(ctx context.Context, tenantID string, f domainprospecta.LeadFilter, limit int, cursor string) (domainprospecta.Page[domainprospecta.LeadView], error) {
	var out []domainprospecta.LeadView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id::text, campaign_id::text, company_name, segment, channel, fit, status, source_url
			  FROM prospecta_lead
			 WHERE tenant_id = $1
			   AND ($2::uuid IS NULL OR campaign_id = $2::uuid)
			   AND ($3 = '' OR status = $3)
			   AND ($4 = 0 OR fit >= $4)
			   AND ($5::uuid IS NULL OR id > $5::uuid)
			 ORDER BY id
			 LIMIT $6`, tenantID, cursorPtr(f.CampaignID), f.Status, f.FitMin, cursorPtr(cursor), limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v domainprospecta.LeadView
			if err := rows.Scan(&v.ID, &v.CampaignID, &v.CompanyName, &v.Segment, &v.Channel, &v.Fit, &v.Status, &v.SourceURL); err != nil {
				return err
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return domainprospecta.Page[domainprospecta.LeadView]{}, err
	}
	return pageOf(out, limit, func(v domainprospecta.LeadView) string { return v.ID }), nil
}

func (r *ProspectaReadRepository) GetLead(ctx context.Context, tenantID, id string) (domainprospecta.LeadView, error) {
	var v domainprospecta.LeadView
	var raw []byte
	var created, updated time.Time
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id::text, campaign_id::text, company_name, segment, channel, fit, status, source_url, enriched, created_at, updated_at
			  FROM prospecta_lead WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.CampaignID, &v.CompanyName, &v.Segment, &v.Channel, &v.Fit, &v.Status, &v.SourceURL, &raw, &created, &updated)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.LeadView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.LeadView{}, err
	}
	v.Enriched = unmarshalMap(raw)
	v.Timeline = leadTimeline(v.Status, created, updated)

	last, err := r.lastMessage(ctx, tenantID, id)
	if err == nil {
		v.LastMessage = &last
	} else if !errors.Is(err, domainprospecta.ErrNotFound) {
		return domainprospecta.LeadView{}, err
	}
	return v, nil
}

// leadTimeline deriva a linha do tempo do próprio estado do lead: a descoberta
// (created_at) e o estado atual (updated_at quando ele avançou). O MVP não tem
// tabela de histórico das transições; o que dá para provar com as colunas é
// isto, e é o que a tela mostra.
func leadTimeline(status string, created, updated time.Time) []domainprospecta.TimelineEntry {
	seen := map[string]bool{}
	var out []domainprospecta.TimelineEntry
	add := func(at time.Time, kind string) {
		at = at.UTC()
		key := kind + "|" + at.Format(time.RFC3339)
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, domainprospecta.TimelineEntry{At: at.Format(time.RFC3339), Kind: kind})
	}
	add(created, "discovered")
	if !updated.IsZero() && updated.After(created) {
		add(updated, status)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At > out[j].At })
	if len(out) == 0 {
		return nil
	}
	return out
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

func (r *ProspectaReadRepository) GetMessage(ctx context.Context, tenantID, id string) (domainprospecta.MessageView, error) {
	var v domainprospecta.MessageView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id::text, lead_id::text, channel, direction, content, status, sent_at
			  FROM prospecta_message WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.LeadID, &v.Channel, &v.Direction, &v.Content, &v.Status, sentAt(&v))
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.MessageView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.MessageView{}, err
	}
	return v, nil
}

// lastMessage devolve a mensagem mais recente de um lead (ou ErrNotFound).
func (r *ProspectaReadRepository) lastMessage(ctx context.Context, tenantID, leadID string) (domainprospecta.MessageView, error) {
	var v domainprospecta.MessageView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id::text, lead_id::text, channel, direction, content, status, sent_at
			  FROM prospecta_message WHERE lead_id = $1 AND tenant_id = $2
			  ORDER BY created_at DESC LIMIT 1`, leadID, tenantID).
			Scan(&v.ID, &v.LeadID, &v.Channel, &v.Direction, &v.Content, &v.Status, sentAt(&v))
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.MessageView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.MessageView{}, err
	}
	return v, nil
}

// sentAt é um destino de scan para o sent_at nullable, que grava a string
// formatada no MessageView. sent_at é NULL enquanto a mensagem não foi enviada.
type sentAtScanner struct{ dst *domainprospecta.MessageView }

func sentAt(v *domainprospecta.MessageView) *sentAtScanner { return &sentAtScanner{dst: v} }

func (s *sentAtScanner) Scan(src any) error {
	if src == nil {
		return nil
	}
	t, ok := src.(time.Time)
	if !ok {
		return fmt.Errorf("sent_at: tipo inesperado %T", src)
	}
	s.dst.SentAt = t.UTC().Format(time.RFC3339)
	return nil
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

func (r *ProspectaReadRepository) ListConversations(ctx context.Context, tenantID string, limit int, cursor string) (domainprospecta.Page[domainprospecta.ConversationView], error) {
	var out []domainprospecta.ConversationView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT c.id::text, c.lead_id::text, COALESCE(l.company_name,''), COALESCE(l.channel,''), c.state,
			       COALESCE((SELECT m.content FROM prospecta_message m
			                  WHERE m.lead_id = c.lead_id AND m.tenant_id = c.tenant_id
			                  ORDER BY m.created_at DESC LIMIT 1), ''),
			       (SELECT count(*) FROM prospecta_message m
			         WHERE m.lead_id = c.lead_id AND m.tenant_id = c.tenant_id AND m.direction = 'in')
			  FROM prospecta_conversation c
			  LEFT JOIN prospecta_lead l ON l.id = c.lead_id
			 WHERE c.tenant_id = $1 AND ($2::uuid IS NULL OR c.id > $2::uuid)
			 ORDER BY c.id
			 LIMIT $3`, tenantID, cursorPtr(cursor), limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v domainprospecta.ConversationView
			if err := rows.Scan(&v.ID, &v.LeadID, &v.CompanyName, &v.Channel, &v.State, &v.LastMessage, &v.Unread); err != nil {
				return err
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return domainprospecta.Page[domainprospecta.ConversationView]{}, err
	}
	return pageOf(out, limit, func(v domainprospecta.ConversationView) string { return v.ID }), nil
}

func (r *ProspectaReadRepository) GetConversation(ctx context.Context, tenantID, id string) (domainprospecta.ConversationView, error) {
	var v domainprospecta.ConversationView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			SELECT c.id::text, c.lead_id::text, COALESCE(l.company_name,''), COALESCE(l.channel,''), c.state,
			       (SELECT count(*) FROM prospecta_message m
			         WHERE m.lead_id = c.lead_id AND m.tenant_id = c.tenant_id AND m.direction = 'in')
			  FROM prospecta_conversation c
			  LEFT JOIN prospecta_lead l ON l.id = c.lead_id
			 WHERE c.id = $1 AND c.tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.LeadID, &v.CompanyName, &v.Channel, &v.State, &v.Unread); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT id::text, lead_id::text, channel, direction, content, status, sent_at
			  FROM prospecta_message WHERE lead_id = $1 AND tenant_id = $2
			  ORDER BY created_at ASC, id ASC`, v.LeadID, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m domainprospecta.MessageView
			if err := rows.Scan(&m.ID, &m.LeadID, &m.Channel, &m.Direction, &m.Content, &m.Status, sentAt(&m)); err != nil {
				return err
			}
			v.Messages = append(v.Messages, m)
			if m.Content != "" {
				v.LastMessage = m.Content
			}
		}
		return rows.Err()
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.ConversationView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.ConversationView{}, err
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// Agent run (feed SSE + projeção por id)
// ---------------------------------------------------------------------------

func (r *ProspectaReadRepository) ListActivity(ctx context.Context, tenantID string, limit int) ([]domainprospecta.AgentRunEvent, error) {
	var out []domainprospecta.AgentRunEvent
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id::text, agent, state, metrics
			  FROM prospecta_agent_run WHERE tenant_id = $1
			  ORDER BY started_at DESC LIMIT $2`, tenantID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ev domainprospecta.AgentRunEvent
			var raw []byte
			if err := rows.Scan(&ev.RunID, &ev.Agent, &ev.State, &raw); err != nil {
				return err
			}
			ev.Metric = unmarshalMap(raw)
			out = append(out, ev)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetAgentRun projeta um run pelo id, dentro do tenant. O WHERE filtra o tenant
// além do RLS (defesa em profundidade). ErrNotFound quando não existe.
func (r *ProspectaReadRepository) GetAgentRun(ctx context.Context, tenantID, id string) (domainprospecta.AgentRunView, error) {
	var v domainprospecta.AgentRunView
	var raw []byte
	var started time.Time
	var ended *time.Time
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id::text, campaign_id::text, agent, state, metrics, started_at, ended_at
			  FROM prospecta_agent_run WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.CampaignID, &v.Agent, &v.State, &raw, &started, &ended)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.AgentRunView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.AgentRunView{}, err
	}
	v.Metrics = unmarshalMap(raw)
	v.StartedAt = started.UTC().Format(time.RFC3339)
	if ended != nil {
		v.EndedAt = ended.UTC().Format(time.RFC3339)
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// Opt-out (guardrail LGPD) e resolução por telefone
// ---------------------------------------------------------------------------

// IsOptedOut diz se o lead pediu opt-out. A ausência de linha é false — NUNCA um
// 404: o guardrail consulta isto antes de todo envio e precisa de uma resposta
// inequívoca.
func (r *ProspectaReadRepository) IsOptedOut(ctx context.Context, tenantID, leadID string) (bool, error) {
	opted := false
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM prospecta_opt_out WHERE tenant_id = $1 AND lead_id = $2)`,
			tenantID, leadID).Scan(&opted)
	})
	return opted, err
}

// LeadByPhone resolve o telefone (já normalizado: só dígitos, E.164 sem +) de
// volta ao lead. É CROSS-TENANT de propósito: o payload do WhatsApp não traz
// tenant, então a busca roda sem fixar app.current_tenant e casa em
// enriched->>'phone'. Devolve tenant_id + lead_id + thread_key (default
// "wa:<number>").
func (r *ProspectaReadRepository) LeadByPhone(ctx context.Context, phone string) (domainprospecta.LeadPhoneView, error) {
	var v domainprospecta.LeadPhoneView
	err := r.pool.QueryRow(ctx, `
		SELECT tenant_id::text, id::text, COALESCE(enriched->>'thread_key', 'wa:' || $1)
		  FROM prospecta_lead WHERE enriched->>'phone' = $1
		  ORDER BY updated_at DESC LIMIT 1`, phone).
		Scan(&v.TenantID, &v.LeadID, &v.ThreadKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.LeadPhoneView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.LeadPhoneView{}, err
	}
	if v.ThreadKey == "" {
		v.ThreadKey = "wa:" + phone
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// cursorPtr devolve nil para cursor vazio: o Postgres então recebe NULL na
// comparação ($n::uuid IS NULL OR ...), sem tentar converter ” em uuid.
func cursorPtr(cursor string) *string {
	if cursor == "" {
		return nil
	}
	return &cursor
}

// pageOf monta a página por cursor a partir de limit+1 linhas: se vier uma a
// mais, há próxima página e o cursor é o id do último item devolvido.
func pageOf[T any](rows []T, limit int, id func(T) string) domainprospecta.Page[T] {
	page := domainprospecta.Page[T]{Items: rows}
	if len(rows) > limit {
		page.Items = rows[:limit]
		page.Next = domainprospecta.CursorFrom(id(page.Items[limit-1]))
	}
	if page.Items == nil {
		page.Items = []T{}
	}
	return page
}

func unmarshalMap(raw []byte) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || len(m) == 0 {
		return nil
	}
	return m
}
