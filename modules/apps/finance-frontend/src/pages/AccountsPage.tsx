import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { api, formatBRL, type OFAccount, type OFConsent } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi, PageHead } from "@/components/primitives";
import { hrefFor } from "@/lib/router";

// Contas no formato cockpit: rail esquerdo com o saldo total, centro com os
// cards por conta (clicáveis) e as conexões, direito com resumo.
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

  const left = (
    <Card>
      <div className="kick mb-2">patrimônio</div>
      <p className="fig tnum">{formatBRL(String(total))}</p>
      <p className="mt-1 text-[11px] dim">{accounts.length} conta(s) conectada(s)</p>
      <div className="mt-4 grid grid-cols-1 gap-3">
        <Kpi label="Conexões ativas" value={String(consents.filter((c) => c.status === "AUTHORISED").length)} />
      </div>
    </Card>
  );

  const center = (
    <div className="space-y-3">
      <PageHead
        kick="contas"
        title="Contas"
        sub="Saldos e conexões bancárias."
        right={
          <button onClick={load} className="pill">
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} /> Atualizar
          </button>
        }
      />
      {error && <p className="text-[13px] text-down">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accounts.map((a) => (
          <a key={a.id} href={hrefFor({ name: "transactions" })}>
            <Card className="h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                    <Landmark className="size-4" />
                  </span>
                  <div>
                    <p className="text-[13px]">{a.name || "Conta"}</p>
                    <p className="text-[11px] dim">{a.account_type.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <p className="tnum text-[16px]">{formatBRL(a.balance_amount)}</p>
              </div>
            </Card>
          </a>
        ))}
        {!loading && accounts.length === 0 && (
          <Card>
            <Empty text="Nenhuma conta conectada ainda." />
            <div className="text-center">
              <a href={hrefFor({ name: "openfinance" })} className="text-[13px] text-primary hover:underline">Conectar um banco →</a>
            </div>
          </Card>
        )}
      </div>
    </div>
  );

  const right = (
    <Card title="Conexões">
      {consents.length === 0 ? (
        <Empty text="Sem conexões." />
      ) : (
        <ul>
          {consents.map((c) => (
            <li key={c.id} className="row">
              <span className="av">{(c.institution_name || "?").slice(0, 1)}</span>
              <a href={hrefFor({ name: "openfinance" })} className="truncate text-[13px] hover:text-primary">
                {c.institution_name || c.institution_id}
              </a>
              <span className={c.status === "AUTHORISED" ? "text-[11px] text-up" : "text-[11px] text-warn"}>
                {c.status === "AUTHORISED" ? "conectado" : "aguardando"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return <Cockpit left={left} center={center} right={right} />;
}
