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
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
const QUERY_DASHBOARD = "finance.query.monthlyDashboard";
const QUERY_BREAKDOWN = "finance.query.categoryBreakdown";
const QUERY_CASHFLOW = "finance.query.cashFlowHistory";

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
