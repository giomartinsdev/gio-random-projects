package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
)

// ProspectaRepository implementa domain/prospecta.Repository contra Postgres.
//
// Multi-tenant com RLS (data-model.md): todas as queries setam
// app.current_tenant na transação antes de ler/escrever, e as policies
// prospecta_* usam esse valor. Diferente do resto do schema (clubs/finance),
// que não é multi-tenant.
type ProspectaRepository struct {
	pool *pgxpool.Pool
}

func NewProspectaRepository(pool *pgxpool.Pool) *ProspectaRepository {
	return &ProspectaRepository{pool: pool}
}

// withTenant abre uma transação, fixa o tenant da sessão (SET LOCAL, válido só
// na transação) e roda fn. É o ponto único que garante que nenhuma query do
// Prospecta saia sem tenant -- sem isso o RLS derruba tudo (força erro em vez
// de vazar dados).
func (r *ProspectaRepository) withTenant(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin prospecta tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.current_tenant', $1, true)`, tenantID); err != nil {
		return fmt.Errorf("set prospecta tenant: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit prospecta tx: %w", err)
	}
	return nil
}

// InsertCompany grava a empresa. Idempotente por command_id (índice único
// parcial): a reentrega do mesmo comando é ON CONFLICT DO NOTHING e reporta
// inserted=false, sem segundo evento.
func (r *ProspectaRepository) InsertCompany(ctx context.Context, c domainprospecta.Company, commandID string) (bool, error) {
	inserted := false
	err := r.withTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_company (id, tenant_id, name, site, description, command_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, now(), now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			c.ID, c.TenantID, c.Name, c.Site, c.Description, nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta company: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

func (r *ProspectaRepository) scanCompany(row pgx.Row) (domainprospecta.Company, error) {
	var c domainprospecta.Company
	err := row.Scan(&c.ID, &c.TenantID, &c.Name, &c.Site, &c.Description, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (r *ProspectaRepository) FindCompany(ctx context.Context, tenantID, id string) (domainprospecta.Company, error) {
	var c domainprospecta.Company
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		// O WHERE filtra o tenant ALÉM do RLS: defesa em profundidade. Se a
		// role de conexão for owner/BYPASSRLS (ex.: o superuser dos testes), a
		// policy não é aplicada -- o filtro explícito mantém o isolamento.
		c, err = r.scanCompany(tx.QueryRow(ctx,
			`SELECT id, tenant_id, name, site, description, created_at, updated_at
			   FROM prospecta_company WHERE id = $1 AND tenant_id = $2`, id, tenantID))
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.Company{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.Company{}, err
	}
	return c, nil
}

func (r *ProspectaRepository) CompanyExists(ctx context.Context, tenantID, id string) (bool, error) {
	exists := false
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM prospecta_company WHERE id = $1 AND tenant_id = $2)`,
			id, tenantID).Scan(&exists)
	})
	return exists, err
}

// InsertICP grava o ICP. Embedding é serializado em JSONB (o Postgres do repo
// não tem pgvector -- ver a nota no schema.sql); nil vira 'null'.
func (r *ProspectaRepository) InsertICP(ctx context.Context, icp domainprospecta.ICP, commandID string) (bool, error) {
	inserted := false
	embedding, err := json.Marshal(icp.Embedding)
	if err != nil {
		return false, fmt.Errorf("marshal icp embedding: %w", err)
	}
	err = r.withTenant(ctx, icp.TenantID, func(tx pgx.Tx) error {
		signals := icp.Signals
		if signals == nil {
			signals = []string{}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_icp (id, tenant_id, company_id, definition, signals, embedding, command_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			icp.ID, icp.TenantID, icp.CompanyID, icp.Definition, signals, string(embedding), nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta icp: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

func (r *ProspectaRepository) FindICPByCompany(ctx context.Context, tenantID, companyID string) (domainprospecta.ICP, error) {
	var icp domainprospecta.ICP
	var raw []byte
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id, tenant_id, company_id, definition, signals, embedding, created_at
			   FROM prospecta_icp WHERE company_id = $1 AND tenant_id = $2
			  ORDER BY created_at DESC LIMIT 1`, companyID, tenantID).
			Scan(&icp.ID, &icp.TenantID, &icp.CompanyID, &icp.Definition, &icp.Signals, &raw, &icp.CreatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.ICP{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.ICP{}, err
	}
	if len(raw) > 0 && string(raw) != "null" {
		_ = json.Unmarshal(raw, &icp.Embedding)
	}
	return icp, nil
}

func nullableCommandID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

func nullableUUID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func (r *ProspectaRepository) InsertCampaign(ctx context.Context, c domainprospecta.Campaign, commandID string) (bool, error) {
	inserted := false
	err := r.withTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
		channels := c.Channels
		if channels == nil {
			channels = []string{}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_campaign (id, tenant_id, company_id, icp_id, name, channels, status, approval_policy, command_id, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			c.ID, c.TenantID, c.CompanyID, nullableUUID(c.ICPID), c.Name, channels, string(c.Status), c.ApprovalPolicy, nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta campaign: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

func (r *ProspectaRepository) scanCampaign(row pgx.Row) (domainprospecta.Campaign, error) {
	var c domainprospecta.Campaign
	var icpID *string
	err := row.Scan(&c.ID, &c.TenantID, &c.CompanyID, &icpID, &c.Name, &c.Channels, &c.Status, &c.ApprovalPolicy, &c.CreatedAt, &c.UpdatedAt)
	if icpID != nil {
		c.ICPID = *icpID
	}
	return c, err
}

func (r *ProspectaRepository) FindCampaign(ctx context.Context, tenantID, id string) (domainprospecta.Campaign, error) {
	var c domainprospecta.Campaign
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		c, err = r.scanCampaign(tx.QueryRow(ctx,
			`SELECT id::text, tenant_id::text, company_id::text, icp_id::text, name, channels, status, approval_policy, created_at, updated_at
			   FROM prospecta_campaign WHERE id=$1 AND tenant_id=$2`, id, tenantID))
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.Campaign{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.Campaign{}, err
	}
	if c.Channels == nil {
		c.Channels = []string{}
	}
	return c, nil
}

func (r *ProspectaRepository) SetCampaignStatus(ctx context.Context, tenantID, id string, from, to domainprospecta.CampaignStatus) (bool, error) {
	changed := false
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE prospecta_campaign SET status=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status=$3`,
			id, tenantID, string(from), string(to))
		if err != nil {
			return fmt.Errorf("set prospecta campaign status: %w", err)
		}
		changed = tag.RowsAffected() > 0
		return nil
	})
	return changed, err
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

func (r *ProspectaRepository) InsertLead(ctx context.Context, l domainprospecta.Lead, commandID string) (bool, error) {
	inserted := false
	enriched, err := marshalJSONB(l.Enriched)
	if err != nil {
		return false, err
	}
	err = r.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_lead (id, tenant_id, campaign_id, company_name, domain, segment, channel, fit, status, source_url, enriched, command_id, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12, now(), now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			l.ID, l.TenantID, l.CampaignID, l.CompanyName, l.Domain, l.Segment, l.Channel, l.Fit, string(l.Status), l.SourceURL, string(enriched), nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta lead: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

func (r *ProspectaRepository) scanLead(row pgx.Row) (domainprospecta.Lead, error) {
	var l domainprospecta.Lead
	var raw []byte
	err := row.Scan(&l.ID, &l.TenantID, &l.CampaignID, &l.CompanyName, &l.Domain, &l.Segment, &l.Channel, &l.Fit, &l.Status, &l.SourceURL, &raw, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return l, err
	}
	l.Enriched = unmarshalJSONBMap(raw)
	return l, nil
}

func (r *ProspectaRepository) FindLead(ctx context.Context, tenantID, id string) (domainprospecta.Lead, error) {
	var l domainprospecta.Lead
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		l, err = r.scanLead(tx.QueryRow(ctx,
			`SELECT id::text, tenant_id::text, campaign_id::text, company_name, domain, segment, channel, fit, status, source_url, enriched, created_at, updated_at
			   FROM prospecta_lead WHERE id=$1 AND tenant_id=$2`, id, tenantID))
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.Lead{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.Lead{}, err
	}
	return l, nil
}

// UpsertLeadByDedupKey insere ou atualiza pela chave (tenant_id, domain,
// company_name). O RETURNING (xmax = 0) distingue um INSERT de um UPDATE — é o
// que permite emitir LeadDiscovered só na descoberta e LeadEnriched no
// enriquecimento de um lead já existente.
func (r *ProspectaRepository) UpsertLeadByDedupKey(ctx context.Context, l domainprospecta.Lead, commandID string) (bool, error) {
	inserted := false
	enriched, err := marshalJSONB(l.Enriched)
	if err != nil {
		return false, err
	}
	var returnedID string
	err = r.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO prospecta_lead (id, tenant_id, campaign_id, company_name, domain, segment, channel, fit, status, source_url, enriched, command_id, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12, now(), now())
			ON CONFLICT (tenant_id, domain, company_name) DO UPDATE SET
			  segment    = EXCLUDED.segment,
			  channel    = EXCLUDED.channel,
			  source_url = EXCLUDED.source_url,
			  enriched   = COALESCE(EXCLUDED.enriched, prospecta_lead.enriched),
			  fit        = CASE WHEN EXCLUDED.fit > 0 THEN EXCLUDED.fit ELSE prospecta_lead.fit END,
			  status     = CASE WHEN EXCLUDED.enriched IS NOT NULL THEN 'enriched' ELSE prospecta_lead.status END,
			  updated_at = now()
			RETURNING id::text, (xmax = 0)`,
			l.ID, l.TenantID, l.CampaignID, l.CompanyName, l.Domain, l.Segment, l.Channel, l.Fit, string(l.Status), l.SourceURL, string(enriched), nullableCommandID(commandID)).
			Scan(&returnedID, &inserted)
	})
	if err != nil {
		return false, err
	}
	// O id estável é o da linha (num dedup o lead.ID novo não é o gravado).
	l.ID = returnedID
	return inserted, nil
}

func (r *ProspectaRepository) UpdateLeadFit(ctx context.Context, l domainprospecta.Lead) error {
	return r.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE prospecta_lead SET fit=$3, status=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
			l.ID, l.TenantID, l.Fit, string(l.Status))
		if err != nil {
			return fmt.Errorf("update prospecta lead fit: %w", err)
		}
		return nil
	})
}

