// Dados de exemplo da POC. O negócio fictício é o "Café Aurora" — uma
// torrefação de café especial que vende D2C (site + assinatura) e usa
// WhatsApp como canal principal. Tudo aqui é ilustrativo, mas com forma de
// dado real: é o suficiente para julgar produto sem inventar backend.
//
// Números são determinísticos (gerados a partir de uma semente) para a
// interface não mudar a cada reload.

import type {
  ActivityEvent,
  Campaign,
  Contact,
  Flow,
  MetricPoint,
  Segment,
  Send,
  Template,
  User,
  Workspace,
} from "./types";

/* --------------------------------------------------------------- relógio */

const NOW = new Date();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** ISO de "agora menos X". */
function back(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

/** ISO com hora fixa de hoje/ontem, para carimbos mais "de calendário". */
function at(daysAgo: number, hour = 9, minute = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/* ------------------------------------------------------------ workspace */

export const WORKSPACE: Workspace = {
  name: "Café Aurora",
  segment: "Torrefação de café especial · D2C",
  site: "cafeaurora.com.br",
  timezone: "America/Sao_Paulo",
  plan: "Growth",
  whatsappNumber: "+55 11 91234-5678",
  emailSender: "time@cafeaurora.com.br",
  quality: "green",
  messagingLimit: "100 mil conversas / 24h",
  optInPolicy: "Opt-in explícito no checkout e no clube de assinatura; opt-out em 1 clique.",
  quietHours: { start: 21, end: 8 },
};

export const USER: User = {
  name: "Marina Reis",
  email: "marina@cafeaurora.com.br",
  role: "Head de Growth",
};

/* --------------------------------------------------------------- templates */

export const TEMPLATES: Template[] = [
  {
    id: "tpl_reativacao_cupom",
    name: "reativacao_cupom_volta",
    displayName: "Volta pro café — cupom pessoal",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "approved",
    header: { kind: "image", mediaHint: "torra-do-mes.jpg" },
    body:
      "Oi, {{1}}! Faz tempo que você não passa por aqui ☕\n\nSeparamos um cupom só seu: *{{2}}* com {{3}} de desconto na próxima compra.\n\nVale até {{4}}.",
    footer: "Café Aurora · cupom válido no site e no clube",
    buttons: [
      { type: "url", text: "Usar meu cupom", value: "https://cafeaurora.com.br/c/{{2}}" },
      { type: "quick_reply", text: "Não quero receber" },
    ],
    variables: [
      { index: "1", label: "Primeiro nome", example: "Ana" },
      { index: "2", label: "Cupom", example: "VOLTA15" },
      { index: "3", label: "Desconto", example: "15%" },
      { index: "4", label: "Validade", example: "30/11" },
    ],
    metaId: "wba_tpl_88213",
    quality: 92,
    metrics: { sent: 8420, delivered: 8180, read: 6742, replied: 1183, clicked: 2140, failed: 120 },
    createdAt: at(120, 10),
    updatedAt: at(4, 16, 20),
  },
  {
    id: "tpl_clube_convite",
    name: "clube_assinatura_convite",
    displayName: "Convite para o Clube Aurora",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "approved",
    header: { kind: "text", text: "Seu café, todo mês, sem pensar" },
    body:
      "{{1}}, o Clube Aurora manda uma torra fresca por mês, escolhida pelo nosso mestre de torra.\n\nA partir de R$ 59/mês, você cancela quando quiser. Quer experimentar?",
    footer: "Frete grátis em todo o Brasil",
    buttons: [
      { type: "url", text: "Conhecer o clube", value: "https://cafeaurora.com.br/clube" },
      { type: "quick_reply", text: "Me conta mais" },
    ],
    variables: [{ index: "1", label: "Primeiro nome", example: "Ana" }],
    metaId: "wba_tpl_88190",
    quality: 97,
    metrics: { sent: 5210, delivered: 5094, read: 4402, replied: 894, clicked: 1512, failed: 58 },
    createdAt: at(210, 11),
    updatedAt: at(11, 9, 40),
  },
  {
    id: "tpl_lancamento_origem",
    name: "lancamento_origem_especial",
    displayName: "Lançamento: nova origem",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "approved",
    header: { kind: "image", mediaHint: "nova-origem.jpg" },
    body:
      "Chegou a {{1}} 🌱\n\nNotas de {{2}}, torra média. Lote limitado de {{3}} sacas — quem é do clube tem prioridade na compra.\n\nQuer garantir o seu?",
    footer: "Café Aurora · microlotes",
    buttons: [{ type: "url", text: "Ver o lote", value: "https://cafeaurora.com.br/origens/{{1}}" }],
    variables: [
      { index: "1", label: "Origem", example: "Etiópia Guji" },
      { index: "2", label: "Notas", example: "jasmim e pêssego" },
      { index: "3", label: "Sacas", example: "80" },
    ],
    metaId: "wba_tpl_88951",
    quality: 88,
    metrics: { sent: 3105, delivered: 2980, read: 2401, replied: 402, clicked: 760, failed: 41 },
    createdAt: at(60, 14),
    updatedAt: at(2, 10, 5),
  },
  {
    id: "tpl_carrinho",
    name: "carrinho_abandonado_1h",
    displayName: "Carrinho abandonado (1h)",
    channel: "whatsapp",
    category: "utility",
    language: "pt_BR",
    status: "approved",
    header: { kind: "none" },
    body: "{{1}}, seu carrinho com {{2}} ainda está esperando. Reservamos por mais 24h — finaliza quando quiser.",
    footer: "Café Aurora",
    buttons: [{ type: "url", text: "Voltar ao carrinho", value: "https://cafeaurora.com.br/carrinho/{{3}}" }],
    variables: [
      { index: "1", label: "Primeiro nome", example: "Ana" },
      { index: "2", label: "Produto", example: "2 itens" },
      { index: "3", label: "Id do carrinho", example: "c_1234" },
    ],
    metaId: "wba_tpl_88310",
    quality: 95,
    metrics: { sent: 12840, delivered: 12602, read: 10521, replied: 2210, clicked: 5320, failed: 238 },
    createdAt: at(300, 9),
    updatedAt: at(6, 18, 12),
  },
  {
    id: "tpl_pedido",
    name: "confirmacao_pedido",
    displayName: "Confirmação de pedido",
    channel: "whatsapp",
    category: "utility",
    language: "pt_BR",
    status: "approved",
    header: { kind: "document", mediaHint: "pedido.pdf" },
    body:
      "Pedido *{{1}}* confirmado ✅\n\n{{2}}\nTotal: {{3}}\n\nEnviamos o rastreio aqui assim que a torra sair.",
    footer: "Café Aurora",
    buttons: [{ type: "url", text: "Acompanhar pedido", value: "https://cafeaurora.com.br/pedidos/{{1}}" }],
    variables: [
      { index: "1", label: "Número do pedido", example: "A-10293" },
      { index: "2", label: "Resumo dos itens", example: "1x Aurora Blend 250g" },
      { index: "3", label: "Total", example: "R$ 74,00" },
    ],
    metaId: "wba_tpl_88002",
    quality: 99,
    metrics: { sent: 31250, delivered: 30980, read: 28110, replied: 4021, clicked: 9801, failed: 270 },
    createdAt: at(400, 8),
    updatedAt: at(20, 11, 33),
  },
  {
    id: "tpl_pesquisa",
    name: "pesquisa_pos_compra",
    displayName: "Pesquisa pós-compra (NPS)",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "pending",
    header: { kind: "none" },
    body: "{{1}}, como foi seu café desta semana? Uma pergunta rápida — de 0 a 10, quanto indicaria a Aurora?",
    footer: "Leva 20 segundos",
    buttons: [{ type: "quick_reply", text: "Responder agora" }],
    variables: [{ index: "1", label: "Primeiro nome", example: "Ana" }],
    metaId: "wba_tpl_89120",
    quality: 0,
    metrics: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0 },
    createdAt: at(2, 15, 10),
    updatedAt: at(2, 15, 10),
  },
  {
    id: "tpl_winback",
    name: "winback_3meses",
    displayName: "Winback 3 meses (antigo)",
    channel: "whatsapp",
    category: "utility",
    language: "pt_BR",
    status: "rejected",
    header: { kind: "none" },
    body: "{{1}}, sentimos sua falta! Volte com 20% OFF usando o cupom {{2}}.",
    footer: "Café Aurora",
    buttons: [{ type: "url", text: "Aproveitar", value: "https://cafeaurora.com.br/c/{{2}}" }],
    variables: [
      { index: "1", label: "Primeiro nome", example: "Ana" },
      { index: "2", label: "Cupom", example: "VOLTA20" },
    ],
    metaId: "wba_tpl_87440",
    quality: 0,
    metrics: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0 },
    createdAt: at(95, 10),
    updatedAt: at(93, 9),
    rejectionReason:
      "Conteúdo promocional em categoria utility. Reclassifique como marketing e reenvie — o texto em si está ok.",
  },
  {
    id: "tpl_blackfriday",
    name: "black_friday_teaser",
    displayName: "Black Friday teaser",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "paused",
    header: { kind: "image", mediaHint: "bf-teaser.jpg" },
    body: "{{1}}, na sexta o café fica com 30% OFF em tudo. Ativa o lembrete e a gente te chama na hora que abrir.",
    footer: "Café Aurora · 28/11",
    buttons: [{ type: "quick_reply", text: "Me lembrar" }],
    variables: [{ index: "1", label: "Primeiro nome", example: "Ana" }],
    metaId: "wba_tpl_87990",
    quality: 61,
    metrics: { sent: 21400, delivered: 20880, read: 13120, replied: 512, clicked: 1980, failed: 520 },
    createdAt: at(330, 10),
    updatedAt: at(310, 10),
  },
  {
    id: "tpl_aniversario",
    name: "aniversario_cliente",
    displayName: "Aniversário do cliente",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "approved",
    header: { kind: "text", text: "Parabéns, {{1}} 🎉" },
    body: "Hoje o café é por nossa conta: um brinde na sua próxima compra. Passa na loja ou pede pelo site com o cupom {{2}}.",
    footer: "Café Aurora",
    buttons: [{ type: "url", text: "Resgatar brinde", value: "https://cafeaurora.com.br/c/{{2}}" }],
    variables: [
      { index: "1", label: "Primeiro nome", example: "Ana" },
      { index: "2", label: "Cupom", example: "NIVER" },
    ],
    metaId: "wba_tpl_88520",
    quality: 90,
    metrics: { sent: 1890, delivered: 1861, read: 1620, replied: 341, clicked: 702, failed: 29 },
    createdAt: at(150, 9),
    updatedAt: at(30, 14),
  },
  {
    id: "tpl_frete",
    name: "cupom_frete_gratis",
    displayName: "Cupom frete grátis",
    channel: "whatsapp",
    category: "marketing",
    language: "pt_BR",
    status: "draft",
    header: { kind: "none" },
    body: "{{1}}, frete grátis acima de R$ 120 no seu próximo pedido. O cupom é {{2}} e vale até {{3}}.",
    footer: "Café Aurora",
    buttons: [{ type: "quick_reply", text: "Quero usar" }],
    variables: [
      { index: "1", label: "Primeiro nome", example: "Ana" },
      { index: "2", label: "Cupom", example: "FRETE0" },
      { index: "3", label: "Validade", example: "30/11" },
    ],
    metaId: "—",
    quality: 0,
    metrics: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0 },
    createdAt: back(5 * HOUR),
    updatedAt: back(30 * MIN),
  },
];

