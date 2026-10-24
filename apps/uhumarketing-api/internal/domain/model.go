// Package domain é o núcleo do uhumarketing-api: os tipos que a API devolve,
// as validações e as regras que não dependem de HTTP nem de banco.
//
// Os tipos espelham de propósito o shape de
// modules/apps/uhumarketing-frontend/src/lib/types.ts. A SPA fala este
// contrato direto, sem camada de tradução: se um campo mudar aqui, muda lá, e
// o TypeScript acusa na hora.
//
// A regra central do produto mora aqui e em nenhum outro lugar: marketing só
// sai com template aprovado, número configurado e consentimento registrado.
// Se essa regra vazar para o handler ou para o worker, um caminho novo em
// algum lugar fura o opt-in — e o custo disso é o número banido.
package domain

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

/* ------------------------------------------------------------------ erros */

var (
	ErrNotFound = errors.New("não encontrado")
	ErrConflict = errors.New("conflito")
	// ErrUnauthorized é "não sei quem você é" — diferente de "não pode":
	// aqui a resposta é 401 e o cliente deve tentar entrar de novo.
	ErrUnauthorized = errors.New("não autenticado")
)

// ValidationError é o que o handler traduz em 422 com a mensagem exata que o
// operador precisa ler na tela.
type ValidationError struct {
	Field   string
	Message string
}

func (e ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

func Invalid(field, msg string) error { return ValidationError{Field: field, Message: msg} }

/* --------------------------------------------------------------- workspace */

type Workspace struct {
	Name           string     `json:"name"`
	Segment        string     `json:"segment"`
	Site           string     `json:"site"`
	Timezone       string     `json:"timezone"`
	Plan           string     `json:"plan"`
	WhatsAppNumber string     `json:"whatsappNumber"`
	EmailSender    string     `json:"emailSender"`
	Quality        string     `json:"quality"`
	MessagingLimit string     `json:"messagingLimit"`
	OptInPolicy    string     `json:"optInPolicy"`
	QuietHours     QuietHours `json:"quietHours"`
}

type QuietHours struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type User struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

/* --------------------------------------------------------------- templates */

type TemplateHeader struct {
	Kind      string `json:"kind"`
	Text      string `json:"text,omitempty"`
	MediaHint string `json:"mediaHint,omitempty"`
}

type TemplateButton struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Value string `json:"value,omitempty"`
}

type TemplateVariable struct {
	Index   string `json:"index"`
	Label   string `json:"label"`
	Example string `json:"example"`
}

// TemplateMetrics é derivado dos envios (ver store.TemplateMetrics), não um
// contador guardado: contador que só sobe nunca é corrigido quando o webhook
// diz que a mensagem falhou.
type TemplateMetrics struct {
	Sent      int `json:"sent"`
	Delivered int `json:"delivered"`
	Read      int `json:"read"`
	Replied   int `json:"replied"`
	Clicked   int `json:"clicked"`
	Failed    int `json:"failed"`
}

type Template struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	DisplayName     string             `json:"displayName"`
	Channel         string             `json:"channel"`
	Category        string             `json:"category"`
	Language        string             `json:"language"`
	Status          string             `json:"status"`
	Header          TemplateHeader     `json:"header"`
	Body            string             `json:"body"`
	Footer          string             `json:"footer"`
	Buttons         []TemplateButton   `json:"buttons"`
	Variables       []TemplateVariable `json:"variables"`
	MetaID          string             `json:"metaId"`
	Quality         int                `json:"quality"`
	Metrics         TemplateMetrics    `json:"metrics"`
	CreatedAt       time.Time          `json:"createdAt"`
	UpdatedAt       time.Time          `json:"updatedAt"`
	RejectionReason string             `json:"rejectionReason,omitempty"`
}

// TemplateInput é o que a tela manda ao criar/editar. O status nunca vem do
// cliente: quem decide é a Meta, via submissão e webhook.
type TemplateInput struct {
	Name        string             `json:"name"`
	DisplayName string             `json:"displayName"`
	Channel     string             `json:"channel"`
	Category    string             `json:"category"`
	Language    string             `json:"language"`
	Header      TemplateHeader     `json:"header"`
	Body        string             `json:"body"`
	Footer      string             `json:"footer"`
	Buttons     []TemplateButton   `json:"buttons"`
	Variables   []TemplateVariable `json:"variables"`
}

var snakeCase = regexp.MustCompile(`^[a-z0-9_]{2,60}$`)
var placeholderRE = regexp.MustCompile(`\{\{\s*(\d+)\s*\}\}`)

