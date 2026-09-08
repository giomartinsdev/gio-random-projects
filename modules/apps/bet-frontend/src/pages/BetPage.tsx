import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ApiError, placeBet, type Me } from "@/lib/api";
import { formatBRL } from "@/lib/format";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { arrowRightCircleIcon, loadingIcon } from "@/lib/lottie-icons";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Colocar aposta</CardTitle>
        <CardDescription>
          Cole o link da betano e quantas unidades apostar — o runner faz o resto.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Link da aposta</Label>
            <Input
              id="url"
              placeholder="https://www.betano.com.br/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono tracking-wide"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="units">Unidades</Label>
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
            <p className="text-xs text-muted-foreground">
              1 unidade = {formatBRL(me.unitValueCents)} — o valor da unidade muda nos ajustes.
            </p>
          </div>

          {stakeCents !== null && (
            <div className="rounded-md border bg-secondary/50 px-3 py-2 text-sm">
              {unitsNumber} {unitsNumber === 1 ? "unidade" : "unidades"} × {formatBRL(me.unitValueCents)} ={" "}
              <span className="font-semibold">{formatBRL(stakeCents)}</span>
            </div>
          )}

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </motion.div>
            )}
            {queued && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                <Alert>
                  <AlertDescription>{queued}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
            <Button type="submit" className="w-full" disabled={!validUnits || !validUrl || sending}>
              <AnimatedIcon
                animation={sending ? loadingIcon : arrowRightCircleIcon}
                autoplay={sending}
                loop={sending}
              />
              {sending ? "enviando…" : "Enviar aposta"}
            </Button>
          </motion.div>
        </form>
      </CardContent>
    </Card>
  );
}