// Cliente HTTP do SPA. Diferente da versão antiga (que pedia uma X-API-Key
// colada pelo operador), agora a identidade é a sessão do Google: todo fetch
// vai com `credentials: "include"` e o finance-api amarra o `user_id` ao
// telefone da sessão. Não há chave no bundle.
const API_URL = import.meta.env.VITE_FINANCE_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface CategoryAmount {
  category: string;
  amount: string;
  currency: string;
  transaction_count: number;
}

export interface BudgetStatus {
  category: string;
  limit_amount: string;
  spent_amount: string;
  currency: string;
  thresholds_reached: number[];
}

export interface MonthlyDashboard {
  user_id: string;
  month: string;
  income: string;
  expense: string;
  net: string;
  currency: string;
  transaction_count: number;
  top_categories: CategoryAmount[];
  budgets: BudgetStatus[];
}

export interface CashFlowDay {
  date: string;
  income: string;
  expense: string;
  net: string;
}

export interface CashFlowHistory {
  user_id: string;
  month: string;
  currency: string;
  days: CashFlowDay[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? `falha (${res.status})`);
  return payload as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    credentials: "include",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? `falha (${res.status})`);
  }
  return payload as T;
}

// As ações do contrato (packages/finance-contracts). Aqui só as que o SPA usa.
const ACTION_REGISTER = "finance.transaction.register";
const ACTION_BUDGET = "finance.budget.setCategory";
const ACTION_TRANSFER = "finance.transfer.betweenAccounts";
const ACTION_TX_UPDATE = "finance.transaction.update";
const ACTION_TX_REMOVE = "finance.transaction.remove";
const ACTION_TX_SET_ACTIVE = "finance.transaction.setActive";
const QUERY_DASHBOARD = "finance.query.monthlyDashboard";
const QUERY_BREAKDOWN = "finance.query.categoryBreakdown";
const QUERY_CASHFLOW = "finance.query.cashFlowHistory";
const QUERY_TRANSACTIONS = "finance.query.transactions";
const QUERY_TRANSACTION = "finance.query.transaction";
const QUERY_OF_CONSENTS = "finance.query.ofConsents";
const QUERY_NOTIFICATIONS = "finance.query.notifications";
const ACTION_NOTIF_SET = "finance.notification.set";
const ACTION_NOTIF_DELETE = "finance.notification.delete";
const QUERY_OF_ACCOUNTS = "finance.query.ofAccounts";

export interface Transaction {
  id: string;
  occurred_at: string;
  transaction_type: string;
  amount: string;
  currency: string;
  category: string;
  account_id: string;
  source: string;
  counterparty: string;
  description: string;
  external_category: string;
  // Movimentação entre contas PRÓPRIAS (ex.: BTG → MP): inativo sai de
  // receitas/despesas/net/categorias/cashflow, mas vale no saldo da conta.
  inactive?: boolean;
}

export interface Notification {
  id: string;
  kind: string;
  category: string;
  threshold: string;
  channel: string;
  enabled: boolean;
}

export interface OFInstitution {
  id: string;
  name: string;
  logo_url?: string | null;
  status: string;
  type: string;
}

export interface OFConsent {
  id: string;
  consent_id: string;
  institution_id: string;
  institution_name: string;
  status: string;
  execution_status: string;
  products: string[];
  url_to_authenticate?: string;
  updated_at: string;
}

export interface OFAccount {
  id: string;
  account_id: string;
  consent_id: string;
  name: string;
  account_type: string;
  currency: string;
  balance_amount: string;
  balance_updated_at?: string;
}

export interface OFConnectResult {
  consent_id: string;
  status: string;
  url_to_authenticate: string;
  institution_name: string;
}

export interface NewTransaction {
  transaction_type: TransactionType;
  amount: string; // decimal canônico, ex. "45.00"
  category: string;
  occurred_at: string; // ISO tz-aware
  account_id?: string;
}

