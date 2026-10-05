import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Link2, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  api,
  formatBRL,
  type OFAccount,
  type OFConsent,
  type OFInstitution,
} from "@/lib/api";
import { Card, Cockpit, Empty } from "@/components/primitives";
import { AiDots } from "@/components/aidots";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { cn } from "@/lib/utils";

// Open Finance V3 (ui.pen §V3): cards de conta (status ONLINE mono), tabela
// de conexões com badge e último sync, conectar na coluna direita. Zero
// "cockpit editorial" — superfícies sólidas, hairline, mono caps.
export function OpenFinancePage() {
  const [consents, setConsents] = useState<OFConsent[]>([]);
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [loading, setLoading] = useState(true);
  void loading;
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, a] = await Promise.all([api.ofConsents(), api.ofAccounts()]);
      setConsents(c.consents ?? []);
      setAccounts(a.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 30);

  const total = useMemo(() => accounts.reduce((s, a) => s + Number(a.balance_amount), 0), [accounts]);

  const left = (
    <>
      <Card>
        <p className="kick mb-1">{accounts.length} contas · {consents.filter((c) => c.status === "AUTHORISED").length} conectadas</p>
        <p className="kick">Saldo consolidado</p>
        <p className="mono tnum text-[22px] font-semibold tracking-tight">{formatBRL(String(total))}</p>
        <p className="mt-1.5 text-[10.5px] dim">webhook Celcoin ativo · poll 120s</p>
      </Card>

      <Card title="Como funciona" right={<AiDots width={26} height={24} />}>
        <p className="text-[11.5px] leading-[1.6] text-fg-dim">
          Conecte um banco e o consentimento passa a pedir <span className="mono text-fg">conta + investimentos</span>. O
          push do provedor (assina com HMAC) dispara o sync em segundos — o dado real vem sempre da releitura da API.
          Revogar apaga tudo do servidor.
        </p>
      </Card>
    </>
  );

  const center = (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card className="!p-0 overflow-hidden">
        <div className="hd !mb-0 border-b border-border px-4 py-3">
          <p className="text-[13px] font-semibold">Conexões</p>
          <span className="mono text-[9px] uppercase tracking-widest text-fg-dim">{consents.length} consentimentos</span>
        </div>
        {consents.length === 0 ? (
          <div className="px-4 py-8"><Empty text="Nenhuma conexão ainda. Conecte um banco ao lado." /></div>
        ) : (
          <div className="mono grid grid-cols-[1fr_150px_104px] items-center gap-3 border-b border-border bg-surface-2 px-4 py-1.5">
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">instituição</span>
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">estado</span>
            <span className="font-mono text-right text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">ações</span>
          </div>
        )}
        <ul>
          {consents.map((c) => <ConsentRow key={c.id} consent={c} onChanged={load} />)}
        </ul>
      </Card>

      {accounts.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="hd !mb-0 border-b border-border px-4 py-3">
            <p className="text-[13px] font-semibold">Contas importadas</p>
            <span className="mono text-[9px] uppercase tracking-widest text-fg-dim">{accounts.length} contas</span>
          </div>
          <div className="mono grid grid-cols-[1fr_150px_110px] items-center gap-3 border-b border-border bg-surface-2 px-4 py-1.5">
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">conta</span>
            <span className="font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">tipo</span>
            <span className="font-mono text-right text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim">saldo</span>
          </div>
          <ul>
            {accounts.map((a) => (
              <li key={a.id} className="grid grid-cols-[1fr_150px_110px] items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="mono size-[5px] shrink-0 rounded-full bg-accent" aria-hidden />
                  <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
                </span>
                <span className="truncate text-[11px] text-fg-dim">{a.account_type || "—"}</span>
                <span className="mono text-right text-[11.5px] font-semibold">{formatBRL(a.balance_amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );

  const right = <ConnectCard onConnected={load} />;

  return <Cockpit left={left} center={center} right={right} />;
}

function stateBadge(c: OFConsent) {
  const awaiting = c.status === "AWAITING_AUTHORIZATION";
  const awaitingRes = c.status === "AUTHORISED" && c.execution_status === "AWAITING_RESOURCES";
  const rejected = c.status === "REJECTED";
  const expired = c.status === "EXPIRED";
  return (
    <span className={cn(
      "pill !py-0.5 !px-2 font-mono !text-[9px]",
      awaitingRes && "!bg-accent/20 text-accent",
      awaiting && "!bg-warn/20 text-warn",
      rejected && "!bg-down/20 text-down",
      expired && "!bg-transparent border border-border text-fg-dim",
    )}>
      <span className={cn("dot", awaitingRes ? "bg-accent" : awaiting ? "bg-warn" : rejected ? "bg-down" : expired ? "bg-fg-dim" : "bg-up")} />
      {expired ? "expirado" : awaiting ? "aguardando" : awaitingRes ? "recebendo dados" : rejected ? "rejeitado" : "conectado"}
    </span>
  );
}

function ConsentRow({ consent, onChanged }: { consent: OFConsent; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await api.ofRefresh(consent.consent_id);
      setTimeout(onChanged, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao atualizar");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm(`Revogar a conexão com ${consent.institution_name || "o banco"}?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.ofRevoke(consent.consent_id);
      setTimeout(onChanged, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "falha ao revogar");
    } finally {
      setBusy(false);
    }
  }

  const canAuthorize = consent.status === "AWAITING_AUTHORIZATION" && consent.url_to_authenticate;

  return (
    <li className="grid grid-cols-[1fr_150px_104px] items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
      <span className="flex min-w-0 items-center gap-2">
        <Building2 className="size-3.5 shrink-0 text-fg-dim" />
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-fg">{consent.institution_name || consent.institution_id}</span>
          {error && <span className="block text-[10.5px] text-down">{error}</span>}
        </span>
      </span>
      <span>{stateBadge(consent)}</span>
      <span className="flex items-center justify-end gap-1">
        {canAuthorize && (
          <button onClick={() => window.open(consent.url_to_authenticate, "_blank", "noopener")} className="rounded-[8px] bg-fg px-2.5 py-1 font-mono text-[9px] font-medium text-bg">
            AUTORIZAR
          </button>
        )}
        <button onClick={refresh} disabled={busy} title="Reler status" className="grid size-6 place-items-center rounded-[6px] text-fg-dim hover:bg-surface-2 hover:text-fg">
          <RefreshCw className={cn("size-3", busy && "animate-spin")} />
        </button>
        <button onClick={revoke} disabled={busy} title="Revogar" className="grid size-6 place-items-center rounded-[6px] text-fg-dim hover:bg-down/10 hover:text-down">
          <Trash2 className="size-3" />
        </button>
      </span>
    </li>
  );
}

function ConnectCard({ onConnected }: { onConnected: () => void }) {
  const [institutions, setInstitutions] = useState<OFInstitution[]>([]);
  const [query, setQuery] = useState("");
  const [institution, setInstitution] = useState<OFInstitution | null>(null);
  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const search = useCallback(async () => {
    setError("");
    try {
      const res = await api.ofInstitutions(query);
      setInstitutions(res.institutions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui listar os bancos");
    }
  }, [query]);

  useEffect(() => {
    search();
  }, [search]);

  const needsBusiness = institution?.type === "BUSINESS";
  const operational = institutions.filter((i) => i.status === "OPERATIONAL");

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!institution) {
      setError("escolha um banco");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await api.ofConnect({
        institution_id: institution.id,
        cpf,
        cnpj: needsBusiness ? cnpj : "",
        institution_name: institution.name,
      });
      if (res.url_to_authenticate) {
        window.open(res.url_to_authenticate, "_blank", "noopener");
        setNote("Abrimos a autorização no banco. Depois de autorizar, clique em “Já autorizei” na conexão.");
      } else {
        setNote("Conexão criada.");
      }
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui conectar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="hd">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <AiDots width={26} height={24} /> Conectar instituição
        </p>
      </div>
      <form onSubmit={connect} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="busca" className="text-[11px] text-fg-dim">Buscar banco</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-fg-dim" />
            <Input id="busca" placeholder="Itaú, Nubank…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
        </div>

        {operational.length > 0 && (
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto scroll-thin">
            {operational.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setInstitution(i)}
                className={cn(
                  "rounded-[8px] border px-2.5 py-1.5 text-[11.5px] transition-colors",
                  institution?.id === i.id ? "border-accent bg-accent/15 text-accent" : "border-border text-fg hover:bg-surface-2",
                )}
              >
                {i.name}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cpf" className="text-[11px] text-fg-dim">CPF do titular</Label>
          <Input id="cpf" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} className="mono" />
        </div>
        {needsBusiness && (
          <div className="space-y-1.5">
            <Label htmlFor="cnpj" className="text-[11px] text-fg-dim">CNPJ da empresa</Label>
            <Input id="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className="mono" />
          </div>
        )}

        {error && <p className="text-[11.5px] text-down">{error}</p>}
        {note && <p className="text-[11.5px] text-up">{note}</p>}

        <button type="submit" disabled={busy || !institution || !cpf.trim()} className="flex h-[34px] w-full items-center justify-center gap-2 rounded-[10px] bg-accent text-[12px] font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="animate-spin" /> : <Link2 className="size-3.5" />}
          {busy ? "Conectando…" : "Conectar"}
        </button>
      </form>
    </Card>
  );
}