import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogOut, Trash2 } from "lucide-react";
import {
  deleteCredential,
  getMe,
  listCredentials,
  logout,
  saveCredential,
  saveUnitValue,
  type Me,
  type SavedCredential,
} from "@/lib/api";
import { formatBRL, formatDateTime, parseBRLToCents } from "@/lib/format";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { loadingIcon } from "@/lib/lottie-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The settings tab: the unit value (edited any time; only future bets
// use the new value), the bookmaker credentials (stored AES-encrypted
// at rest; the BFF only ever echoes the username back), and the logout
// hop.
export function SettingsPage({ me }: { me: Me }) {
  const [unitInput, setUnitInput] = useState(() => (me.unitValueCents / 100).toFixed(2).replace(".", ","));
  const [saved, setSaved] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  const [currentMe, setCurrentMe] = useState<Me>(me);

  async function saveUnit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseBRLToCents(unitInput);
    if (cents === null) {
      setUnitError("digite um valor válido, ex.: 10,50");
      return;
    }
    setSavingUnit(true);
    setUnitError(null);
    setSaved(null);
    try {
      const result = await saveUnitValue(cents);
      setCurrentMe({ ...currentMe, unitValueCents: result.unitValueCents });
      setSaved(`valor da unidade salvo: ${formatBRL(result.unitValueCents)}`);
    } catch {
      setUnitError("não deu pra salvar — tente de novo");
    } finally {
      setSavingUnit(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-center text-xs text-muted-foreground">logado como {currentMe.email}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Valor da unidade</CardTitle>
          <CardDescription>
            Cada link aposta N unidades × este valor. Apostas já na fila mantêm o valor antigo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveUnit} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="unit">Valor (R$)</Label>
              <Input
                id="unit"
                inputMode="decimal"
                placeholder="10,50"
                value={unitInput}
                onChange={(event) => setUnitInput(event.target.value)}
                required
              />
            </div>
            <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
              <Button type="submit" disabled={savingUnit}>
                {savingUnit ? <AnimatedIcon animation={loadingIcon} autoplay loop /> : null}
                Salvar
              </Button>
            </motion.div>
          </form>
          {unitError && <p className="mt-2 text-sm text-destructive">{unitError}</p>}
          {saved && (
            <Alert className="mt-3">
              <AlertDescription>{saved}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <CredentialsCard currentMe={currentMe} onRefreshed={setCurrentMe} />

      <Button variant="outline" className="w-full" onClick={logout}>
        <LogOut />
        Sair
      </Button>
    </div>
  );
}

function CredentialsCard({
  currentMe,
  onRefreshed,
}: {
  currentMe: Me;
  onRefreshed: (me: Me) => void;
}) {
  const [savedCredentials, setSavedCredentials] = useState<SavedCredential[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listCredentials()
      .then((body) => {
        if (!cancelled) setSavedCredentials(body.credentials);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function onSaved() {
    // The /api/me credential list drives the "pronto pra apostar" check;
    // refresh it so a first-time save lights the home tab up.
    void getMe().then(onRefreshed);
    void listCredentials().then((body) => setSavedCredentials(body.credentials));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Credenciais</CardTitle>
        <CardDescription>
          Login das casas de aposta — a senha é cifrada e só o runner a usa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentMe.knownVendors.map((vendor) => (
          <VendorCredentialForm
            key={vendor.id}
            vendorId={vendor.id}
            vendorLabel={vendor.label}
            saved={savedCredentials.find((c) => c.vendor === vendor.id) ?? null}
            onChanged={onSaved}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function VendorCredentialForm({
  vendorId,
  vendorLabel,
  saved,
  onChanged,
}: {
  vendorId: string;
  vendorLabel: string;
  saved: SavedCredential | null;
  onChanged: () => void;
}) {
  const [username, setUsername] = useState(saved?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setSavedAt(saved?.updatedAt ?? null);
  }, [saved?.updatedAt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await saveCredential(vendorId, username.trim(), password);
      setPassword("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "não deu pra salvar");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteCredential(vendorId);
      setSavedAt(null);
      onChanged();
    } catch {
      setError("não deu pra remover");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <Label className="text-base">{vendorLabel}</Label>
        {savedAt && (
          <span className="text-xs text-green-500">salvo em {formatDateTime(savedAt)}</span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="usuário"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          required
        />
        <Input
          type="password"
          placeholder={saved ? "nova senha (opcional se igual)" : "senha"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required={!saved}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <AnimatedIcon animation={loadingIcon} autoplay loop /> : null}
          Salvar credenciais
        </Button>
        {saved && (
          <Button type="button" variant="outline" size="sm" onClick={remove} disabled={busy}>
            <Trash2 />
            Remover
          </Button>
        )}
      </div>
    </form>
  );
}