// Validate aplica as regras que a Meta aplica no painel — antes de gastar uma
// submissão (e a espera de análise) com algo que seria rejeitado de imediato.
func (in *TemplateInput) Validate() error {
	in.Name = strings.TrimSpace(in.Name)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	in.Body = strings.TrimSpace(in.Body)
	in.Footer = strings.TrimSpace(in.Footer)
	if in.Channel == "" {
		in.Channel = "whatsapp"
	}
	if in.Language == "" {
		in.Language = "pt_BR"
	}
	if !snakeCase.MatchString(in.Name) {
		return Invalid("name", "use snake_case, 2–60 caracteres (ex.: reativacao_cupom_volta)")
	}
	if len([]rune(in.DisplayName)) < 3 {
		return Invalid("displayName", "dê um nome legível para o time")
	}
	switch in.Category {
	case "marketing", "utility", "authentication":
	default:
		return Invalid("category", "use marketing, utility ou authentication")
	}
	if len([]rune(in.Body)) < 10 {
		return Invalid("body", "o corpo precisa ter pelo menos uma frase")
	}
	if len(in.Buttons) > 3 {
		return Invalid("buttons", "a Meta aceita no máximo 3 botões")
	}
	for _, b := range in.Buttons {
		if strings.TrimSpace(b.Text) == "" {
			return Invalid("buttons", "todo botão precisa de texto")
		}
		if (b.Type == "url" || b.Type == "phone") && strings.TrimSpace(b.Value) == "" {
			return Invalid("buttons", "botão de URL/telefone precisa de destino")
		}
	}

	// Cada placeholder usado no corpo/cabeçalho precisa de exemplo. É a causa
	// número um de rejeição: o revisor vê {{3}} sem nenhum valor de amostra.
	declared := map[string]bool{}
	for _, v := range in.Variables {
		if strings.TrimSpace(v.Example) == "" {
			return Invalid("variables", fmt.Sprintf("a variável {{%s}} precisa de um exemplo", v.Index))
		}
		declared[v.Index] = true
	}
	for _, idx := range Placeholders(in.Body) {
		if !declared[idx] {
			return Invalid("variables", fmt.Sprintf("o corpo usa {{%s}} mas não há exemplo para ela", idx))
		}
	}
	if in.Header.Kind == "text" {
		for _, idx := range Placeholders(in.Header.Text) {
			if !declared[idx] {
				return Invalid("variables", fmt.Sprintf("o cabeçalho usa {{%s}} mas não há exemplo para ela", idx))
			}
		}
	}
	if in.Buttons == nil {
		in.Buttons = []TemplateButton{}
	}
	if in.Variables == nil {
		in.Variables = []TemplateVariable{}
	}
	if in.Header.Kind == "" {
		in.Header.Kind = "none"
	}
	return nil
}

// Placeholders devolve os índices usados em "{{n}}" numa string.
func Placeholders(s string) []string {
	matches := placeholderRE.FindAllStringSubmatch(s, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		out = append(out, m[1])
	}
	return out
}

// ParamValues devolve os valores das variáveis na ordem dos índices — que é a
// ordem que a Cloud API exige em components[].parameters (a Meta casa pela
// posição, não pelo rótulo).
func (t Template) ParamValues(values map[string]string) []string {
	if len(t.Variables) == 0 {
		return nil
	}
	type pair struct {
		n   int
		val string
	}
	pairs := make([]pair, 0, len(t.Variables))
	for _, v := range t.Variables {
		n, err := strconv.Atoi(v.Index)
		if err != nil {
			n = 0
		}
		val := strings.TrimSpace(values[v.Index])
		if val == "" {
			val = v.Example
		}
		pairs = append(pairs, pair{n, val})
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].n < pairs[j].n })
	out := make([]string, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, p.val)
	}
	return out
}

/* ---------------------------------------------------------------- contatos */

type Contact struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Phone          string     `json:"phone"`
	Email          string     `json:"email"`
	City           string     `json:"city"`
	UF             string     `json:"uf"`
	Tags           []string   `json:"tags"`
	Source         string     `json:"source"`
	Plan           string     `json:"plan,omitempty"`
	LastPurchaseAt *time.Time `json:"lastPurchaseAt,omitempty"`
	TotalSpent     float64    `json:"totalSpent,omitempty"`
	Orders         int        `json:"orders,omitempty"`
	OptIn          bool       `json:"optIn"`
	OptInSource    string     `json:"optInSource,omitempty"`
	OptInAt        *time.Time `json:"optInAt,omitempty"`
	OptOutAt       *time.Time `json:"optOutAt,omitempty"`
}