/* ---------------------------------------------------------------- contatos */

function contact(
  id: string,
  name: string,
  phone: string,
  city: string,
  uf: string,
  tags: string[],
  source: string,
  daysSincePurchase: number | null,
  totalSpent: number,
  orders: number,
): Contact {
  return {
    id,
    name,
    phone,
    email: `${name.toLowerCase().split(" ")[0]}@email.com`,
    city,
    uf,
    tags,
    source,
    lastPurchaseAt: daysSincePurchase == null ? undefined : at(daysSincePurchase, 12),
    totalSpent,
    orders,
    optIn: true,
  };
}

const CONTACTS: Contact[] = [
  contact("c1", "Ana Beatriz Lima", "+55 11 98812-4410", "São Paulo", "SP", ["cliente", "clube"], "checkout", 12, 1840, 9),
  contact("c2", "Bruno Tavares", "+55 11 99123-8877", "Campinas", "SP", ["lead", "site"], "formulário", null, 0, 0),
  contact("c3", "Camila Duarte", "+55 21 98411-2200", "Rio de Janeiro", "RJ", ["cliente", "vip"], "clube", 44, 4210, 21),
  contact("c4", "Diego Moreira", "+55 31 99772-1188", "Belo Horizonte", "MG", ["lead"], "instagram", null, 0, 0),
  contact("c5", "Elisa Prado", "+55 41 98112-5533", "Curitiba", "PR", ["cliente"], "checkout", 128, 620, 3),
  contact("c6", "Fabio Nogueira", "+55 51 99220-7744", "Porto Alegre", "RS", ["lead", "carrinho"], "site", null, 0, 0),
  contact("c7", "Gabriela Souza", "+55 11 97733-9911", "Santos", "SP", ["cliente", "clube", "vip"], "clube", 8, 6180, 34),
  contact("c8", "Henrique Aguiar", "+55 85 98844-3322", "Fortaleza", "CE", ["cliente"], "checkout", 156, 410, 2),
  contact("c9", "Isabela Rocha", "+55 11 96611-2288", "São Paulo", "SP", ["lead", "evento"], "evento", null, 0, 0),
  contact("c10", "João Pedro Alves", "+55 62 99433-1166", "Goiânia", "GO", ["cliente", "assinante"], "clube", 30, 2210, 12),
];

