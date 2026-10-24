import { useState } from "react";
import { Loader2, Smartphone, Wallet } from "lucide-react";
import { setPhone, type SessionInfo } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

// Passo de vínculo: o login do Google prova o e-mail, mas o ledger é chaveado
// pelo telefone (o mesmo do WhatsApp). Aqui a pessoa informa o número; é ele
// que liga a conta web ao histórico que o bot já registra.
export function PhoneLinkPage({
  session,
  onLinked,
}: {
  session: SessionInfo;
  onLinked: () => void;
}) {
  const [phone, setPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await setPhone(phone);
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui salvar o número");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="size-4 text-primary" />
          finance
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-20">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Smartphone className="size-5" />
            </div>
            <CardTitle className="text-lg">Seu número do WhatsApp</CardTitle>
            <CardDescription>
              Olá, {session.name || session.email}. Informe o número que você usa no WhatsApp — é ele
              que liga esta conta aos seus lançamentos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Número (com DDD e país)</Label>
                <Input
                  id="phone"
                  inputMode="tel"
                  placeholder="5521981962914"
                  value={phone}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  autoComplete="tel"
                />
                <p className="text-xs text-muted-foreground">
                  Só dígitos, começando pelo país. Ex.: 55 21 98196-2914, sem espaços.
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={saving || !phone.trim()} className="w-full">
                {saving ? <Loader2 className="animate-spin" /> : null}
                {saving ? "Salvando…" : "Vincular e continuar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
