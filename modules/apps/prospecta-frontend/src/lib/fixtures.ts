import type {
  AgentRunEvent,
  Campaign,
  Company,
  Conversation,
  ConversationDetail,
  Lead,
  LeadDetail,
  Message,
  Paged,
} from "./types";

// Projeções do poc.pen §V1 usadas como fallback enquanto a API não responde
// (ou quando a chave ainda não foi configurada). Não substituem o backend —
// só garantem que o design apareça por inteiro.

export const COMPANY: Company = {
  id: "c-northwind",
  name: "Northwind Log",
  site: "northwindlog.com.br",
  description:
    "Software de gestão de frotas e roteirização para transportadoras e operadores logísticos de médio porte.",
  icp: {
    definition:
      "Logística B2B, 50–500 funcionários, Sudeste, com sinais de expansão de frota ou novos centros de distribuição.",
    signals: ["Logística B2B", "50–500 func.", "Sudeste", "Expansão de frota"],
  },
};

export const CAMPAIGNS: Paged<Campaign> = {
  items: [
    { id: "camp-12", name: "Logística Sudeste", status: "running", channels: ["email", "whatsapp"], leads_count: 128 },
    { id: "camp-11", name: "Healthtech SP", status: "draft", channels: ["email"], leads_count: 0 },
    { id: "camp-9", name: "Varejo — Expansão", status: "done", channels: ["email", "whatsapp"], leads_count: 342 },
  ],
  next: null,
};

export const LEADS: Lead[] = [
  { id: "l1", company_name: "Nordeste Log", segment: "Logística B2B", channel: "email", fit: 94, status: "qualified", source_url: "nordestelog.com.br" },
  { id: "l2", company_name: "Vetra Saúde", segment: "Healthtech", channel: "email", fit: 91, status: "qualified", source_url: "vetrasaude.com.br" },
  { id: "l3", company_name: "Studio Lima", segment: "Agência", channel: "whatsapp", fit: 88, status: "replied", source_url: "studiolima.com" },
  { id: "l4", company_name: "Café Aurora", segment: "Varejo", channel: "whatsapp", fit: 82, status: "replied", source_url: "cafeaurora.com.br" },
  { id: "l5", company_name: "TecnoParts", segment: "Indústria", channel: "email", fit: 74, status: "contacted", source_url: "tecnoparts.com.br" },
  { id: "l6", company_name: "Solar Vale", segment: "Energia", channel: "email", fit: 69, status: "contacted", source_url: "solarvale.com.br" },
];

export const CONVERSATIONS: Conversation[] = [
  { id: "cv1", lead_id: "l1", company_name: "Nordeste Log", channel: "email", last_message: "Pode me mandar um material…", unread: true, state: "replied" },
  { id: "cv2", lead_id: "l2", company_name: "Vetra Saúde", channel: "email", last_message: "Ótimo, fechamos para terça", unread: false, state: "meeting" },
  { id: "cv3", lead_id: "l3", company_name: "Studio Lima", channel: "whatsapp", last_message: "Qual o valor do plano?", unread: false, state: "replied" },
  { id: "cv4", lead_id: "l4", company_name: "Café Aurora", channel: "whatsapp", last_message: "Ainda avaliando internamente", unread: false, state: "replied" },
  { id: "cv5", lead_id: "l5", company_name: "TecnoParts", channel: "email", last_message: "Vou repassar ao time", unread: false, state: "replied" },
];

export const CONVERSATION_DETAIL: ConversationDetail = {
  ...CONVERSATIONS[0],
  messages: [
    {
      id: "m1",
      channel: "email",
      direction: "out",
      status: "sent",
      content:
        "Olá, Carlos. Vi que a Nordeste Log abriu um novo CD em Campinas — parabéns pela expansão. Faz sentido conversarmos sobre qualificação de leads?",
    },
    {
      id: "m2",
      channel: "email",
      direction: "in",
      status: "received",
      content: "Oi! Interessante. Pode me mandar um material sobre como funciona?",
    },
    {
      id: "m3",
      channel: "email",
      direction: "out",
      status: "sent",
      content:
        "Claro! Envio em anexo um resumo de 2 páginas e um case de logística que reduziu o custo por lead em 38%.",
    },
  ],
};