// phoneRE aceita E.164 com ou sem "+" e sem separadores. A API não adivinha
// DDI: quem importa a lista é que normaliza.
var phoneRE = regexp.MustCompile(`^\+?[1-9]\d{7,14}$`)

func NormalizePhone(raw string) (string, error) {
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "", "/", "").Replace(strings.TrimSpace(raw))
	if !phoneRE.MatchString(p) {
		return "", Invalid("phone", "telefone precisa de DDI+DDD+número, só dígitos (ex.: 5511988887777)")
	}
	return strings.TrimPrefix(p, "+"), nil
}

func (c *Contact) Validate() error {
	c.Name = strings.TrimSpace(c.Name)
	if len([]rune(c.Name)) < 2 {
		return Invalid("name", "informe o nome do contato")
	}
	phone, err := NormalizePhone(c.Phone)
	if err != nil {
		return err
	}
	c.Phone = phone
	if c.Tags == nil {
		c.Tags = []string{}
	}
	return nil
}

// CanReceiveMarketing é a única porta de entrada para um disparo. O nome é
// comprido de propósito: quem ler `if !c.CanReceiveMarketing()` no worker
// entende na hora por que a mensagem não sai.
func (c Contact) CanReceiveMarketing() bool {
	return c.OptIn && c.OptOutAt == nil
}

/* -------------------------------------------------------------- audiências */

type SegmentRule struct {
	ID       string `json:"id"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

type Segment struct {
	ID            string        `json:"id"`
	Name          string        `json:"name"`
	Description   string        `json:"description"`
	Kind          string        `json:"kind"`
	ContactsCount int           `json:"contactsCount"`
	Rules         []SegmentRule `json:"rules"`
	Source        string        `json:"source"`
	UpdatedAt     time.Time     `json:"updatedAt"`
	Sample        []Contact     `json:"sample"`
}

type SegmentInput struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Kind        string        `json:"kind"`
	Rules       []SegmentRule `json:"rules"`
	Source      string        `json:"source"`
}

func (in *SegmentInput) Validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if len([]rune(in.Name)) < 3 {
		return Invalid("name", "dê um nome à audiência")
	}
	if in.Kind == "" {
		in.Kind = "dynamic"
	}
	switch in.Kind {
	case "static", "dynamic", "import":
	default:
		return Invalid("kind", "use static, dynamic ou import")
	}
	if in.Rules == nil {
		in.Rules = []SegmentRule{}
	}
	for _, r := range in.Rules {
		if r.Field == "" {
			return Invalid("rules", "toda regra precisa de um campo")
		}
		if r.Operator == "" {
			return Invalid("rules", "toda regra precisa de um operador")
		}
	}
	return nil
}

/* ---------------------------------------------------------------- campanha */

type Schedule struct {
	StartAt           string `json:"startAt"`
	EndAt             string `json:"endAt,omitempty"`
	WindowStart       int    `json:"windowStart"`
	WindowEnd         int    `json:"windowEnd"`
	Days              []int  `json:"days"`
	ThrottlePerMinute int    `json:"throttlePerMinute"`
	Timezone          string `json:"timezone"`
}

type Offer struct {
	Enabled       bool   `json:"enabled"`
	Kind          string `json:"kind"`
	CodePattern   string `json:"codePattern"`
	DiscountLabel string `json:"discountLabel"`
	ValidUntil    string `json:"validUntil"`
}

type CampaignMetrics struct {
	Audience  int     `json:"audience"`
	Queued    int     `json:"queued"`
	Sent      int     `json:"sent"`
	Delivered int     `json:"delivered"`
	Read      int     `json:"read"`
	Replied   int     `json:"replied"`
	Converted int     `json:"converted"`
	Failed    int     `json:"failed"`
	OptOut    int     `json:"optOut"`
	Revenue   float64 `json:"revenue"`
}

type Campaign struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Objective        string          `json:"objective"`
	Status           string          `json:"status"`
	Channel          string          `json:"channel"`
	TemplateID       string          `json:"templateId"`
	SegmentIDs       []string        `json:"segmentIds"`
	FlowID           string          `json:"flowId,omitempty"`
	Schedule         Schedule        `json:"schedule"`
	Offer            Offer           `json:"offer"`
	RequiresApproval bool            `json:"requiresApproval"`
	Metrics          CampaignMetrics `json:"metrics"`
	CreatedAt        time.Time       `json:"createdAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
	LastRunAt        *time.Time      `json:"lastRunAt,omitempty"`
	Notes            string          `json:"notes,omitempty"`
}

