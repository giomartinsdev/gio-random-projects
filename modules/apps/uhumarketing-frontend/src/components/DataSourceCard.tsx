import { CircleAlert, CircleCheck, Database, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useBackendOptional } from "@/lib/storeRemote";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";

/**
 * Estado da conexão com o uhumarketing-api.
 *
 * Não é mais um seletor de origem: o backend é a única origem. O que a tela
 * mostra é se a última escrita chegou (e o que o provedor de WhatsApp está
 * fazendo), porque um erro de sincronização silencioso é pior do que um
 * indicador feio.
 */
export function DataSourceCard() {
  const backend = useBackendOptional();
  if (!backend) return null;
  const { status, error, provider, retry } = backend;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHead
        title="Conexão com o servidor"
        subtitle="Os dados vivem no Postgres; esta tela não guarda cópia local"
        right={<span className="font-mono text-[11px] text-fg-3">api</span>}
      />

      <div className="flex flex-col gap-2 rounded-sm border border-line bg-bg px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-3">
          <Database size={12} />
          <span className="truncate">{api.base}</span>
          <span className="text-line">·</span>
          <span
            className={cn(
              status === "error" ? "text-danger" : status === "saving" ? "text-warn" : "text-success",
            )}
          >
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
                {provider.name === "meta-cloud"
                  ? "Meta Cloud API (live)"
                  : provider.mode === "dry-run"
                    ? "provedor dry-run"
                    : `provedor ${provider.name}`}
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={() => window.location.reload()}
        >
          Recarregar do banco
        </Button>
        <span className="font-mono text-[11px] text-fg-3">VITE_UHU_API_URL</span>
      </div>
    </Card>
  );
}
