import type { ReactNode } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { navigate } from "@/lib/useHashRoute";
import { Button } from "./ui/Button";

// Estado mostrado quando falta apiKey/companyId: nenhuma tela (fora de
// Configurações) mostra dado; todas levam para lá.
export function ConfigureApiState({ message }: { message?: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-7">
      <section className="card flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent-light">
          <PlugZap size={22} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[18px] font-semibold text-fg">Configure a API</h2>
          <p className="text-[14px] text-fg-2">
            {message ?? "Informe a URL da prospecta-api, a chave (X-API-Key) e o id da empresa para ver os dados reais."}
          </p>
        </div>
        <Button onClick={() => navigate("configuracoes")}>Abrir Configurações</Button>
      </section>
    </div>
  );
}

// Spinner de carregamento.
export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-10 text-fg-2">
      <Loader2 size={20} className="animate-spin text-accent-light" />
      <span className="text-[14px]">{label}</span>
    </div>
  );
}

// Erro honesto com ação de tentar de novo.
export function ErrorState({ error, onRetry, compact }: { error: string; onRetry?: () => void; compact?: boolean }) {
  const body = (
    <div className={`flex flex-col items-center gap-3 text-center ${compact ? "" : "p-10"}`}>
      <span className="text-[14px] text-fg-2">Não foi possível carregar: {error}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
  if (compact) return body;
  return <div className="flex min-h-0 flex-1 items-center justify-center">{body}</div>;
}

// Estado vazio configurável.
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <span className="text-[14px] font-medium text-fg-2">{title}</span>
      {hint && <span className="max-w-sm text-[13px] text-fg-3">{hint}</span>}
      {action}
    </div>
  );
}
