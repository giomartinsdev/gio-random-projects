// Tipos do contrato da prospecta-api (specs/004-prospecta/contracts/
// prospecta-api.md). Campos opcionais onde o backend pode omitir a projeção.

export type Channel = "email" | "whatsapp";

export interface Icp {
  definition: string;
  signals: string[];
}

export interface Company {
  id: string;
  name: string;
  site: string;
  description: string;
  icp?: Icp;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  channels: string[];
  leads_count: number;
}

export interface CampaignInput {
  company_id: string;
  name: string;
  channels: string[];
}

export interface Lead {
  id: string;
  company_name: string;
  segment: string;
  channel: string;
  fit: number;
  status: string;
  source_url?: string;
}

export interface LeadTimelineEvent {
  label: string;
  detail?: string;
  at?: string;
  tone?: "done" | "current" | "pending";
}

export interface LeadDetail {
  id: string;
  company_name: string;
  segment: string;
  channel: string;
  fit: number;
  status: string;
  source_url?: string;
  enriched?: Record<string, string>;
  timeline?: LeadTimelineEvent[];
  last_message?: Message | null;
  agent_summary?: string;
}

export interface Message {
  id: string;
  lead_id?: string;
  channel: string;
  direction: "in" | "out";
  content: string;
  status: string;
  sent_at?: string;
}

export interface Conversation {
  id: string;
  lead_id: string;
  company_name: string;
  channel: string;
  last_message: string;
  unread: boolean;
  state: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface MessageInput {
  lead_id: string;
  channel: string;
  content: string;
}

export interface AgentRunEvent {
  run_id: string;
  agent: string;
  state: string;
  metric?: Record<string, number>;
}

export interface Paged<T> {
  items: T[];
  next: string | null;
}

// ---- Auth (contrato congelado da prospecta-api) ----
// POST /auth/signup, POST /auth/login, GET /auth/me, POST /auth/logout.
// Sessão por cookie HttpOnly cross-origin: toda chamada manda credentials.
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  cargo?: string;
  phone?: string;
  // false quando a conta foi criada só com Google (sem senha local). Omitido
  // pelo backend antigo → tratamos como conta com senha.
  has_password?: boolean;
}

export interface AuthSession {
  user: AuthUser;
  company: Company;
}

// Cadastro aceita senha OU um google_credential (ID token do Google
// Identity Services) — nunca os dois. `company` é sempre obrigatório.
export interface SignupInput {
  name: string;
  email: string;
  password?: string;
  google_credential?: string;
  cargo?: string;
  phone?: string;
  company: { name: string; site: string; description: string };
}

export interface LoginInput {
  email: string;
  password: string;
}

// POST /auth/google devolve a sessão (usuário existente, com cookie) OU um
// pedido de onboarding (usuário novo, SEM cookie) para completar o cadastro
// com o google_credential já verificado.
export interface GoogleOnboarding {
  needs_onboarding: true;
  email: string;
  name: string;
}

export type GoogleLoginResult = AuthSession | GoogleOnboarding;

// Rascunho mantido em memória enquanto o usuário novo conclui a empresa.
export interface GoogleSignupDraft {
  email: string;
  name: string;
  google_credential: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}
