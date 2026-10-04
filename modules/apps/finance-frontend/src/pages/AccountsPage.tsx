import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { api, formatBRL, type OFAccount, type OFConsent } from "@/lib/api";
import { PageHeader, Panel, Empty } from "@/components/primitives";
import { Badge } from "@/components/ui/badge";
import { hrefFor } from "@/lib/router";

// Contas conectadas (Open Finance) e as conexões. Clicar numa conta leva ao
// extrato daquele mês; clicar na conexão leva ao Open Finance.
export function AccountsPage() {
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [consents, setConsents] = useState<OFConsent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [a, c] = await Promise.all([api.ofAccounts(), api.ofConsents()]);
      setAccounts(a.accounts ?? []);
      setConsents(c.consents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar as contas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = accounts.reduce((s, a) => s + Number(a.balance_amount), 0);

  return (
    <div>
      <PageHeader
        eyebrow="patrimônio"
        title="Contas"
        description="Saldos e conexões bancárias."
        action={
          <button onClick={load} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-[13px] hover:bg-secondary">
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /> Atualizar
          </button>
        }
      />

      {error && <p className="mb-4 text-[13px] text-destructive">{error}</p>}

      <div className="mb-5 rounded-lg border border-border bg-card p-5">
        <p className="eyebrow">saldo total</p>
        <p className="tnum mt-1 text-2xl">{formatBRL(String(total))}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{accounts.length} conta(s) conectada(s)</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {accounts.map((a) => (
          <a key={a.id} href={hrefFor({ name: "transactions" })} className="block">
            <Panel>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <Landmark className="size-5" />
                  </span>
                  <div>
                    <p className="text-[13px]">{a.name || "Conta"}</p>
                    <p className="text-[11px] text-muted-foreground">{a.account_type.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <p className="tnum text-lg">{formatBRL(a.balance_amount)}</p>
              </div>
              {a.balance_updated_at && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  saldo de {new Date(a.balance_updated_at).toLocaleString("pt-BR")}
                </p>
              )}
            </Panel>
          </a>
        ))}
        {!loading && accounts.length === 0 && (
          <Panel>
            <Empty text="Nenhuma conta conectada ainda." />
            <div className="text-center">
              <a href={hrefFor({ name: "openfinance" })} className="text-[13px] text-primary hover:underline">
                Conectar um banco →
              </a>
            </div>
          </Panel>
        )}
      </div>

      {consents.length > 0 && (
        <Panel title="Conexões" className="mt-5">
          <ul className="divide-y divide-border">
            {consents.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <a href={hrefFor({ name: "openfinance" })} className="text-[13px] hover:text-primary">
                  {c.institution_name || c.institution_id}
                </a>
                <Badge variant={c.status === "AUTHORISED" ? "success" : "warning"}>
                  {c.status === "AUTHORISED" ? "conectado" : "aguardando"}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
