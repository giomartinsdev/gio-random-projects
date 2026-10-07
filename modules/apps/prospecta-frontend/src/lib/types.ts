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
}

export interface AuthSession {
  user: AuthUser;
  company: Company;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  cargo?: string;
  phone?: string;
  company: { name: string; site: string; description: string };
}

export interface LoginInput {
  email: string;
  password: string;
}