type CampaignInput struct {
	Name             string   `json:"name"`
	Objective        string   `json:"objective"`
	Status           string   `json:"status"`
	Channel          string   `json:"channel"`
	TemplateID       string   `json:"templateId"`
	SegmentIDs       []string `json:"segmentIds"`
	FlowID           string   `json:"flowId"`
	Schedule         Schedule `json:"schedule"`
	Offer            Offer    `json:"offer"`
	RequiresApproval bool     `json:"requiresApproval"`
	Notes            string   `json:"notes"`
}

func (in *CampaignInput) Validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if len([]rune(in.Name)) < 3 {
		return Invalid("name", "informe o nome da campanha")
	}
	if in.TemplateID == "" {
		return Invalid("templateId", "escolha o template que será enviado")
	}
	if len(in.SegmentIDs) == 0 {
		return Invalid("segmentIds", "escolha pelo menos uma audiência")
	}
	if in.Channel == "" {
		in.Channel = "whatsapp"
	}
	switch in.Objective {
	case "reativacao", "conversao", "awareness", "pos_venda":
	default:
		in.Objective = "conversao"
	}
	if in.Status == "" {
		in.Status = "draft"
	}
	switch in.Status {
	case "draft", "scheduled", "running", "paused", "finished":
	default:
		return Invalid("status", "use draft, scheduled, running, paused ou finished")
	}
	if in.Schedule.ThrottlePerMinute <= 0 {
		in.Schedule.ThrottlePerMinute = 60
	}
	if in.Schedule.Timezone == "" {
		in.Schedule.Timezone = "America/Sao_Paulo"
	}
	if in.Schedule.WindowStart == 0 && in.Schedule.WindowEnd == 0 {
		in.Schedule.WindowStart, in.Schedule.WindowEnd = 9, 18
	}
	if len(in.Schedule.Days) == 0 {
		in.Schedule.Days = []int{1, 2, 3, 4, 5}
	}
	if in.SegmentIDs == nil {
		in.SegmentIDs = []string{}
	}
	return nil
}

/* -------------------------------------------------------------------- fluxo */

type FlowNode struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Title    string         `json:"title"`
	X        float64        `json:"x"`
	Y        float64        `json:"y"`
	Config   map[string]any `json:"config"`
	Disabled bool           `json:"disabled,omitempty"`
}

type FlowEdge struct {
	ID     string `json:"id"`
	From   string `json:"from"`
	To     string `json:"to"`
	Branch string `json:"branch,omitempty"`
}

type FlowRuns struct {
	Total   int `json:"total"`
	Success int `json:"success"`
	Failed  int `json:"failed"`
}