/* -------------------------------------------------------------- audiências */

export const SEGMENTS: Segment[] = [
  {
    id: "seg_frios",
    name: "Leads frios (90+ dias)",
    description: "Comprou alguma vez, mas não volta há mais de 90 dias. O alvo natural de reativação com cupom.",
    kind: "dynamic",
    contactsCount: 3184,
    rules: [
      { id: "r1", field: "ultima_compra", operator: "gt", value: "90" },
      { id: "r2", field: "opt_in", operator: "eq", value: "sim" },
    ],
    source: "CRM + histórico de pedidos",
    updatedAt: back(2 * HOUR),
    sample: [CONTACTS[4], CONTACTS[7], CONTACTS[1], CONTACTS[5]],
  },
  {
    id: "seg_vip",
    name: "Clientes VIP",
    description: "Gastou mais de R$ 3.000 no total ou tem 20+ pedidos. Recebe lançamentos antes de todo mundo.",
    kind: "dynamic",
    contactsCount: 412,
    rules: [
      { id: "r1", field: "total_gasto", operator: "gt", value: "3000" },
      { id: "r2", field: "opt_in", operator: "eq", value: "sim" },
    ],
    source: "CRM",
    updatedAt: back(6 * HOUR),
    sample: [CONTACTS[2], CONTACTS[6]],
  },
  {
    id: "seg_assinantes",
    name: "Assinantes do clube",
    description: "Assinatura ativa do Clube Aurora. Comunicação de benefício, não de venda dura.",
    kind: "dynamic",
    contactsCount: 1268,
    rules: [
      { id: "r1", field: "plano", operator: "eq", value: "clube" },
      { id: "r2", field: "opt_in", operator: "eq", value: "sim" },
    ],
    source: "Clube (billing)",
    updatedAt: back(1 * DAY),
    sample: [CONTACTS[0], CONTACTS[6], CONTACTS[9]],
  },
  {
    id: "seg_carrinho",
    name: "Carrinho abandonado",
    description: "Montou carrinho nas últimas 24h e não finalizou. Só entra quem não recebeu o disparo de 1h.",
    kind: "dynamic",
    contactsCount: 236,
    rules: [
      { id: "r1", field: "tag", operator: "contains", value: "carrinho" },
      { id: "r2", field: "ultima_compra", operator: "in_days", value: "1" },
    ],
    source: "Evento do site",
    updatedAt: back(20 * MIN),
    sample: [CONTACTS[5]],
  },
  {
    id: "seg_aniversario",
    name: "Aniversariantes do mês",
    description: "Aniversário no mês corrente. Dispara o brinde no dia, às 9h.",
    kind: "dynamic",
    contactsCount: 894,
    rules: [{ id: "r1", field: "tag", operator: "eq", value: "aniversario_mes" }],
    source: "CRM",
    updatedAt: back(3 * DAY),
    sample: [CONTACTS[3], CONTACTS[8]],
  },
  {
    id: "seg_lista_evento",
    name: "Lista — Feira de Café 2026",
    description: "Planilha importada do stand da feira. Opt-in assinado no tablet.",
    kind: "import",
    contactsCount: 640,
    rules: [],
    source: "Importação CSV · feira-cafe-2026.csv",
    updatedAt: at(9, 17, 40),
    sample: [CONTACTS[8], CONTACTS[3]],
  },
];

