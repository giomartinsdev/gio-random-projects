import { CircleAlert, CircleCheck, Database, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { API_URL, useDataSource, type DataSource } from "@/lib/dataSource";
import { useBackendOptional } from "@/lib/storeRemote";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Note } from "@/components/Topbar";

/** Estado de sincronização, quando o modo é Backend. */
function SyncLine() {
  const backend = useBackendOptional();
  if (!backend) return null;
  const { status, error, provider, retry } = backend;

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-bg px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-3">
        <span className="truncate">{API_URL}</span>
        <span className="text-line">·</span>
        <span className={cn(status === "error" ? "text-danger" : status === "saving" ? "text-warn" : "text-success")}>
          {status === "saving" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> salvando
            </span>
          ) : status === "error" ? (
            <span className="inline-flex items-center gap-1">
              <CircleAlert size={11} /> erro ao salvar
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CircleCheck size={11} /> sincronizado
            </span>
          )}
        </span>
        {provider && (
          <>
            <span className="text-line">·</span>
            <span>
              provedor {provider.name} ({provider.mode})
            </span>
          </>
        )}
      </div>
      {provider && <p className="text-[11px] leading-snug text-fg-3">{provider.note}</p>}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xs border border-danger/30 bg-danger/5 px-2.5 py-2">
          <span className="text-[11px] leading-snug text-danger">{error}</span>
          <button
            onClick={retry}
            className="shrink-0 text-fg-3 transition-colors hover:text-fg"
            title="Recarregar do banco"
            aria-label="Recarregar do banco"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Seletor de origem dos dados.
 *
 * O modo Demo continua existindo de propósito: é ele que permite abrir o link
 * sem backend no ar. O modo Backend é o que grava em Postgres e enfileira de
 * verdade — a tela não muda, só quem responde por ela.
 */
export function DataSourceCard() {
  const [source, setSource] = useDataSource();
  const [pending, setPending] = useState<DataSource | null>(null);

  const options: { id: DataSource; label: string; hint: string; icon: typeof Database }[] = [
    { id: "demo", label: "Demonstração", hint: "Dados no navegador (localStorage)", icon: FlaskConical },
    { id: "backend", label: "Backend real", hint: "Postgres, fila e webhook da Meta", icon: Database },
  ];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHead
        title="Origem dos dados"
        subtitle="A mesma tela roda com dados de exemplo ou contra a API"
        right={
          <span className="font-mono text-[11px] text-fg-3">
            {source === "backend" ? "api" : "local"}
          </span>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ id, label, hint, icon: Icon }) => {
          const active = source === id;
          return (
            <button
              key={id}
              onClick={() => {
                if (active) return;
                setPending(id);
                // Recarregar é intencional: garante que nenhum estado em memória
                // do outro provider vaze para a nova origem.
                setSource(id);
                window.setTimeout(() => window.location.reload(), 60);
              }}
              className={cn(
                "flex items-start gap-3 rounded-sm border px-3.5 py-3 text-left transition-colors",
                active
                  ? "border-accent-light/40 bg-accent-soft/40"
                  : "border-line bg-bg hover:border-fg-3/40",
              )}
            >
              <Icon size={16} className={cn("mt-0.5 shrink-0", active ? "text-accent-light" : "text-fg-3")} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-fg">{label}</span>
                <span className="text-[11px] leading-snug text-fg-3">{hint}</span>
              </span>
              {pending === id && <Loader2 size={13} className="animate-spin text-fg-3" />}
            </button>
          );
        })}
      </div>

      {source === "backend" ? <SyncLine /> : (
        <Note>
          Modo demonstração: nada sai do navegador. Para disparar de verdade, suba o{" "}
          <span className="font-mono text-fg-2">uhumarketing-api</span> e escolha “Backend real”.
        </Note>
      )}

      {source === "backend" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={13} />}
            onClick={() => window.location.reload()}
          >
            Recarregar do banco
          </Button>
          <span className="font-mono text-[11px] text-fg-3">
            VITE_UHU_API_URL · VITE_UHU_API_KEY
          </span>
        </div>
      )}
    </Card>
  );
}
