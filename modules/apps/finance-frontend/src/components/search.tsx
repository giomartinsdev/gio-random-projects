import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, Landmark, LayoutDashboard, Plus, ArrowUpRight, CornerDownRight, X } from "lucide-react";
import { navigate, type Route } from "@/lib/router";
import { formatBRL, type Transaction, type OFAccount } from "@/lib/api";
import { WIDGET_DEFS } from "@/lib/dashboardLayout";
import { cn } from "@/lib/utils";

// Busca global no molde do seuimposto: pílula "Buscar ⌘K" na topbar abre um
// painel central com resultados agrupados (transações, contas, widgets, telas)
// e teclado completo (↑↓ navegar · ↵ abrir · esc fechar).

type Item =
  | { kind: "transaction"; id: string; label: string; meta: string; to: Route; signed: string; down: boolean }
  | { kind: "account"; id: string; label: string; meta: string; to?: undefined }
  | { kind: "widget"; id: string; label: string; meta: string; to?: Route }
  | { kind: "page"; id: string; label: string; meta: string; to: Route };

const PAGES: Item[] = [
  { kind: "page", id: "p-dashboard", label: "Painel", meta: "tela · widgets e saldo do mês", to: { name: "dashboard" } },
  { kind: "page", id: "p-transactions", label: "Transações", meta: "tela · lista densa e filtros", to: { name: "transactions" } },
  { kind: "page", id: "p-accounts", label: "Contas", meta: "tela · saldos e conexões", to: { name: "accounts" } },
  { kind: "page", id: "p-limits", label: "Limites", meta: "tela · barras por categoria", to: { name: "limits" } },
  { kind: "page", id: "p-notifications", label: "Avisos", meta: "tela · regras do WhatsApp", to: { name: "notifications" } },
  { kind: "page", id: "p-openfinance", label: "Open Finance", meta: "tela · conexões e sincronização", to: { name: "openfinance" } },
  { kind: "page", id: "p-personalize", label: "Personalizar", meta: "tela · widgets e timing da home", to: { name: "personalize" } },
  { kind: "page", id: "p-settings", label: "Ajustes", meta: "tela · preferências e aparência", to: { name: "settings" } },
];

export const SEARCH_INDEX: Item[] = [
  ...PAGES,
  ...WIDGET_DEFS.map<Item>((w) => ({
    kind: "widget",
    id: "w-" + w.id,
    label: w.name,
    meta: "widget · " + w.description,
  })),
  {
    kind: "widget",
    id: "w-add",
    label: "Adicionar widget",
    meta: "ação · escolher da biblioteca na Personalizar",
    to: { name: "personalize" },
  },
];

function matches(i: Item, q: string): boolean {
  return (i.label + " " + i.meta).toLowerCase().includes(q);
}

export function filterItems(items: Item[], transactions: Transaction[], accounts: OFAccount[], q: string): Item[] {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return [...PAGES.slice(0, 4), ...items.filter((i) => i.kind === "widget").slice(0, 2)];
  }
  const txs = transactions
    .filter((t) => [t.counterparty, t.description, t.category, t.external_category].join(" ").toLowerCase().includes(needle))
    .slice(0, 5)
    .map<Item>((t) => ({
      kind: "transaction",
      id: t.id,
      label: t.counterparty || t.description || t.category || "Lançamento",
      meta: `${t.category || "Outros"} · ${new Date(t.occurred_at).toLocaleDateString("pt-BR")}`,
      to: { name: "transaction", id: t.id },
      signed: `${t.transaction_type === "INCOME" ? "+" : "−"} ${formatBRL(String(Math.abs(Number(t.amount))))}`,
      down: t.transaction_type !== "INCOME",
    }));
  const accs = accounts
    .filter((a) => a.name.toLowerCase().includes(needle) || (a.account_type || "").toLowerCase().includes(needle))
    .slice(0, 3)
    .map<Item>((a) => ({ kind: "account", id: "a-" + a.id, label: a.name, meta: `${a.account_type || "conta"} · saldo ${formatBRL(a.balance_amount)}` }));
  const rest = items.filter((i) => i.kind !== "transaction" && matches(i, needle));
  return [...txs, ...accs, ...rest].slice(0, 14);
}