/* --------------------------------------------------------------- campanhas */

export const CAMPAIGNS: Campaign[] = [
  {
    id: "cmp_reativacao",
    name: "Reativação de leads frios — cupom pessoal",
    objective: "reativacao",
    status: "running",
    channel: "whatsapp",
    templateId: "tpl_reativacao_cupom",
    segmentIds: ["seg_frios"],
    flowId: "flow_reativacao",
    schedule: {
      startAt: at(6, 9),
      windowStart: 9,
      windowEnd: 18,
      days: [1, 2, 3, 4, 5],
      throttlePerMinute: 120,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: true,
      kind: "cupom",
      codePattern: "VOLTA-{nome}",
      discountLabel: "15% off",
      validUntil: at(-14, 23, 59),
    },
    requiresApproval: true,
    metrics: {
      audience: 3184,
      queued: 402,
      sent: 2782,
      delivered: 2694,
      read: 2108,
      replied: 361,
      converted: 187,
      failed: 88,
      optOut: 12,
      revenue: 18420,
    },
    createdAt: at(9, 15),
    updatedAt: back(40 * MIN),
    lastRunAt: back(12 * MIN),
    notes: "Cupom único por destinatário. Quem responde 'Não quero receber' sai da base em 1 clique.",
  },
  {
    id: "cmp_clube",
    name: "Convite ao Clube Aurora — base ativa",
    objective: "conversao",
    status: "finished",
    channel: "whatsapp",
    templateId: "tpl_clube_convite",
    segmentIds: ["seg_vip", "seg_assinantes"],
    flowId: "flow_clube",
    schedule: {
      startAt: at(28, 10),
      endAt: at(21, 18),
      windowStart: 10,
      windowEnd: 19,
      days: [1, 2, 3, 4, 5],
      throttlePerMinute: 80,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: false,
      kind: "cupom",
      codePattern: "",
      discountLabel: "",
      validUntil: at(40, 23, 59),
    },
    requiresApproval: false,
    metrics: {
      audience: 1680,
      queued: 0,
      sent: 1680,
      delivered: 1640,
      read: 1391,
      replied: 284,
      converted: 96,
      failed: 40,
      optOut: 6,
      revenue: 11280,
    },
    createdAt: at(30, 11),
    updatedAt: at(21, 18, 40),
    lastRunAt: at(21, 18, 12),
  },
  {
    id: "cmp_lancamento",
    name: "Lançamento Etiópia Guji — lote limitado",
    objective: "conversao",
    status: "scheduled",
    channel: "whatsapp",
    templateId: "tpl_lancamento_origem",
    segmentIds: ["seg_vip", "seg_assinantes"],
    flowId: "flow_lancamento",
    schedule: {
      startAt: at(-2, 9),
      windowStart: 9,
      windowEnd: 18,
      days: [1, 2, 3, 4, 5],
      throttlePerMinute: 60,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: true,
      kind: "brinde",
      codePattern: "GUJI-{nome}",
      discountLabel: "brinde de 100g",
      validUntil: at(-16, 23, 59),
    },
    requiresApproval: true,
    metrics: {
      audience: 1680,
      queued: 1680,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      converted: 0,
      failed: 0,
      optOut: 0,
      revenue: 0,
    },
    createdAt: at(4, 16),
    updatedAt: back(3 * HOUR),
    notes: "Aguardando aprovação do fluxo. Clube tem prioridade de compra nas primeiras 24h.",
  },
  {
    id: "cmp_carrinho",
    name: "Carrinho abandonado (1h)",
    objective: "conversao",
    status: "running",
    channel: "whatsapp",
    templateId: "tpl_carrinho",
    segmentIds: ["seg_carrinho"],
    flowId: "flow_carrinho",
    schedule: {
      startAt: at(90, 0),
      windowStart: 8,
      windowEnd: 22,
      days: [0, 1, 2, 3, 4, 5, 6],
      throttlePerMinute: 240,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: false,
      kind: "frete",
      codePattern: "",
      discountLabel: "",
      validUntil: at(-30, 23, 59),
    },
    requiresApproval: false,
    metrics: {
      audience: 236,
      queued: 0,
      sent: 12480,
      delivered: 12261,
      read: 10214,
      replied: 2104,
      converted: 1840,
      failed: 219,
      optOut: 41,
      revenue: 148300,
    },
    createdAt: at(92, 9),
    updatedAt: back(2 * HOUR),
    lastRunAt: back(4 * MIN),
  },
  {
    id: "cmp_aniversario",
    name: "Aniversariantes — brinde do mês",
    objective: "pos_venda",
    status: "paused",
    channel: "whatsapp",
    templateId: "tpl_aniversario",
    segmentIds: ["seg_aniversario"],
    schedule: {
      startAt: at(20, 9),
      windowStart: 9,
      windowEnd: 12,
      days: [1, 2, 3, 4, 5],
      throttlePerMinute: 40,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: true,
      kind: "brinde",
      codePattern: "NIVER-{nome}",
      discountLabel: "café grátis",
      validUntil: at(-7, 23, 59),
    },
    requiresApproval: false,
    metrics: {
      audience: 894,
      queued: 402,
      sent: 492,
      delivered: 480,
      read: 391,
      replied: 88,
      converted: 61,
      failed: 12,
      optOut: 3,
      revenue: 3940,
    },
    createdAt: at(22, 10),
    updatedAt: at(3, 14, 22),
    lastRunAt: at(3, 9, 5),
    notes: "Pausada porque o cupom vence no dia 7 e a base do mês seguinte ainda não fechou.",
  },
  {
    id: "cmp_blackfriday",
    name: "Black Friday — teaser",
    objective: "awareness",
    status: "draft",
    channel: "whatsapp",
    templateId: "tpl_blackfriday",
    segmentIds: ["seg_lista_evento"],
    flowId: "flow_blackfriday",
    schedule: {
      startAt: at(-45, 9),
      windowStart: 9,
      windowEnd: 20,
      days: [1, 2, 3, 4, 5],
      throttlePerMinute: 200,
      timezone: "America/Sao_Paulo",
    },
    offer: {
      enabled: true,
      kind: "cupom",
      codePattern: "BF30-{nome}",
      discountLabel: "30% off",
      validUntil: at(-31, 23, 59),
    },
    requiresApproval: true,
    metrics: {
      audience: 640,
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      converted: 0,
      failed: 0,
      optOut: 0,
      revenue: 0,
    },
    createdAt: at(12, 11),
    updatedAt: at(5, 9),
    notes: "Template pausado pela Meta por qualidade baixa — reescrever antes de ativar.",
  },
];