type Flow struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Nodes       []FlowNode `json:"nodes"`
	Edges       []FlowEdge `json:"edges"`
	CampaignID  string     `json:"campaignId,omitempty"`
	Runs        FlowRuns   `json:"runs"`
	LastRunAt   *time.Time `json:"lastRunAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// FlowInput é o documento inteiro do editor: a SPA salva o grafo completo, não
// operações por nó. Um PATCH por nó durante um arrasto geraria dezenas de
// requisições e um estado intermediário que ninguém quer persistir.
type FlowInput struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Nodes       []FlowNode `json:"nodes"`
	Edges       []FlowEdge `json:"edges"`
	CampaignID  string     `json:"campaignId"`
}

func (in *FlowInput) Validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if len([]rune(in.Name)) < 3 {
		return Invalid("name", "dê um nome ao fluxo")
	}
	if in.Status == "" {
		in.Status = "draft"
	}
	switch in.Status {
	case "draft", "active", "paused":
	default:
		return Invalid("status", "use draft, active ou paused")
	}
	if len(in.Nodes) == 0 {
		return Invalid("nodes", "um fluxo precisa de pelo menos um nó")
	}
	ids := map[string]bool{}
	for _, n := range in.Nodes {
		ids[n.ID] = true
	}
	// Aresta órfã é o erro silencioso do editor: o nó sumiu e a conexão ficou.
	for _, e := range in.Edges {
		if !ids[e.From] || !ids[e.To] {
			return Invalid("edges", "há conexão apontando para um nó que não existe")
		}
	}
	if in.Nodes == nil {
		in.Nodes = []FlowNode{}
	}
	if in.Edges == nil {
		in.Edges = []FlowEdge{}
	}
	return nil
}

/* ------------------------------------------------------------------- envios */

type Send struct {
	ID           string    `json:"id"`
	CampaignID   string    `json:"campaignId"`
	ContactName  string    `json:"contactName"`
	Destination  string    `json:"destination"`
	TemplateName string    `json:"templateName"`
	Status       string    `json:"status"`
	At           time.Time `json:"at"`
	CouponCode   string    `json:"couponCode,omitempty"`
	Error        string    `json:"error,omitempty"`
	Cost         float64   `json:"cost"`
}

// StatusRank ordena a evolução: um webhook fora de ordem ("lido" antes de
// "entregue") não pode fazer o envio regredir.
func StatusRank(s string) int {
	switch s {
	case "queued":
		return 0
	case "sent":
		return 1
	case "delivered":
		return 2
	case "read":
		return 3
	case "replied":
		return 4
	case "failed", "skipped":
		return 5
	}
	return -1
}

func Advances(current, next string) bool {
	if current == "failed" || current == "skipped" {
		return false
	}
	return StatusRank(next) > StatusRank(current)
}

/* ---------------------------------------------------------------- atividade */

type ActivityEvent struct {
	ID     string    `json:"id"`
	At     time.Time `json:"at"`
	Kind   string    `json:"kind"`
	Title  string    `json:"title"`
	Detail string    `json:"detail"`
	RefID  string    `json:"refId,omitempty"`
}

/* --------------------------------------------------------------- audiência */

// MatchContact avalia as regras de descobrimento de uma audiência. Fica em Go
// (e não em SQL) porque a base da POC é pequena e a regra é editada na tela a
// qualquer momento; quando crescer, isto vira SQL gerado — mas o contrato
// (campo, operador, valor) é este.
func MatchContact(c Contact, rules []SegmentRule, combinator string) bool {
	if len(rules) == 0 {
		return true
	}
	or := strings.EqualFold(combinator, "or")
	for _, r := range rules {
		ok := matchRule(c, r)
		if or {
			if ok {
				return true
			}
			continue
		}
		if !ok {
			return false
		}
	}
	return !or
}

func matchRule(c Contact, r SegmentRule) bool {
	want := strings.ToLower(strings.TrimSpace(r.Value))
	op := strings.ToLower(r.Operator)

	switch r.Field {
	case "tag":
		for _, t := range c.Tags {
			if tagMatch(strings.ToLower(t), op, want) {
				return true
			}
		}
		return false
	case "ultima_compra":
		if c.LastPurchaseAt == nil {
			return false
		}
		days := time.Since(*c.LastPurchaseAt).Hours() / 24
		return compareNumber(days, op, r.Value)
	case "total_gasto":
		return compareNumber(c.TotalSpent, op, r.Value)
	case "pedidos":
		return compareNumber(float64(c.Orders), op, r.Value)
	case "opt_in":
		actual := "false"
		if c.OptIn {
			actual = "true"
		}
		switch op {
		case "neq":
			return actual != want
		case "eq", "":
			return actual == want || want == "sim" && actual == "true" || want == "1" && actual == "true"
		}
		return false
	}

	var actual string
	switch r.Field {
	case "cidade":
		actual = c.City
	case "uf":
		actual = c.UF
	case "origem":
		actual = c.Source
	case "plano":
		actual = c.Plan
	default:
		return false
	}
	actual = strings.ToLower(actual)
	switch op {
	case "neq":
		return actual != want
	case "contains":
		return strings.Contains(actual, want)
	case "eq", "":
		return actual == want
	}
	return false
}

func tagMatch(actual, op, want string) bool {
	switch op {
	case "neq":
		return actual != want
	case "in_days":
		return false
	default: // eq / contains / vazio
		return actual == want || strings.Contains(actual, want)
	}
}

func compareNumber(actual float64, op, raw string) bool {
	raw = strings.ReplaceAll(strings.TrimSpace(raw), ",", ".")
	want, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return false
	}
	switch op {
	case "gt":
		return actual > want
	case "lt":
		return actual < want
	case "eq":
		return actual == want
	case "neq":
		return actual != want
	case "in_days":
		return actual <= want
	}
	return false
}

/* -------------------------------------------------------------------- série */

// MetricPoint é um dia de funil. O status do envio é o mais avançado que ele
// alcançou, então os campos são cumulativos: um "read" também conta em
// sent/delivered. Ler como etapas independentes encolheria o topo do funil.
type MetricPoint struct {
	Date      string `json:"date"`
	Sent      int    `json:"sent"`
	Delivered int    `json:"delivered"`
	Read      int    `json:"read"`
	Replied   int    `json:"replied"`
}
