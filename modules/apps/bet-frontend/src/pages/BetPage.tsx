import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { ApiError, placeBet, type Me } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The home tab: paste a betano link, say how many units, watch the
// stake preview live (units × the unit value configured in settings --
// the BFF snapshots that product at submission time). Execution is
// direct: the bet enters the queue and the runner takes it from there,
// no confirmation step.
export function BetPage({ me }: { me: Me }) {
  const [url, setUrl] = useState("");
  const [units, setUnits] = useState("1");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);

  const unitsNumber = Number(units);
  const validUnits = Number.isSafeInteger(unitsNumber) && unitsNumber >= 1 && unitsNumber <= 100;
  const validUrl = url.trim().length > 0;
  const stakeCents = validUnits ? unitsNumber * me.unitValueCents : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validUnits || !validUrl) return;
    setSending(true);
    setError(null);
    setQueued(null);
    try {
      const bet = await placeBet(url.trim(), unitsNumber);
      setQueued(
        `aposta enfileirada: ${formatBRL(bet.stakeCents)} na ${bet.vendor} — acompanhe no histórico`,
      );
      setUrl("");
      setUnits("1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "falha de rede — tente de novo");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>colocar aposta</CardTitle>
          <CardDescription>
            Cole o link da betano e quantas unidades apostar — o runner faz o resto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="url">link da bet</Label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="url"
                  className="pl-10"
                  placeholder="https://www.betano.com.br/..."
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  inputMode="url"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="units">unidades</Label>
              <Input
                id="units"
                type="number"
                min={1}
                max={100}
                step={1}
                value={units}
                onChange={(event) => setUnits(event.target.value)}
                required
              />
            </div>

            {stakeCents !== null && (
              <div className="rounded-2xl border-2 bg-secondary/60 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {unitsNumber} {unitsNumber === 1 ? "unidade" : "unidades"} × {formatBRL(me.unitValueCents)} ={" "}
                </span>
                <span className="font-display text-lg font-bold">{formatBRL(stakeCents)}</span>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {queued && (
              <Alert>
                <AlertDescription>{queued}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={!validUnits || !validUrl || sending}>
              {sending ? <Loader2 className="animate-spin" /> : null}
              {sending ? "enviando…" : "Enviar aposta"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        valor da unidade atual: {formatBRL(me.unitValueCents)} (altere nos ajustes)
      </p>
    </div>
  );
}