/* ------------------------------------------------------------------ envios */

function send(
  id: string,
  campaignId: string,
  contactName: string,
  destination: string,
  templateName: string,
  status: Send["status"],
  atIso: string,
  extra: Partial<Send> = {},
): Send {
  return { id, campaignId, contactName, destination, templateName, status, at: atIso, cost: 0.0625, ...extra };
}

export const SENDS: Send[] = [
  send("snd_9001", "cmp_reativacao", "Ana Beatriz Lima", "+55 11 98812-4410", "reativacao_cupom_volta", "replied", back(3 * MIN), {
    couponCode: "VOLTA-ANA",
  }),
  send("snd_9002", "cmp_reativacao", "Camila Duarte", "+55 21 98411-2200", "reativacao_cupom_volta", "read", back(6 * MIN), {
    couponCode: "VOLTA-CAMILA",
  }),
  send("snd_9003", "cmp_reativacao", "Elisa Prado", "+55 41 98112-5533", "reativacao_cupom_volta", "delivered", back(8 * MIN), {
    couponCode: "VOLTA-ELISA",
  }),
  send("snd_9004", "cmp_reativacao", "Henrique Aguiar", "+55 85 98844-3322", "reativacao_cupom_volta", "failed", back(9 * MIN), {
    couponCode: "VOLTA-HENRIQUE",
    error: "131026 · destinatário não tem WhatsApp",
  }),
  send("snd_9005", "cmp_carrinho", "Fabio Nogueira", "+55 51 99220-7744", "carrinho_abandonado_1h", "sent", back(11 * MIN)),
  send("snd_9006", "cmp_reativacao", "João Pedro Alves", "+55 62 99433-1166", "reativacao_cupom_volta", "queued", back(1 * MIN), {
    couponCode: "VOLTA-JOAO",
  }),
  send("snd_9007", "cmp_carrinho", "Diego Moreira", "+55 31 99772-1188", "carrinho_abandonado_1h", "read", back(34 * MIN)),
  send("snd_9008", "cmp_aniversario", "Gabriela Souza", "+55 11 97733-9911", "aniversario_cliente", "replied", back(2 * HOUR), {
    couponCode: "NIVER-GABRIELA",
  }),
  send("snd_9009", "cmp_clube", "Isabela Rocha", "+55 11 96611-2288", "clube_assinatura_convite", "delivered", at(2, 14, 22)),
  send("snd_9010", "cmp_clube", "Bruno Tavares", "+55 11 99123-8877", "clube_assinatura_convite", "skipped", at(2, 14, 23), {
    error: "sem opt-in para marketing",
  }),
  send("snd_9011", "cmp_reativacao", "Isabela Rocha", "+55 11 96611-2288", "reativacao_cupom_volta", "read", at(1, 10, 12), {
    couponCode: "VOLTA-ISABELA",
  }),
  send("snd_9012", "cmp_lancamento", "Camila Duarte", "+55 21 98411-2200", "lancamento_origem_especial", "queued", at(1, 9, 0)),
];