export function groupLabel(kind: Item["kind"]): string {
  return kind === "transaction" ? "TRANSAÇÕES" : kind === "account" ? "CONTAS" : kind === "widget" ? "WIDGETS" : "TELAS";
}

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-bg-soft/85 px-3 text-[12.5px] text-fg-dim transition-colors hover:text-fg"
      aria-label="Abrir busca (⌘K)"
    >
      <Search className="size-3.5" />
      <span className="hidden sm:inline">Buscar</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-border bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-dim">
      {children}
    </kbd>
  );
}

export function SearchOverlay({
  open,
  onClose,
  transactions,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  accounts: OFAccount[];
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => (open ? filterItems(SEARCH_INDEX, transactions, accounts, q) : []),
    [open, q, transactions, accounts],
  );

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      // espera o overlay pintar para focar
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setSel(0), [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else window.dispatchEvent(new CustomEvent("finance:open-search"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = (i: Item) => {
    onClose();
    if (i.to) navigate(i.to);
    else if (i.kind === "widget") navigate({ name: "personalize" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === "Enter" && results[sel]) return go(results[sel]);
  };

  // rótulo de grupo aparece quando o item muda de tipo em relação ao anterior
  let lastKind = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[13vh]" role="dialog" aria-modal>
      <button aria-label="Fechar busca" className="absolute inset-0 bg-black/70 dark:bg-bg/70" onClick={onClose} />
      <div
        ref={listRef}
        className="card relative w-full max-w-[640px] overflow-hidden p-0"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-fg-dim" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="buscar transação, conta, widget, categoria ou tela…"
            className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-dim"
          />
          <button onClick={onClose} className="rounded-md p-1 text-fg-dim hover:bg-fg/8 hover:text-fg" aria-label="Fechar">
            <X className="size-3.5" />
          </button>
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2 scroll-thin">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-fg-dim">nada encontrado para “{q}”</p>
          ) : (
            <ul>
              {results.map((r, i) => {
                const showGroup = groupLabel(r.kind) !== lastKind;
                lastKind = groupLabel(r.kind);
                const icon =
                  r.kind === "transaction" ? <CornerDownRight className="size-3.5" /> :
                  r.kind === "account" ? <Landmark className="size-3.5" /> :
                  r.kind === "widget" ? (r.id === "w-add" ? <Plus className="size-3.5" /> : <LayoutDashboard className="size-3.5" />) :
                  <ArrowUpRight className="size-3.5" />;
                return (
                  <li key={r.kind + r.id}>
                    {showGroup && (
                      <div className="px-1 pb-1 pt-2.5 font-mono text-[10px] text-fg-dim">
                        {groupLabel(r.kind)}
                      </div>
                    )}
                    <button
                      onClick={() => go(r)}
                      onMouseEnter={() => setSel(i)}
                      data-on={i === sel}
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left transition-colors",
                        i === sel ? "bg-fg/8" : "hover:bg-fg/4",
                      )}
                    >
                      <span className="text-fg-dim">{icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-fg">{r.label}</span>
                        <span className="block truncate text-[11px] text-fg-dim">{r.meta}</span>
                      </span>
                      {r.kind === "transaction" && (
                        <span className={cn("tnum text-[12.5px]", (r as { down: boolean }).down ? "text-down" : "text-up")}>
                          {(r as { signed: string }).signed}
                        </span>
                      )}
                      <span className="pill hidden text-[10.5px] sm:inline-flex">{groupLabel(r.kind).toLowerCase().slice(0, -1)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex h-10 items-center gap-3.5 border-t border-border px-4">
          <span className="font-mono text-[11px] text-fg-dim">↑↓ navegar · ↵ abrir · esc fechar</span>
          <span className="ml-auto text-[11px] text-fg-dim">busca global</span>
        </div>
      </div>
    </div>
  );
}