func (r *ProspectaRepository) UpdateLeadStatus(ctx context.Context, l domainprospecta.Lead) error {
	return r.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE prospecta_lead SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
			l.ID, l.TenantID, string(l.Status))
		if err != nil {
			return fmt.Errorf("update prospecta lead status: %w", err)
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

func (r *ProspectaRepository) InsertMessage(ctx context.Context, m domainprospecta.Message, commandID string) (bool, error) {
	inserted := false
	err := r.withTenant(ctx, m.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status, external_id, command_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			m.ID, m.TenantID, m.LeadID, m.Channel, string(m.Direction), m.Content, string(m.Status), m.ExternalID, nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta message: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

func (r *ProspectaRepository) FindMessage(ctx context.Context, tenantID, id string) (domainprospecta.Message, error) {
	var m domainprospecta.Message
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id::text, tenant_id::text, lead_id::text, channel, direction, content, status, external_id, created_at
			   FROM prospecta_message WHERE id=$1 AND tenant_id=$2`, id, tenantID).
			Scan(&m.ID, &m.TenantID, &m.LeadID, &m.Channel, &m.Direction, &m.Content, &m.Status, &m.ExternalID, &m.CreatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.Message{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.Message{}, err
	}
	return m, nil
}

func (r *ProspectaRepository) SetMessageStatus(ctx context.Context, tenantID, id string, from, to domainprospecta.MessageStatus, externalID string) (bool, error) {
	changed := false
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE prospecta_message
			   SET status=$4,
			       external_id = CASE WHEN $5 = '' THEN external_id ELSE $5 END,
			       sent_at     = CASE WHEN $4 = 'sent' THEN now() ELSE sent_at END
			 WHERE id=$1 AND tenant_id=$2 AND status=$3`,
			id, tenantID, string(from), string(to), externalID)
		if err != nil {
			return fmt.Errorf("set prospecta message status: %w", err)
		}
		changed = tag.RowsAffected() > 0
		return nil
	})
	return changed, err
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

func (r *ProspectaRepository) FindConversation(ctx context.Context, tenantID, threadKey string) (domainprospecta.Conversation, error) {
	var c domainprospecta.Conversation
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id::text, tenant_id::text, lead_id::text, thread_key, state, created_at, updated_at
			   FROM prospecta_conversation WHERE tenant_id=$1 AND thread_key=$2`, tenantID, threadKey).
			Scan(&c.ID, &c.TenantID, &c.LeadID, &c.ThreadKey, &c.State, &c.CreatedAt, &c.UpdatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.Conversation{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.Conversation{}, err
	}
	return c, nil
}

// UpsertConversation insere a thread; numa thread já existente o ON CONFLICT
// atualiza updated_at e devolve a linha existente. É a base da idempotência do
// ReceiveReply: a resposta reentregue cai na mesma conversa.
func (r *ProspectaRepository) UpsertConversation(ctx context.Context, c domainprospecta.Conversation) (domainprospecta.Conversation, error) {
	var out domainprospecta.Conversation
	err := r.withTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO prospecta_conversation (id, tenant_id, lead_id, thread_key, state, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5, now(), now())
			ON CONFLICT (tenant_id, thread_key) DO UPDATE SET updated_at = now()
			RETURNING id::text, tenant_id::text, lead_id::text, thread_key, state, created_at, updated_at`,
			c.ID, c.TenantID, c.LeadID, c.ThreadKey, string(c.State)).
			Scan(&out.ID, &out.TenantID, &out.LeadID, &out.ThreadKey, &out.State, &out.CreatedAt, &out.UpdatedAt)
	})
	return out, err
}