export const api = {
  registerTransaction(tx: NewTransaction): Promise<{ status: string; command_id: string }> {
    return post("/commands", {
      action: ACTION_REGISTER,
      payload: {
        account_id: tx.account_id || "web",
        transaction_type: tx.transaction_type,
        amount: tx.amount,
        currency: "BRL",
        category: tx.category,
        occurred_at: tx.occurred_at,
        source_type: "WEB_MANUAL",
      },
    });
  },

  // Correção do dono (patch parcial): campos ausentes mantêm o atual. O amount
  // vai ABSOLUTO — quem decide o sinal pelo tipo é o worker (mesma convenção
  // do register). Com amount é bom mandar o tipo junto, para virar o sentido.
  updateTransaction(
    id: string,
    patch: {
      category?: string;
      counterparty?: string;
      description?: string;
      amount?: string;
      transaction_type?: string; // "INCOME" | "EXPENSE" | "TRANSFER" (wire)
      occurred_at?: string;
    },
  ): Promise<{ status: string }> {
    return post("/commands", { action: ACTION_TX_UPDATE, payload: { transaction_id: id, ...patch } });
  },

  removeTransaction(id: string): Promise<{ status: string }> {
    return post("/commands", { action: ACTION_TX_REMOVE, payload: { transaction_id: id } });
  },

  // Flag de movimentação entre contas próprias: active=false tira o
  // lançamento de receitas/despesas/net/categorias/cashflow, mas ele segue no
  // saldo da conta (que soma tudo — não descasa com o extrato do banco).
  setTransactionActive(id: string, active: boolean): Promise<{ status: string }> {
    return post("/commands", { action: ACTION_TX_SET_ACTIVE, payload: { transaction_id: id, active } });
  },

  setBudget(input: { category: string; limit: string; period: string }): Promise<{ status: string }> {
    return post("/commands", {
      action: ACTION_BUDGET,
      payload: {
        category: input.category,
        limit: input.limit,
        currency: "BRL",
        period: input.period,
      },
    });
  },

  transfer(input: { from_account_id: string; to_account_id: string; amount: string; occurred_at: string }): Promise<{ status: string }> {
    return post("/commands", {
      action: ACTION_TRANSFER,
      payload: {
        from_account_id: input.from_account_id,
        to_account_id: input.to_account_id,
        amount: input.amount,
        currency: "BRL",
        occurred_at: input.occurred_at,
      },
    });
  },

  dashboard(month: string): Promise<MonthlyDashboard> {
    return post("/queries", { action: QUERY_DASHBOARD, payload: { month } });
  },

  breakdown(month: string): Promise<{ month: string; categories: CategoryAmount[]; currency: string }> {
    return post("/queries", { action: QUERY_BREAKDOWN, payload: { month } });
  },

  cashFlow(month: string): Promise<CashFlowHistory> {
    return post("/queries", { action: QUERY_CASHFLOW, payload: { month } });
  },

  transactions(month: string): Promise<{ transactions: Transaction[] }> {
    return post("/queries", { action: QUERY_TRANSACTIONS, payload: month ? { month } : {} });
  },

  transaction(id: string): Promise<Transaction> {
    return post("/queries", { action: QUERY_TRANSACTION, payload: { transaction_id: id } });
  },

  // ---- Notificações ----
  notifications(): Promise<{ notifications: Notification[] }> {
    return post("/queries", { action: QUERY_NOTIFICATIONS, payload: {} });
  },
  setNotification(input: { id?: string; kind: string; category?: string; threshold?: string; enabled?: boolean }): Promise<{ status: string }> {
    return post("/commands", { action: ACTION_NOTIF_SET, payload: input });
  },
  deleteNotification(id: string): Promise<{ status: string }> {
    return post("/commands", { action: ACTION_NOTIF_DELETE, payload: { notification_id: id } });
  },

  // ---- Open Finance (Polp) ----
  ofInstitutions(query = ""): Promise<{ institutions: OFInstitution[] }> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    return get<{ institutions: OFInstitution[] }>(`/openfinance/institutions${qs}`);
  },
  ofConsents(): Promise<{ consents: OFConsent[] }> {
    return post("/queries", { action: QUERY_OF_CONSENTS, payload: {} });
  },
  ofAccounts(): Promise<{ accounts: OFAccount[] }> {
    return post("/queries", { action: QUERY_OF_ACCOUNTS, payload: {} });
  },
  ofConnect(input: { institution_id: string; cpf: string; cnpj?: string; institution_name?: string }): Promise<OFConnectResult> {
    return post("/openfinance/consents", input);
  },
  ofRefresh(consentId: string): Promise<{ status: string }> {
    return post(`/openfinance/consents/${consentId}/refresh`, {});
  },
  ofRevoke(consentId: string): Promise<{ status: string }> {
    return request("DELETE", `/openfinance/consents/${consentId}`);
  },
};

// Formatação de dinheiro a partir da string decimal do domínio (§3.4): o SPA
// só exibe — nunca faz aritmética que possa virar float.
export function formatBRL(amount: string, opts?: { signed?: boolean }): string {
  const value = Number(amount);
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (!opts?.signed || value === 0) return formatted;
  return value < 0 ? `− ${formatted}` : `+ ${formatted}`;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
