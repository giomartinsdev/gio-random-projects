import { useCallback, useEffect, useState } from "react";
import { Building2, Link2, Loader2, RefreshCw, Trash2, Wallet } from "lucide-react";
import {
  api,
  formatBRL,
  type OFAccount,
  type OFConsent,
  type OFInstitution,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// A seção de Open Finance: conectar conta (consentimento), ver as contas com
// saldo, e revogar. O fluxo de autorização acontece no site do banco
// (url_to_authenticate); ao voltar, o usuário clica "Já autorizei" para o app
// reler o status.
export function OpenFinancePage() {
  const [consents, setConsents] = useState<OFConsent[]>([]);
  const [accounts, setAccounts] = useState<OFAccount[]>([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">conexões</p>
          <h1 className="text-2xl">Open Finance</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Conecte seus bancos e acompanhe o saldo.</p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Atualizar">
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {accounts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="size-4" />
                  {a.name || "Conta"}
                </div>
                <p className="tnum text-2xl font-semibold">{formatBRL(a.balance_amount)}</p>
                {a.balance_updated_at && (
                  <p className="text-xs text-muted-foreground">
                    saldo de {new Date(a.balance_updated_at).toLocaleString("pt-BR")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {consents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexões</CardTitle>
            <CardDescription>Bancos autorizados e o estado de cada um.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {consents.map((c) => (
              <ConsentRow key={c.id} consent={c} onChanged={load} />
            ))}
          </CardContent>
        </Card>
      )}

      <ConnectCard onConnected={load} />
    </div>
  );
}

function statusBadge(c: OFConsent) {
  switch (c.status) {
    case "AUTHORISED":
      if (c.execution_status === "AWAITING_RESOURCES") {
        return <Badge variant="warning">o banco está enviando seus dados</Badge>;
      }
      return <Badge variant="success">conectado</Badge>;
    case "AWAITING_AUTHORIZATION":
      return <Badge variant="warning">aguardando autorização</Badge>;
    case "REJECTED":
      return <Badge variant="destructive">rejeitado</Badge>;
    case "EXPIRED":
      return <Badge variant="secondary">expirado</Badge>;
    default:
      return <Badge variant="secondary">{c.status}</Badge>;
  }
}

function ConsentRow({ consent, onChanged }: { consent: OFConsent; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await api.ofRefresh(consent.consent_id);
      // dá um instante para o comando aplicar e relê
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Building2 className="size-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{consent.institution_name || consent.institution_id}</p>
          <div className="mt-0.5">{statusBadge(consent)}</div>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canAuthorize && (
          <Button
            size="sm"
            onClick={() => window.open(consent.url_to_authenticate, "_blank", "noopener")}
          >
            Autorizar no banco
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Já autorizei
        </Button>
        <Button size="sm" variant="ghost" onClick={revoke} disabled={busy} title="Revogar">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
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
        setNote("Abrimos a autorização no banco. Depois de autorizar, clique em “Já autorizei” abaixo.");
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" />
          Conectar conta
        </CardTitle>
        <CardDescription>Escolha o banco e informe o CPF do titular.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={connect} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="busca">Buscar banco</Label>
            <div className="flex gap-2">
              <Input
                id="busca"
                placeholder="Itaú, Nubank…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={search}>
                Buscar
              </Button>
            </div>
          </div>

          {institutions.length > 0 && (
            <div className="flex max-h-48 flex-wrap gap-2 overflow-auto">
              {institutions.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setInstitution(i)}
                  disabled={i.status !== "OPERATIONAL"}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    institution?.id === i.id ? "border-primary bg-accent" : "hover:bg-accent"
                  } ${i.status !== "OPERATIONAL" ? "opacity-50" : ""}`}
                >
                  {i.name}
                  {i.status !== "OPERATIONAL" && (
                    <span className="block text-xs text-muted-foreground">indisponível</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cpf">CPF do titular</Label>
              <Input id="cpf" inputMode="numeric" placeholder="00000000000" value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            {needsBusiness && (
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ da empresa</Label>
                <Input id="cnpj" inputMode="numeric" placeholder="00000000000000" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {note && <p className="text-sm text-success">{note}</p>}

          <Button type="submit" disabled={busy || !institution || !cpf.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
            {busy ? "Conectando…" : "Conectar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
