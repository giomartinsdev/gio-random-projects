// Package seed cria o workspace de demonstração do Café Aurora no primeiro
// boot. É o equivalente ao mock do frontend, mas dentro do banco: contatos,
// audiências, templates, campanhas e envios de verdade, para o dashboard ter
// números que vieram de linhas, não de constantes.
//
// Roda uma vez por workspace (`Seed` é idempotente) e pode ser forçado pelo
// endpoint de reset em desenvolvimento.
package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Workspace é o id fixo do tenant de demonstração.
const Workspace = "ws_cafe_aurora"

var cities = []struct{ City, UF string }{
	{"São Paulo", "SP"}, {"Campinas", "SP"}, {"Santos", "SP"},
	{"Rio de Janeiro", "RJ"}, {"Belo Horizonte", "MG"}, {"Curitiba", "PR"},
	{"Porto Alegre", "RS"}, {"Fortaleza", "CE"}, {"Goiânia", "GO"},
	{"Florianópolis", "SC"}, {"Recife", "PE"}, {"Salvador", "BA"},
}

var firstNames = []string{
	"Ana", "Bruno", "Camila", "Diego", "Elisa", "Fabio", "Gabriela", "Henrique",
	"Isabela", "João", "Karina", "Lucas", "Mariana", "Nelson", "Olívia", "Pedro",
	"Quéren", "Rafael", "Sofia", "Thiago", "Ursula", "Vitor", "Wanda", "Yara",
}

var lastNames = []string{
	"Lima", "Tavares", "Duarte", "Moreira", "Prado", "Nogueira", "Souza", "Aguiar",
	"Rocha", "Alves", "Mendes", "Ferreira", "Costa", "Ramos", "Pereira", "Cardoso",
}