/* ------------------------------------------------------------------ fluxos */

export const FLOWS: Flow[] = [
  {
    id: "flow_reativacao",
    name: "Reativação com cupom pessoal",
    description:
      "Pega quem não compra há 90 dias e está com opt-in, remove quem já recebeu nos últimos 30 dias, gera um cupom único e manda pelo WhatsApp dentro da janela permitida. Quem responde cai no atendimento.",
    status: "active",
    campaignId: "cmp_reativacao",
    nodes: [
      {
        id: "n_start",
        type: "trigger.schedule",
        title: "Todo dia útil, 9h",
        x: 40,
        y: 200,
        config: { type: "trigger.schedule", cron: "0 9 * * 1-5", note: "Respeita a janela da campanha" },
      },
      {
        id: "n_seg",
        type: "source.segment",
        title: "Leads frios (90+ dias)",
        x: 320,
        y: 200,
        config: { type: "source.segment", segmentId: "seg_frios" },
      },
      {
        id: "n_rules",
        type: "filter.rules",
        title: "Filtro de descobrimento",
        x: 600,
        y: 96,
        config: {
          type: "filter.rules",
          combinator: "and",
          rules: [
            { id: "f1", field: "opt_in", operator: "eq", value: "sim" },
            { id: "f2", field: "última_compra", operator: "gt", value: "90" },
          ] as never,
        },
      },
      {
        id: "n_dedupe",
        type: "action.dedupe",
        title: "Remover duplicados",
        x: 600,
        y: 320,
        config: { type: "action.dedupe", key: "phone" },
      },
      {
        id: "n_coupon",
        type: "action.coupon",
        title: "Cupom único",
        x: 880,
        y: 200,
        config: { type: "action.coupon", discount: 15, kind: "cupom", perRecipient: true, expireDays: 14 },
      },
      {
        id: "n_template",
        type: "action.template",
        title: "Template: Volta pro café",
        x: 1160,
        y: 200,
        config: {
          type: "action.template",
          templateId: "tpl_reativacao_cupom",
          mapping: { "1": "primeiro_nome", "2": "cupom", "3": "desconto", "4": "validade" },
        },
      },
      {
        id: "n_channel",
        type: "action.channel",
        title: "WhatsApp · número Aurora",
        x: 1440,
        y: 200,
        config: { type: "action.channel", channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true },
      },
      {
        id: "n_wait",
        type: "action.waitReply",
        title: "Aguardar resposta (48h)",
        x: 1720,
        y: 200,
        config: { type: "action.waitReply", timeoutHours: 48, onTimeout: "continue" },
      },
      {
        id: "n_handoff",
        type: "action.handoff",
        title: "Atendimento humano",
        x: 2000,
        y: 96,
        config: { type: "action.handoff", queue: "café · vendas", slaMinutes: 30 },
      },
      {
        id: "n_end",
        type: "end",
        title: "Fim",
        x: 2000,
        y: 320,
        config: { type: "end", note: "Sem resposta em 48h: encerra sem reenviar" },
      },
    ],
    edges: [
      { id: "e1", from: "n_start", to: "n_seg" },
      { id: "e2", from: "n_seg", to: "n_rules" },
      { id: "e3", from: "n_rules", to: "n_dedupe", branch: "passou" },
      { id: "e4", from: "n_dedupe", to: "n_coupon" },
      { id: "e5", from: "n_coupon", to: "n_template" },
      { id: "e6", from: "n_template", to: "n_channel" },
      { id: "e7", from: "n_channel", to: "n_wait" },
      { id: "e8", from: "n_wait", to: "n_handoff", branch: "respondeu" },
      { id: "e9", from: "n_wait", to: "n_end", branch: "sem resposta" },
    ],
    runs: { total: 6, success: 6, failed: 0 },
    lastRunAt: back(12 * MIN),
    createdAt: at(9, 14),
    updatedAt: back(40 * MIN),
  },
  {
    id: "flow_carrinho",
    name: "Carrinho abandonado em 1h",
    description:
      "Gatilho por evento do site. Espera 1 hora (o cliente pode voltar sozinho), checa se o carrinho continua aberto e manda o lembrete. Sem cupom: o objetivo é recuperar, não pagar desconto.",
    status: "active",
    campaignId: "cmp_carrinho",
    nodes: [
      {
        id: "c_start",
        type: "trigger.event",
        title: "Evento: carrinho.abandonado",
        x: 40,
        y: 180,
        config: { type: "trigger.event", event: "carrinho.abandonado" },
      },
      {
        id: "c_delay",
        type: "action.delay",
        title: "Esperar 1 hora",
        x: 320,
        y: 180,
        config: { type: "action.delay", amount: 1, unit: "hour" },
      },
      {
        id: "c_branch",
        type: "condition.branch",
        title: "Carrinho ainda aberto?",
        x: 600,
        y: 180,
        config: { type: "condition.branch", field: "tag", operator: "contains", value: "carrinho" },
      },
      {
        id: "c_template",
        type: "action.template",
        title: "Template: carrinho 1h",
        x: 880,
        y: 96,
        config: {
          type: "action.template",
          templateId: "tpl_carrinho",
          mapping: { "1": "primeiro_nome", "2": "resumo_carrinho", "3": "id_carrinho" },
        },
      },
      {
        id: "c_channel",
        type: "action.channel",
        title: "WhatsApp · número Aurora",
        x: 1160,
        y: 96,
        config: { type: "action.channel", channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true },
      },
      {
        id: "c_end",
        type: "end",
        title: "Fim",
        x: 880,
        y: 320,
        config: { type: "end" },
      },
      {
        id: "c_split",
        type: "action.split",
        title: "A/B: texto vs. imagem",
        x: 1440,
        y: 96,
        config: { type: "action.split", a: 70, b: 30 },
      },
    ],
    edges: [
      { id: "ce1", from: "c_start", to: "c_delay" },
      { id: "ce2", from: "c_delay", to: "c_branch" },
      { id: "ce3", from: "c_branch", to: "c_template", branch: "sim" },
      { id: "ce4", from: "c_branch", to: "c_end", branch: "não" },
      { id: "ce5", from: "c_template", to: "c_channel" },
      { id: "ce6", from: "c_channel", to: "c_split" },
    ],
    runs: { total: 1840, success: 1794, failed: 46 },
    lastRunAt: back(4 * MIN),
    createdAt: at(92, 9),
    updatedAt: back(2 * HOUR),
  },
  {
    id: "flow_clube",
    name: "Convite ao clube (VIP + assinantes)",
    description:
      "Fluxo de conversão em duas ondas: primeiro os VIPs, 24h depois os assinantes. Cada onda tem limite de volume e passa por aprovação humana.",
    status: "paused",
    campaignId: "cmp_clube",
    nodes: [
      {
        id: "k_start",
        type: "trigger.manual",
        title: "Disparo aprovado",
        x: 40,
        y: 200,
        config: { type: "trigger.manual", note: "Aprovação de Marina" },
      },
      {
        id: "k_vip",
        type: "source.segment",
        title: "Clientes VIP",
        x: 320,
        y: 120,
        config: { type: "source.segment", segmentId: "seg_vip" },
      },
      {
        id: "k_assinantes",
        type: "source.segment",
        title: "Assinantes do clube",
        x: 320,
        y: 290,
        config: { type: "source.segment", segmentId: "seg_assinantes" },
      },
      {
        id: "k_limit",
        type: "action.limit",
        title: "Limitar a 80/min",
        x: 600,
        y: 200,
        config: { type: "action.limit", max: 80, per: "run" },
      },
      {
        id: "k_template",
        type: "action.template",
        title: "Template: convite ao clube",
        x: 880,
        y: 200,
        config: {
          type: "action.template",
          templateId: "tpl_clube_convite",
          mapping: { "1": "primeiro_nome" },
        },
      },
      {
        id: "k_channel",
        type: "action.channel",
        title: "WhatsApp · número Aurora",
        x: 1160,
        y: 200,
        config: { type: "action.channel", channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true },
      },
      {
        id: "k_end",
        type: "end",
        title: "Fim",
        x: 1440,
        y: 200,
        config: { type: "end" },
      },
    ],
    edges: [
      { id: "ke1", from: "k_start", to: "k_vip" },
      { id: "ke2", from: "k_start", to: "k_assinantes" },
      { id: "ke3", from: "k_vip", to: "k_limit" },
      { id: "ke4", from: "k_assinantes", to: "k_limit" },
      { id: "ke5", from: "k_limit", to: "k_template" },
      { id: "ke6", from: "k_template", to: "k_channel" },
      { id: "ke7", from: "k_channel", to: "k_end" },
    ],
    runs: { total: 1, success: 1, failed: 0 },
    lastRunAt: at(21, 18, 12),
    createdAt: at(30, 10),
    updatedAt: at(21, 18, 40),
  },
  {
    id: "flow_lancamento",
    name: "Lançamento Etiópia Guji",
    description:
      "Prioridade para o clube: 24h antes, só assinantes recebem o link com brinde de 100g. Depois abre para VIPs. Ainda não rodou.",
    status: "draft",
    campaignId: "cmp_lancamento",
    nodes: [
      {
        id: "l_start",
        type: "trigger.schedule",
        title: "Segunda, 9h",
        x: 40,
        y: 180,
        config: { type: "trigger.schedule", cron: "0 9 * * 1" },
      },
      {
        id: "l_seg",
        type: "source.segment",
        title: "Assinantes do clube",
        x: 320,
        y: 180,
        config: { type: "source.segment", segmentId: "seg_assinantes" },
      },
      {
        id: "l_coupon",
        type: "action.coupon",
        title: "Brinde 100g",
        x: 600,
        y: 180,
        config: { type: "action.coupon", discount: 0, kind: "brinde", perRecipient: true, expireDays: 16 },
      },
      {
        id: "l_template",
        type: "action.template",
        title: "Template: nova origem",
        x: 880,
        y: 180,
        config: {
          type: "action.template",
          templateId: "tpl_lancamento_origem",
          mapping: { "1": "origem", "2": "notas", "3": "sacas" },
        },
      },
      {
        id: "l_channel",
        type: "action.channel",
        title: "WhatsApp · número Aurora",
        x: 1160,
        y: 180,
        config: { type: "action.channel", channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true },
      },
    ],
    edges: [
      { id: "le1", from: "l_start", to: "l_seg" },
      { id: "le2", from: "l_seg", to: "l_coupon" },
      { id: "le3", from: "l_coupon", to: "l_template" },
      { id: "le4", from: "l_template", to: "l_channel" },
    ],
    runs: { total: 0, success: 0, failed: 0 },
    createdAt: at(4, 16),
    updatedAt: back(3 * HOUR),
  },
  {
    id: "flow_blackfriday",
    name: "Black Friday — lembrete",
    description: "Rascunho. Template pausado pela Meta; o fluxo existe para não perder a ideia.",
    status: "draft",
    campaignId: "cmp_blackfriday",
    nodes: [
      {
        id: "b_start",
        type: "trigger.manual",
        title: "Disparo manual",
        x: 40,
        y: 160,
        config: { type: "trigger.manual" },
      },
      {
        id: "b_seg",
        type: "source.segment",
        title: "Lista — Feira de Café",
        x: 320,
        y: 160,
        config: { type: "source.segment", segmentId: "seg_lista_evento" },
      },
      {
        id: "b_template",
        type: "action.template",
        title: "Template: teaser BF",
        x: 600,
        y: 160,
        config: { type: "action.template", templateId: "tpl_blackfriday", mapping: { "1": "primeiro_nome" } },
      },
      {
        id: "b_channel",
        type: "action.channel",
        title: "WhatsApp · número Aurora",
        x: 880,
        y: 160,
        config: { type: "action.channel", channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true },
      },
    ],
    edges: [
      { id: "be1", from: "b_start", to: "b_seg" },
      { id: "be2", from: "b_seg", to: "b_template" },
      { id: "be3", from: "b_template", to: "b_channel" },
    ],
    runs: { total: 0, success: 0, failed: 0 },
    createdAt: at(12, 11),
    updatedAt: at(5, 9),
  },
];