export const LEAD_DETAIL: LeadDetail = {
  ...LEADS[0],
  enriched: {
    Decisor: "Carlos Menezes · CFO",
    "E-mail": "c.menezes@nordestelog.com.br",
    Telefone: "+55 19 9 8x0x-xx12",
    Sinal: "Novo CD em Campinas",
    "Encontrado por": "Agente · varredura web",
  },
  timeline: [
    { label: "Encontrado", detail: "Web scan · fit 94", tone: "done" },
    { label: "Abordagem enviada", detail: "E-mail personalizado", tone: "done" },
    { label: "Respondeu", detail: "há 2 dias · pediu material", tone: "current" },
  ],
  last_message: {
    id: "lm1",
    channel: "email",
    direction: "in",
    status: "received",
    content: "Oi! Interessante. Pode me mandar um material sobre como funciona?",
  },
  agent_summary:
    "Empresa expandindo frota; fit alto com o ICP. Decisor financeiro responde melhor por e-mail no início da manhã. Sinais de contratação em TI sugerem orçamento ativo.",
};

// Estado inicial do feed (o SSE acrescenta por cima).
export const ACTIVITY_SEED: { at: string; verb: string; obj: string; ctx: string }[] = [
  { at: "14:02", verb: "Encontrou", obj: "Café Aurora", ctx: "message from web" },
  { at: "13:58", verb: "Abordou via", obj: "WhatsApp", ctx: "Nordeste Log" },
  { at: "13:51", verb: "Qualificou", obj: "Vetra Saúde", ctx: "ICP match 92%" },
  { at: "13:44", verb: "Escreveu", obj: "8 e-mails", ctx: "campanha #12" },
  { at: "13:30", verb: "Reunião marcada", obj: "Studio Lima", ctx: "ter, 10h" },
];

// Runs do painel de agentes do Cockpit enquanto o SSE não emite.
export const AGENT_RUNS: { agent: string; task: string; pct: number }[] = [
  { agent: "Prospectando", task: "Varrendo sites de logística B2B no Sudeste", pct: 68 },
  { agent: "Pesquisando web", task: "Enriquecendo dados de 12 empresas", pct: 42 },
  { agent: "Escrevendo", task: "Redigindo 8 abordagens por e-mail", pct: 25 },
];

export const AGENT_PLAN: { title: string; desc: string; done: boolean }[] = [
  { title: "Buscar prospects", desc: "Varredura web por sinais de expansão de frota", done: true },
  { title: "Qualificar com IA", desc: "Score de fit contra o ICP descrito", done: true },
  { title: "Enriquecer dados", desc: "Razão social, decisor, e-mail corporativo", done: true },
  { title: "Redigir abordagem", desc: "Mensagem personalizada por lead", done: false },
];

export const AGENT_TEAM: { name: string; role: string; on: boolean }[] = [
  { name: "Prospectador", role: "Varre a web por prospects", on: true },
  { name: "Pesquisador", role: "Enriquece dados e valida sinais", on: true },
  { name: "Redator", role: "Escreve abordagens personalizadas", on: true },
  { name: "Qualificador", role: "Pontua o fit contra o ICP", on: false },
];

export const METRICS: { label: string; value: string; delta: string; period: string }[] = [
  { label: "Leads qualificados", value: "1.284", delta: "+18%", period: "vs. mês anterior" },
  { label: "Reuniões agendadas", value: "87", delta: "+12%", period: "vs. mês anterior" },
  { label: "Taxa de resposta", value: "31%", delta: "+4pts", period: "vs. mês anterior" },
  { label: "Custo por lead", value: "R$ 6,20", delta: "-22%", period: "vs. mês anterior" },
];

export function messageFromRun(event: AgentRunEvent): { at: string; verb: string; obj: string; ctx: string } {
  const now = new Date();
  const at = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const metric = event.metric ? Object.entries(event.metric)[0] : undefined;
  return {
    at,
    verb: event.state === "running" ? "Rodando" : event.state === "done" ? "Concluiu" : "Estado",
    obj: event.agent,
    ctx: metric ? `${metric[0]} ${metric[1]}` : event.run_id,
  };
}

export type { Message };