// Seed popula o workspace se ele ainda não tem templates. Devolve quantos
// contatos foram criados (0 quando já existia).
func Seed(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var existing int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM templates WHERE workspace_id=$1`, Workspace).Scan(&existing); err != nil {
		return 0, err
	}
	if existing > 0 {
		return 0, nil
	}
	return seed(ctx, pool)
}

// Reset apaga tudo do workspace de demonstração e recria. Só é exposto quando
// ALLOW_DEV_ACTIONS está ligado.
func Reset(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	if _, err := pool.Exec(ctx, `
		TRUNCATE contact_consents, sends, campaigns, flows, segments, contacts, templates, activity
		RESTART IDENTITY CASCADE`); err != nil {
		return 0, err
	}
	if _, err := pool.Exec(ctx, `DELETE FROM webhook_events`); err != nil {
		return 0, err
	}
	return seed(ctx, pool)
}

func seed(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	now := time.Now().UTC()

	if _, err := pool.Exec(ctx, `
		INSERT INTO workspaces (id, name, segment, site, timezone, plan, whatsapp_number,
		                        email_sender, quality, messaging_limit, opt_in_policy, quiet_start, quiet_end)
		VALUES ($1,'Café Aurora','Torrefação de café especial · D2C','cafeaurora.com.br','America/Sao_Paulo',
		        'Growth','+55 11 91234-5678','time@cafeaurora.com.br','green','100 mil conversas / 24h',
		        'Opt-in explícito no checkout e no clube de assinatura; opt-out em 1 clique.',21,8)
		ON CONFLICT (id) DO UPDATE SET updated_at=now()`, Workspace); err != nil {
		return 0, fmt.Errorf("workspace: %w", err)
	}

	templates, err := insertTemplates(ctx, pool, now)
	if err != nil {
		return 0, err
	}

	contacts, err := insertContacts(ctx, pool)
	if err != nil {
		return 0, err
	}

	segments, err := insertSegments(ctx, pool)
	if err != nil {
		return 0, err
	}

	flows, err := insertFlows(ctx, pool, now)
	if err != nil {
		return 0, err
	}

	campaigns, err := insertCampaigns(ctx, pool, now, templates, segments, flows)
	if err != nil {
		return 0, err
	}

	if err := insertSends(ctx, pool, now, campaigns, contacts); err != nil {
		return 0, err
	}
	if err := insertActivity(ctx, pool, now); err != nil {
		return 0, err
	}
	return len(contacts), nil
}

type templateSeed struct{ ID, Name string }

func insertTemplates(ctx context.Context, pool *pgxpool.Pool, now time.Time) (map[string]templateSeed, error) {
	rows := []struct {
		ID, Name, Display, Category, Status, HeaderKind, HeaderText, HeaderMedia, Body, Footer string
		Buttons, Variables, MetaID                                                               string
		Quality                                                                                  int
		Ago                                                                                      time.Duration
	}{
		{
			ID: "tpl_reativacao_cupom", Name: "reativacao_cupom_volta",
			Display: "Volta pro café — cupom pessoal", Category: "marketing", Status: "approved",
			HeaderKind: "image", HeaderMedia: "torra-do-mes.jpg",
			Body:    "Oi, {{1}}! Faz tempo que você não passa por aqui ☕\n\nSeparamos um cupom só seu: *{{2}}* com {{3}} de desconto na próxima compra.\n\nVale até {{4}}.",
			Footer:  "Café Aurora · cupom válido no site e no clube",
			Buttons: `[{"type":"url","text":"Usar meu cupom","value":"https://cafeaurora.com.br/c/{{2}}"},{"type":"quick_reply","text":"Não quero receber"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"},{"index":"2","label":"Cupom","example":"VOLTA15"},{"index":"3","label":"Desconto","example":"15%"},{"index":"4","label":"Validade","example":"30/11"}]`,
			MetaID:    "wba_tpl_88213", Quality: 92, Ago: 120 * 24 * time.Hour,
		},
		{
			ID: "tpl_clube_convite", Name: "clube_assinatura_convite",
			Display: "Convite para o Clube Aurora", Category: "marketing", Status: "approved",
			HeaderKind: "text", HeaderText: "Seu café, todo mês, sem pensar",
			Body:    "{{1}}, o Clube Aurora manda uma torra fresca por mês, escolhida pelo nosso mestre de torra.\n\nA partir de R$ 59/mês, você cancela quando quiser. Quer experimentar?",
			Footer:  "Frete grátis em todo o Brasil",
			Buttons: `[{"type":"url","text":"Conhecer o clube","value":"https://cafeaurora.com.br/clube"},{"type":"quick_reply","text":"Me conta mais"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"}]`,
			MetaID:    "wba_tpl_88190", Quality: 97, Ago: 210 * 24 * time.Hour,
		},
		{
			ID: "tpl_lancamento_origem", Name: "lancamento_origem_especial",
			Display: "Lançamento: nova origem", Category: "marketing", Status: "approved",
			HeaderKind: "image", HeaderMedia: "nova-origem.jpg",
			Body:    "Chegou a {{1}} 🌱\n\nNotas de {{2}}, torra média. Lote limitado de {{3}} sacas — quem é do clube tem prioridade na compra.\n\nQuer garantir o seu?",
			Footer:  "Café Aurora · microlotes",
			Buttons: `[{"type":"url","text":"Ver o lote","value":"https://cafeaurora.com.br/origens/{{1}}"}]`,
			Variables: `[{"index":"1","label":"Origem","example":"Etiópia Guji"},{"index":"2","label":"Notas","example":"jasmim e pêssego"},{"index":"3","label":"Sacas","example":"80"}]`,
			MetaID:    "wba_tpl_88951", Quality: 88, Ago: 60 * 24 * time.Hour,
		},
		{
			ID: "tpl_carrinho", Name: "carrinho_abandonado_1h",
			Display: "Carrinho abandonado (1h)", Category: "utility", Status: "approved",
			HeaderKind: "none",
			Body:    "{{1}}, seu carrinho com {{2}} ainda está esperando. Reservamos por mais 24h — finaliza quando quiser.",
			Footer:  "Café Aurora",
			Buttons: `[{"type":"url","text":"Voltar ao carrinho","value":"https://cafeaurora.com.br/carrinho/{{3}}"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"},{"index":"2","label":"Produto","example":"2 itens"},{"index":"3","label":"Id do carrinho","example":"c_1234"}]`,
			MetaID:    "wba_tpl_88310", Quality: 95, Ago: 300 * 24 * time.Hour,
		},
		{
			ID: "tpl_aniversario", Name: "aniversario_cliente",
			Display: "Aniversário do cliente", Category: "marketing", Status: "approved",
			HeaderKind: "text", HeaderText: "Parabéns, {{1}} 🎉",
			Body:    "Hoje o café é por nossa conta: um brinde na sua próxima compra. Passa na loja ou pede pelo site com o cupom {{2}}.",
			Footer:  "Café Aurora",
			Buttons: `[{"type":"url","text":"Resgatar brinde","value":"https://cafeaurora.com.br/c/{{2}}"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"},{"index":"2","label":"Cupom","example":"NIVER"}]`,
			MetaID:    "wba_tpl_88520", Quality: 90, Ago: 150 * 24 * time.Hour,
		},
		{
			ID: "tpl_frete", Name: "cupom_frete_gratis",
			Display: "Cupom frete grátis", Category: "marketing", Status: "draft",
			HeaderKind: "none",
			Body:    "{{1}}, frete grátis acima de R$ 120 no seu próximo pedido. O cupom é {{2}} e vale até {{3}}.",
			Footer:  "Café Aurora",
			Buttons: `[{"type":"quick_reply","text":"Quero usar"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"},{"index":"2","label":"Cupom","example":"FRETE0"},{"index":"3","label":"Validade","example":"30/11"}]`,
			MetaID:    "", Quality: 0, Ago: 5 * time.Hour,
		},
		{
			ID: "tpl_pesquisa", Name: "pesquisa_pos_compra",
			Display: "Pesquisa pós-compra (NPS)", Category: "marketing", Status: "pending",
			HeaderKind: "none",
			Body:    "{{1}}, como foi seu café desta semana? Uma pergunta rápida — de 0 a 10, quanto indicaria a Aurora?",
			Footer:  "Leva 20 segundos",
			Buttons: `[{"type":"quick_reply","text":"Responder agora"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"}]`,
			MetaID:    "wba_tpl_89120", Quality: 0, Ago: 48 * time.Hour,
		},
		{
			ID: "tpl_winback", Name: "winback_3meses",
			Display: "Winback 3 meses (antigo)", Category: "utility", Status: "rejected",
			HeaderKind: "none",
			Body:    "{{1}}, sentimos sua falta! Volte com 20% OFF usando o cupom {{2}}.",
			Footer:  "Café Aurora",
			Buttons: `[{"type":"url","text":"Aproveitar","value":"https://cafeaurora.com.br/c/{{2}}"}]`,
			Variables: `[{"index":"1","label":"Primeiro nome","example":"Ana"},{"index":"2","label":"Cupom","example":"VOLTA20"}]`,
			MetaID:    "wba_tpl_87440", Quality: 0, Ago: 95 * 24 * time.Hour,
		},
	}

	out := map[string]templateSeed{}
	for _, t := range rows {
		created := now.Add(-t.Ago)
		rejection := ""
		if t.Status == "rejected" {
			rejection = "Conteúdo promocional em categoria utility. Reclassifique como marketing e reenvie — o texto em si está ok."
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO templates (id, workspace_id, name, display_name, channel, category, language, status,
			                       header_kind, header_text, header_media, body, footer, buttons, variables,
			                       external_id, quality, rejection_reason, created_at, updated_at)
			VALUES ($1,$2,$3,$4,'whatsapp',$5,'pt_BR',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
			t.ID, Workspace, t.Name, t.Display, t.Category, t.Status,
			t.HeaderKind, t.HeaderText, t.HeaderMedia, t.Body, t.Footer, t.Buttons, t.Variables,
			t.MetaID, t.Quality, rejection, created); err != nil {
			return nil, fmt.Errorf("template %s: %w", t.Name, err)
		}
		out[t.ID] = templateSeed{ID: t.ID, Name: t.Name}
	}
	return out, nil
}

func insertContacts(ctx context.Context, pool *pgxpool.Pool) ([]ContactRef, error) {
	// Semente fixa: a demo precisa ser a mesma em toda máquina.
	rng := rand.New(rand.NewSource(42))
	now := time.Now().UTC()
	out := make([]ContactRef, 0, 64)

	for i := 0; i < 64; i++ {
		first := firstNames[i%len(firstNames)]
		last := lastNames[(i*7)%len(lastNames)]
		name := first + " " + last
		loc := cities[rng.Intn(len(cities))]
		phone := fmt.Sprintf("5511%08d", 90000000+i*137)
		if a := rng.Intn(2); a == 0 {
			phone = fmt.Sprintf("5521%08d", 91000000+i*211)
		}

		tags := []string{"cliente"}
		switch {
		case i%11 == 0:
			tags = []string{"cliente", "vip", "clube"}
		case i%5 == 0:
			tags = []string{"lead", "carrinho"}
		case i%7 == 0:
			tags = []string{"cliente", "clube"}
		case i%13 == 0:
			tags = []string{"lead", "aniversario_mes"}
		}

		source := "checkout"
		switch i % 4 {
		case 1:
			source = "formulário"
		case 2:
			source = "clube"
		case 3:
			source = "instagram"
		}

		// ~10% sem opt-in: é a linha que prova que o disparo filtra, não só
		// que ele funciona.
		optIn := i%10 != 3
		var optInAt, optOutAt, lastPurchase *time.Time
		if optIn {
			t := now.Add(-time.Duration(30+i*3) * 24 * time.Hour)
			optInAt = &t
		} else {
			t := now.Add(-time.Duration(10+i) * 24 * time.Hour)
			optOutAt = &t
		}

		orders := 0
		spent := 0.0
		if i%5 != 0 {
			days := rng.Intn(220)
			t := now.Add(-time.Duration(days) * 24 * time.Hour)
			lastPurchase = &t
			orders = 1 + rng.Intn(28)
			spent = float64(rng.Intn(700000)) / 100
		}

		plan := ""
		if i%7 == 0 || i%11 == 0 {
			plan = "clube"
		}

		id := fmt.Sprintf("ct_%03d", i+1)
		tagsJSON := toJSON(tags)
		if _, err := pool.Exec(ctx, `
			INSERT INTO contacts (id, workspace_id, name, phone, email, city, uf, tags, source, plan,
			                      opt_in, opt_in_source, opt_in_at, opt_out_at, last_purchase_at,
			                      total_spent, orders, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
			id, Workspace, name, phone, first+"@email.com", loc.City, loc.UF, tagsJSON, source, plan,
			optIn, firstNonEmpty(source, "manual"), optInAt, optOutAt, lastPurchase,
			spent, orders, now.Add(-time.Duration(200-i)*24*time.Hour)); err != nil {
			return nil, fmt.Errorf("contato %s: %w", name, err)
		}

		if optIn {
			if _, err := pool.Exec(ctx, `
				INSERT INTO contact_consents (contact_id, source, granted_at, policy_text)
				VALUES ($1,$2,$3,'Aceito receber novidades e ofertas do Café Aurora por WhatsApp.')`,
				id, source, optInAt); err != nil {
				return nil, err
			}
			out = append(out, ContactRef{ID: id, Name: name, Phone: phone, City: loc.City, UF: loc.UF, Plan: plan, Orders: orders, Tags: tags, DaysSincePurchase: daysSince(lastPurchase)})
		}	}
	return out, nil
}

// ContactRef é o mínimo para semear envios sem reler o banco.
type ContactRef struct {
	ID, Name, Phone, City, UF, Plan string
	Orders                          int
	Tags                            []string
	DaysSincePurchase               int
}

func daysSince(t *time.Time) int {
	if t == nil {
		return -1
	}
	return int(time.Since(*t).Hours() / 24)
}

func insertSegments(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows := []struct {
		ID, Name, Description, Kind, Combinator, Rules, Source string
	}{
		{
			ID: "seg_frios", Name: "Leads frios (90+ dias)", Kind: "dynamic",
			Description: "Comprou alguma vez, mas não volta há mais de 90 dias. O alvo natural de reativação com cupom.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"ultima_compra","operator":"gt","value":"90"},{"id":"r2","field":"opt_in","operator":"eq","value":"sim"}]`,
			Source:      "CRM + histórico de pedidos",
		},
		{
			ID: "seg_vip", Name: "Clientes VIP", Kind: "dynamic",
			Description: "Gastou mais de R$ 3.000 no total. Recebe lançamentos antes de todo mundo.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"total_gasto","operator":"gt","value":"3000"},{"id":"r2","field":"opt_in","operator":"eq","value":"sim"}]`,
			Source:      "CRM",
		},
		{
			ID: "seg_assinantes", Name: "Assinantes do clube", Kind: "dynamic",
			Description: "Assinatura ativa do Clube Aurora. Comunicação de benefício, não de venda dura.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"plano","operator":"eq","value":"clube"},{"id":"r2","field":"opt_in","operator":"eq","value":"sim"}]`,
			Source:      "Clube (billing)",
		},
		{
			ID: "seg_carrinho", Name: "Carrinho abandonado", Kind: "dynamic",
			Description: "Montou carrinho nas últimas 24h e não finalizou. Só entra quem não recebeu o disparo de 1h.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"tag","operator":"contains","value":"carrinho"}]`,
			Source:      "Evento do site",
		},
		{
			ID: "seg_aniversario", Name: "Aniversariantes do mês", Kind: "dynamic",
			Description: "Aniversário no mês corrente. Dispara o brinde no dia, às 9h.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"tag","operator":"eq","value":"aniversario_mes"}]`,
			Source:      "CRM",
		},
		{
			ID: "seg_lista_evento", Name: "Lista — Feira de Café 2026", Kind: "import",
			Description: "Planilha importada do stand da feira. Opt-in assinado no tablet.",
			Combinator:  "and",
			Rules:       `[{"id":"r1","field":"origem","operator":"eq","value":"instagram"}]`,
			Source:      "Importação CSV · feira-cafe-2026.csv",
		},
	}
	ids := make([]string, 0, len(rows))
	for i, s := range rows {
		if _, err := pool.Exec(ctx, `
			INSERT INTO segments (id, workspace_id, name, description, kind, combinator, rules, source, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 * interval '1 day'), now() - ($9 * interval '1 day'))`,
			s.ID, Workspace, s.Name, s.Description, s.Kind, s.Combinator, s.Rules, s.Source, i+1); err != nil {
			return nil, fmt.Errorf("segmento %s: %w", s.ID, err)
		}
		ids = append(ids, s.ID)
	}
	return ids, nil
}

func insertFlows(ctx context.Context, pool *pgxpool.Pool, now time.Time) (map[string]string, error) {
	nodes := func(items ...string) string { return "[" + strings.Join(items, ",") + "]" }

	reativacao := nodes(
		`{"id":"n_start","type":"trigger.schedule","title":"Todo dia útil, 9h","x":40,"y":200,"config":{"type":"trigger.schedule","cron":"0 9 * * 1-5"}}`,
		`{"id":"n_seg","type":"source.segment","title":"Leads frios (90+ dias)","x":320,"y":200,"config":{"type":"source.segment","segmentId":"seg_frios"}}`,
		`{"id":"n_rules","type":"filter.rules","title":"Filtro de descobrimento","x":600,"y":96,"config":{"type":"filter.rules","combinator":"and","rules":[{"id":"f1","field":"opt_in","operator":"eq","value":"sim"},{"id":"f2","field":"ultima_compra","operator":"gt","value":"90"}]}}`,
		`{"id":"n_dedupe","type":"action.dedupe","title":"Remover duplicados","x":600,"y":320,"config":{"type":"action.dedupe","key":"phone"}}`,
		`{"id":"n_coupon","type":"action.coupon","title":"Cupom único","x":880,"y":200,"config":{"type":"action.coupon","discount":15,"kind":"cupom","perRecipient":true,"expireDays":14}}`,
		`{"id":"n_template","type":"action.template","title":"Template: Volta pro café","x":1160,"y":200,"config":{"type":"action.template","templateId":"tpl_reativacao_cupom","mapping":{"1":"primeiro_nome","2":"cupom","3":"desconto","4":"validade"}}}`,
		`{"id":"n_channel","type":"action.channel","title":"WhatsApp · número Aurora","x":1440,"y":200,"config":{"type":"action.channel","channel":"whatsapp","sender":"+55 11 91234-5678","throttled":true}}`,
		`{"id":"n_wait","type":"action.waitReply","title":"Aguardar resposta (48h)","x":1720,"y":200,"config":{"type":"action.waitReply","timeoutHours":48,"onTimeout":"continue"}}`,
		`{"id":"n_handoff","type":"action.handoff","title":"Atendimento humano","x":2000,"y":96,"config":{"type":"action.handoff","queue":"café · vendas","slaMinutes":30}}`,
		`{"id":"n_end","type":"end","title":"Fim","x":2000,"y":320,"config":{"type":"end"}}`,
	)
	reativacaoEdges := nodes(
		`{"id":"e1","from":"n_start","to":"n_seg"}`,
		`{"id":"e2","from":"n_seg","to":"n_rules"}`,
		`{"id":"e3","from":"n_rules","to":"n_dedupe","branch":"passou"}`,
		`{"id":"e4","from":"n_dedupe","to":"n_coupon"}`,
		`{"id":"e5","from":"n_coupon","to":"n_template"}`,
		`{"id":"e6","from":"n_template","to":"n_channel"}`,
		`{"id":"e7","from":"n_channel","to":"n_wait"}`,
		`{"id":"e8","from":"n_wait","to":"n_handoff","branch":"respondeu"}`,
		`{"id":"e9","from":"n_wait","to":"n_end","branch":"sem resposta"}`,
	)

	carrinho := nodes(
		`{"id":"c_start","type":"trigger.event","title":"Evento: carrinho.abandonado","x":40,"y":180,"config":{"type":"trigger.event","event":"carrinho.abandonado"}}`,
		`{"id":"c_delay","type":"action.delay","title":"Esperar 1 hora","x":320,"y":180,"config":{"type":"action.delay","amount":1,"unit":"hour"}}`,
		`{"id":"c_branch","type":"condition.branch","title":"Carrinho ainda aberto?","x":600,"y":180,"config":{"type":"condition.branch","field":"tag","operator":"contains","value":"carrinho"}}`,
		`{"id":"c_template","type":"action.template","title":"Template: carrinho 1h","x":880,"y":96,"config":{"type":"action.template","templateId":"tpl_carrinho","mapping":{"1":"primeiro_nome","2":"resumo_carrinho","3":"id_carrinho"}}}`,
		`{"id":"c_channel","type":"action.channel","title":"WhatsApp · número Aurora","x":1160,"y":96,"config":{"type":"action.channel","channel":"whatsapp","sender":"+55 11 91234-5678","throttled":true}}`,
		`{"id":"c_end","type":"end","title":"Fim","x":880,"y":320,"config":{"type":"end"}}`,
	)
	carrinhoEdges := nodes(
		`{"id":"ce1","from":"c_start","to":"c_delay"}`,
		`{"id":"ce2","from":"c_delay","to":"c_branch"}`,
		`{"id":"ce3","from":"c_branch","to":"c_template","branch":"sim"}`,
		`{"id":"ce4","from":"c_branch","to":"c_end","branch":"não"}`,
		`{"id":"ce5","from":"c_template","to":"c_channel"}`,
	)

	lancamento := nodes(
		`{"id":"l_start","type":"trigger.schedule","title":"Segunda, 9h","x":40,"y":180,"config":{"type":"trigger.schedule","cron":"0 9 * * 1"}}`,
		`{"id":"l_seg","type":"source.segment","title":"Assinantes do clube","x":320,"y":180,"config":{"type":"source.segment","segmentId":"seg_assinantes"}}`,
		`{"id":"l_coupon","type":"action.coupon","title":"Brinde 100g","x":600,"y":180,"config":{"type":"action.coupon","discount":0,"kind":"brinde","perRecipient":true,"expireDays":16}}`,
		`{"id":"l_template","type":"action.template","title":"Template: nova origem","x":880,"y":180,"config":{"type":"action.template","templateId":"tpl_lancamento_origem","mapping":{"1":"origem","2":"notas","3":"sacas"}}}`,
		`{"id":"l_channel","type":"action.channel","title":"WhatsApp · número Aurora","x":1160,"y":180,"config":{"type":"action.channel","channel":"whatsapp","sender":"+55 11 91234-5678","throttled":true}}`,
	)
	lancamentoEdges := nodes(
		`{"id":"le1","from":"l_start","to":"l_seg"}`,
		`{"id":"le2","from":"l_seg","to":"l_coupon"}`,
		`{"id":"le3","from":"l_coupon","to":"l_template"}`,
		`{"id":"le4","from":"l_template","to":"l_channel"}`,
	)

	rows := []struct {
		ID, Name, Description, Status, Campaign, Nodes, Edges string
		RunsTotal, RunsSuccess, RunsFailed                      int
		AgoHours                                                int
	}{
		{
			ID: "flow_reativacao", Name: "Reativação com cupom pessoal", Status: "active", Campaign: "cmp_reativacao",
			Description: "Pega quem não compra há 90 dias e está com opt-in, remove quem já recebeu nos últimos 30 dias, gera um cupom único e manda pelo WhatsApp dentro da janela permitida. Quem responde cai no atendimento.",
			Nodes:       reativacao, Edges: reativacaoEdges, RunsTotal: 6, RunsSuccess: 6, AgoHours: 9 * 24,
		},
		{
			ID: "flow_carrinho", Name: "Carrinho abandonado em 1h", Status: "active", Campaign: "cmp_carrinho",
			Description: "Gatilho por evento do site. Espera 1 hora (o cliente pode voltar sozinho), checa se o carrinho continua aberto e manda o lembrete. Sem cupom: o objetivo é recuperar, não pagar desconto.",
			Nodes:       carrinho, Edges: carrinhoEdges, RunsTotal: 1840, RunsSuccess: 1794, RunsFailed: 46, AgoHours: 92 * 24,
		},
		{
			ID: "flow_lancamento", Name: "Lançamento Etiópia Guji", Status: "draft", Campaign: "cmp_lancamento",
			Description: "Prioridade para o clube: 24h antes, só assinantes recebem o link com brinde de 100g. Depois abre para VIPs. Ainda não rodou.",
			Nodes:       lancamento, Edges: lancamentoEdges, AgoHours: 4 * 24,
		},
	}

	out := map[string]string{}
	for _, f := range rows {
		created := now.Add(-time.Duration(f.AgoHours) * time.Hour)
		if _, err := pool.Exec(ctx, `
			INSERT INTO flows (id, workspace_id, name, description, status, nodes, edges, campaign_id,
			                   runs_total, runs_success, runs_failed, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
			f.ID, Workspace, f.Name, f.Description, f.Status, f.Nodes, f.Edges, f.Campaign,
			f.RunsTotal, f.RunsSuccess, f.RunsFailed, created); err != nil {
			return nil, fmt.Errorf("fluxo %s: %w", f.ID, err)
		}
		out[f.Campaign] = f.ID
	}
	return out, nil
}

type campaignSeed struct {
	ID, Template, Status, Coupon string
	Audience                     int
}

func insertCampaigns(ctx context.Context, pool *pgxpool.Pool, now time.Time, templates map[string]templateSeed, segments []string, flows map[string]string) (map[string]campaignSeed, error) {
	rows := []struct {
		ID, Name, Objective, Status, TemplateID, SegmentIDs, FlowID string
		Schedule, Offer, Notes                                     string
		RequiresApproval                                           bool
		Skipped                                                    int
		CreatedAgo, RunAgo                                         time.Duration
		HasRun                                                     bool
	}{
		{
			ID: "cmp_reativacao", Name: "Reativação de leads frios — cupom pessoal",
			Objective: "reativacao", Status: "running",
			TemplateID: "tpl_reativacao_cupom", SegmentIDs: `["seg_frios"]`, FlowID: "flow_reativacao",
			Schedule:   `{"startAt":"` + now.Add(-6*24*time.Hour).Format(time.RFC3339) + `","windowStart":9,"windowEnd":18,"days":[1,2,3,4,5],"throttlePerMinute":120,"timezone":"America/Sao_Paulo"}`,
			Offer:      `{"enabled":true,"kind":"cupom","codePattern":"VOLTA-{nome}","discountLabel":"15% off","validUntil":"` + now.Add(14*24*time.Hour).Format(time.RFC3339) + `"}`,
			RequiresApproval: true, Skipped: 2,
			Notes:        "Cupom único por destinatário. Quem responde 'Não quero receber' sai da base em 1 clique.",
			CreatedAgo:   9 * 24 * time.Hour,
			HasRun:       true,
			RunAgo:       12 * time.Minute,
		},
		{
			ID: "cmp_carrinho", Name: "Carrinho abandonado (1h)",
			Objective: "conversao", Status: "running",
			TemplateID: "tpl_carrinho", SegmentIDs: `["seg_carrinho"]`, FlowID: "flow_carrinho",
			Schedule: `{"startAt":"` + now.Add(-90*24*time.Hour).Format(time.RFC3339) + `","windowStart":8,"windowEnd":22,"days":[0,1,2,3,4,5,6],"throttlePerMinute":240,"timezone":"America/Sao_Paulo"}`,
			Offer:    `{"enabled":false,"kind":"frete","codePattern":"","discountLabel":"","validUntil":""}`,
			CreatedAgo: 92 * 24 * time.Hour, HasRun: true, RunAgo: 4 * time.Minute,
		},
		{
			ID: "cmp_lancamento", Name: "Lançamento Etiópia Guji — lote limitado",
			Objective: "conversao", Status: "scheduled",
			TemplateID: "tpl_lancamento_origem", SegmentIDs: `["seg_vip","seg_assinantes"]`, FlowID: "flow_lancamento",
			Schedule: `{"startAt":"` + now.Add(48*time.Hour).Format(time.RFC3339) + `","windowStart":9,"windowEnd":18,"days":[1,2,3,4,5],"throttlePerMinute":60,"timezone":"America/Sao_Paulo"}`,
			Offer:    `{"enabled":true,"kind":"brinde","codePattern":"GUJI-{nome}","discountLabel":"brinde de 100g","validUntil":"` + now.Add(16*24*time.Hour).Format(time.RFC3339) + `"}`,
			RequiresApproval: true,
			Notes:      "Aguardando aprovação do fluxo. Clube tem prioridade de compra nas primeiras 24h.",
			CreatedAgo: 4 * 24 * time.Hour,
		},
	}

	out := map[string]campaignSeed{}
	for _, c := range rows {
		var lastRun any
		if c.HasRun {
			lastRun = now.Add(-c.RunAgo)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO campaigns (id, workspace_id, name, objective, status, channel, template_id,
			                       segment_ids, flow_id, schedule, offer, requires_approval,
			                       skipped_count, notes, last_run_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,'whatsapp',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			c.ID, Workspace, c.Name, c.Objective, c.Status, c.TemplateID, c.SegmentIDs, c.FlowID,
			c.Schedule, c.Offer, c.RequiresApproval, c.Skipped, c.Notes, lastRun,
			now.Add(-c.CreatedAgo), now.Add(-time.Hour)); err != nil {
			return nil, fmt.Errorf("campanha %s: %w", c.ID, err)
		}
		tpl := templates[c.TemplateID]
		coupon := ""
		if c.ID == "cmp_reativacao" {
			coupon = "VOLTA-{nome}"
		}
		out[c.ID] = campaignSeed{ID: c.ID, Template: tpl.Name, Status: c.Status, Coupon: coupon}
	}
	return out, nil
}

// insertSends cria o histórico de envios. É daqui que saem TODAS as métricas do
// dashboard: status espalhados e datas espalhadas pelos últimos 14 dias, para o
// gráfico e os cards contarem a mesma história.
func insertSends(ctx context.Context, pool *pgxpool.Pool, now time.Time, campaigns map[string]campaignSeed, contacts []ContactRef) error {
	rng := rand.New(rand.NewSource(7))

	type plan struct {
		campaignID string
		contacts   []ContactRef
	}
	plans := []plan{
		{campaignID: "cmp_reativacao", contacts: filterContacts(contacts, func(c ContactRef) bool {
			return c.DaysSincePurchase > 90
		})},
		{campaignID: "cmp_carrinho", contacts: filterContacts(contacts, func(c ContactRef) bool {
			return hasTag(c.Tags, "carrinho")
		})},
	}

	for _, p := range plans {
		camp, ok := campaigns[p.campaignID]
		if !ok {
			continue
		}
		for i, c := range p.contacts {
			// Distribui os envios nos últimos 14 dias, com mais volume recente.
			age := time.Duration(rng.Intn(14*24*60)) * time.Minute
			if i%3 == 0 {
				age = time.Duration(rng.Intn(72*60)) * time.Minute
			}
			at := now.Add(-age)

			status, err := "delivered", ""
			switch n := rng.Intn(100); {
			case n < 7:
				status, err = "failed", "131026 · destinatário não tem WhatsApp"
			case n < 18:
				status = "replied"
			case n < 42:
				status = "read"
			case n < 62:
				status = "sent"
			}

			coupon := ""
			if camp.Coupon != "" {
				first := c.Name
				if sp := strings.IndexByte(first, ' '); sp > 0 {
					first = first[:sp]
				}
				coupon = strings.ReplaceAll(camp.Coupon, "{nome}", strings.ToUpper(first))
			}
			external := ""
			if status != "failed" {
				external = fmt.Sprintf("wamid.seed.%s.%d", c.ID, i)
			}
			cost := 0.0625
			if status == "failed" {
				cost = 0
			}

			if _, err := pool.Exec(ctx, `
				INSERT INTO sends (id, workspace_id, campaign_id, contact_id, destination, template_name,
				                   status, coupon_code, external_id, error, cost, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
				ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
				fmt.Sprintf("snd_seed_%s_%03d", camp.ID, i), Workspace, camp.ID, c.ID, c.Phone,
				camp.Template, status, coupon, external, err, cost, at); err != nil {
				return fmt.Errorf("envio seed: %w", err)
			}
		}
	}
	return nil
}

func insertActivity(ctx context.Context, pool *pgxpool.Pool, now time.Time) error {
	rows := []struct {
		Ago                    time.Duration
		Kind, Title, Detail    string
		RefID                  string
	}{
		{4 * time.Minute, "send", "Carrinho abandonado disparou", "12 envios nos últimos 5 min · 100% entregues", "cmp_carrinho"},
		{12 * time.Minute, "flow", "Fluxo de reativação rodou", "Contatos entraram na fila; falhas por número sem WhatsApp", "flow_reativacao"},
		{3 * time.Hour, "campaign", "Lançamento aguardando aprovação", "Agendado para segunda 9h", "cmp_lancamento"},
		{9 * time.Hour, "template", "Template em análise na Meta", "pesquisa_pos_compra enviado há 2 dias", "tpl_pesquisa"},
		{26 * time.Hour, "template", "Template rejeitado", "winback_3meses · categoria utility para conteúdo promocional", "tpl_winback"},
		{48 * time.Hour, "billing", "Fatura do WhatsApp Business", "Conversas de marketing no ciclo", ""},
	}
	for i, a := range rows {
		if _, err := pool.Exec(ctx, `
			INSERT INTO activity (id, workspace_id, kind, title, detail, ref_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			fmt.Sprintf("act_seed_%02d", i+1), Workspace, a.Kind, a.Title, a.Detail, a.RefID,
			now.Add(-a.Ago)); err != nil {
			return err
		}
	}
	return nil
}

/* ------------------------------------------------------------------ helpers */

func filterContacts(in []ContactRef, keep func(ContactRef) bool) []ContactRef {
	out := make([]ContactRef, 0, len(in))
	for _, c := range in {
		if keep(c) {
			out = append(out, c)
		}
	}
	return out
}

func hasTag(tags []string, want string) bool {
	for _, t := range tags {
		if t == want {
			return true
		}
	}
	return false
}

func toJSON(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