/* ------------------------------------------------------------------- feed */

export const ACTIVITY: ActivityEvent[] = [
  {
    id: "act_1",
    at: back(4 * MIN),
    kind: "send",
    title: "Carrinho abandonado disparou",
    detail: "12 envios nos últimos 5 min · 100% entregues",
    refId: "cmp_carrinho",
  },
  {
    id: "act_2",
    at: back(12 * MIN),
    kind: "flow",
    title: "Fluxo de reativação rodou",
    detail: "402 contatos entraram na fila; 88 falhas por número sem WhatsApp",
    refId: "flow_reativacao",
  },
  {
    id: "act_3",
    at: back(3 * HOUR),
    kind: "campaign",
    title: "Lançamento aguardando aprovação",
    detail: "1.680 contatos na fila, agendado para segunda 9h",
    refId: "cmp_lancamento",
  },
  {
    id: "act_4",
    at: back(9 * HOUR),
    kind: "template",
    title: "Template em análise na Meta",
    detail: "pesquisa_pos_compra enviado há 2 dias",
    refId: "tpl_pesquisa",
  },
  {
    id: "act_5",
    at: at(1, 17, 20),
    kind: "template",
    title: "Template rejeitado",
    detail: "winback_3meses · categoria utility para conteúdo promocional",
    refId: "tpl_winback",
  },
  {
    id: "act_6",
    at: at(2, 11, 5),
    kind: "billing",
    title: "Fatura do WhatsApp Business",
    detail: "R$ 1.284,60 em conversas de marketing no ciclo",
  },
  {
    id: "act_7",
    at: at(3, 9, 5),
    kind: "campaign",
    title: "Campanha pausada",
    detail: "Aniversariantes — brinde do mês (cupom vencendo)",
    refId: "cmp_aniversario",
  },
];

/* ----------------------------------------------------------------- séries */

/** Série determinística (seno + degrau) para os últimos `days` dias. */
export function buildSeries(days = 30): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(NOW);
    d.setDate(d.getDate() - i);
    const weekday = d.getDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const wave = 1 + 0.18 * Math.sin((days - i) / 2.4);
    const base = 640 * weekend * wave;
    const sent = Math.round(base);
    const delivered = Math.round(sent * 0.972);
    const read = Math.round(delivered * 0.79);
    const replied = Math.round(read * 0.14);
    out.push({
      date: d.toISOString().slice(0, 10),
      sent,
      delivered,
      read,
      replied,
    });
  }
  return out;
}

export const SERIES_90D = buildSeries(90);

/** Custo médio por conversa de marketing (mock). */
export const COST_PER_MESSAGE = 0.0625;