// ---------------------------------------------------------------------------
// AgentRun
// ---------------------------------------------------------------------------

func (r *ProspectaRepository) InsertAgentRun(ctx context.Context, run domainprospecta.AgentRun, commandID string) (bool, error) {
	inserted := false
	metrics, err := marshalJSONB(run.Metrics)
	if err != nil {
		return false, err
	}
	err = r.withTenant(ctx, run.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_agent_run (id, tenant_id, campaign_id, agent, state, metrics, command_id, started_at)
			VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			run.ID, run.TenantID, run.CampaignID, string(run.Agent), string(run.State), string(metrics), nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta agent run: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

// FindAgentRun busca o run dentro do tenant (filtro explícito além do RLS).
func (r *ProspectaRepository) FindAgentRun(ctx context.Context, tenantID, id string) (domainprospecta.AgentRun, error) {
	var run domainprospecta.AgentRun
	var raw []byte
	var ended *time.Time
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id::text, tenant_id::text, campaign_id::text, agent, state, metrics, started_at, ended_at
			  FROM prospecta_agent_run WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&run.ID, &run.TenantID, &run.CampaignID, &run.Agent, &run.State, &raw, &run.StartedAt, &ended)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.AgentRun{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.AgentRun{}, err
	}
	run.Metrics = unmarshalJSONBMap(raw)
	run.EndedAt = ended
	return run, nil
}

// UpdateAgentRunState grava state/metrics e, quando terminal, ended_at. O
// command_id é gravado junto: uma reentrega do MESMO comando não acha a linha
// para atualizar (command_id difere) e changed=false. O WHERE exige que o run
// ainda NÃO esteja terminal — um comando antigo não regride um run fechado.
func (r *ProspectaRepository) UpdateAgentRunState(ctx context.Context, run domainprospecta.AgentRun, commandID string) (bool, error) {
	changed := false
	metrics, err := marshalJSONB(run.Metrics)
	if err != nil {
		return false, err
	}
	err = r.withTenant(ctx, run.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE prospecta_agent_run
			   SET state = $3,
			       metrics = $4::jsonb,
			       ended_at = CASE WHEN $3 IN ('done','failed') THEN now() ELSE ended_at END,
			       command_id = $5::uuid
			 WHERE id = $1 AND tenant_id = $2
			   AND state = 'running'
			   AND command_id IS DISTINCT FROM $5::uuid`,
			run.ID, run.TenantID, string(run.State), string(metrics), commandID)
		if err != nil {
			return fmt.Errorf("update prospecta agent run: %w", err)
		}
		changed = tag.RowsAffected() > 0
		return nil
	})
	return changed, err
}

// InsertOptOut grava o pedido de opt-out. Idempotente por (tenant_id, lead_id):
// o ON CONFLICT DO NOTHING reporta inserted=false na reentrega, sem segundo
// evento.
func (r *ProspectaRepository) InsertOptOut(ctx context.Context, o domainprospecta.OptOut) (bool, error) {
	inserted := false
	err := r.withTenant(ctx, o.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_opt_out (id, tenant_id, lead_id, reason, created_at)
			VALUES ($1,$2,$3,$4, now())
			ON CONFLICT (tenant_id, lead_id) DO NOTHING`,
			o.ID, o.TenantID, o.LeadID, o.Reason)
		if err != nil {
			return fmt.Errorf("insert prospecta opt out: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

// ---------------------------------------------------------------------------
// Audit (prospecta_audit_log)
// ---------------------------------------------------------------------------
func (r *ProspectaRepository) Audit(ctx context.Context, e domainprospecta.AuditEntry) error {
	if e.TenantID == "" {
		return nil
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return r.withTenant(ctx, e.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO prospecta_audit_log (id, tenant_id, command, status, payload, error, created_at)
			 VALUES ($1,$2,$3,$4,$5::jsonb,$6, now())`,
			id.String(), e.TenantID, e.Command, e.Status, string(e.Payload), e.Error)
		if err != nil {
			return fmt.Errorf("insert prospecta audit: %w", err)
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

// InsertUser grava a conta e-mail+senha. Idempotente por command_id; o e-mail é
// único GLOBALMENTE (índice lower(email)), então a reentrega do MESMO comando é
// no-op (ON CONFLICT command_id) e um e-mail já existente falha de forma limpa
// (o erro sobe, a linha não duplica).
func (r *ProspectaRepository) InsertUser(ctx context.Context, u domainprospecta.User, commandID string) (bool, error) {
	inserted := false
	err := r.withTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO prospecta_user (id, tenant_id, company_id, name, email, password_hash, role, command_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
			ON CONFLICT (command_id) WHERE command_id IS NOT NULL DO NOTHING`,
			u.ID, u.TenantID, nullableUUID(u.CompanyID), u.Name, u.Email, u.PasswordHash, u.Role, nullableCommandID(commandID))
		if err != nil {
			return fmt.Errorf("insert prospecta user: %w", err)
		}
		inserted = tag.RowsAffected() > 0
		return nil
	})
	return inserted, err
}

// UpdateUserPassword reescreve o password_hash de uma conta existente. O comando
// carrega o seu UUID em command_id: se ele JÁ foi aplicado, o UPDATE ... FROM
// não acha nada para atualizar (command_id difere) e changed=false, sem tocar a
// linha — a mesma disciplina idempotente dos demais comandos. O WHERE filtra o
// tenant além do RLS (defesa em profundidade).
func (r *ProspectaRepository) UpdateUserPassword(ctx context.Context, u domainprospecta.User, commandID string) (bool, error) {
	changed := false
	err := r.withTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE prospecta_user
			   SET password_hash = $1,
			       command_id = $2::uuid
			 WHERE id = $3::uuid AND tenant_id = $4::uuid
			   AND command_id IS DISTINCT FROM $2::uuid`,
			u.PasswordHash, commandID, u.ID, u.TenantID)
		if err != nil {
			return fmt.Errorf("update prospecta user password: %w", err)
		}
		changed = tag.RowsAffected() > 0
		if changed {
			return nil
		}
		// 0 linhas tem duas causas: reentrega do MESMO comando (no-op, ok) ou
		// usuário inexistente (falha). O EXISTS distingue — só o segundo vira
		// erro, para não engolir um comando que aponta para conta nenhuma.
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM prospecta_user WHERE id = $1::uuid AND tenant_id = $2::uuid)`,
			u.ID, u.TenantID).Scan(&exists); err != nil {
			return fmt.Errorf("check prospecta user exists: %w", err)
		}
		if !exists {
			return domainprospecta.ErrNotFound
		}
		return nil
	})
	return changed, err
}

func marshalJSONB(v any) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal jsonb: %w", err)
	}
	return raw, nil
}

func unmarshalJSONBMap(raw []byte) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m
}
