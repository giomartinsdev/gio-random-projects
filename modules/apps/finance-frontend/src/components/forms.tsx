import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { api, type TransactionType } from "@/lib/api";
import { occurredAtForDay, toDecimalString } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CATEGORIES = [
  "Alimentação",
  "Transporte",
  "Contas",
  "Lazer",
  "Saúde",
  "Educação",
  "Moradia",
  "Renda Extra",
  "Outros",
];

// "45", "45,50", "1.234,56" -> decimal canônico, ou null. O domínio proíbe
// float (§3.4); a regra vive em lib/money.ts e é testada à parte.

export function TransactionForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<TransactionType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = toDecimalString(amount);
    if (value === null) {
      setMsg({ ok: false, text: "Informe um valor maior que zero, ex.: 45,00." });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      // occurred_at tz-aware: meia-noite local com offset.
      const occurredAt = occurredAtForDay(date);
      await api.registerTransaction({
        transaction_type: type,
        amount: value,
        category,
        occurred_at: occurredAt,
      });
      setAmount("");
      setMsg({ ok: true, text: "Registrado! O painel atualiza em instantes." });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "não consegui registrar" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nova transação</CardTitle>
        <CardDescription>Igual ao que você faz por mensagem, só que na tela.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
                <SelectTrigger id="tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXPENSE">Despesa</SelectItem>
                  <SelectItem value="INCOME">Receita</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="categoria">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="categoria">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="valor">Valor (R$)</Label>
              <Input
                id="valor"
                inputMode="decimal"
                placeholder="45,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="data">Data</Label>
              <Input id="data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {msg && (
            <p className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>
          )}

          <Button type="submit" disabled={sending} className="w-full sm:w-auto">
            {sending ? <Loader2 className="animate-spin" /> : <Plus />}
            {sending ? "Registrando…" : "Registrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function BudgetForm({ onDone }: { onDone: () => void }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [limit, setLimit] = useState("");
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = toDecimalString(limit);
    if (value === null) {
      setMsg({ ok: false, text: "Informe um limite maior que zero." });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      await api.setBudget({ category, limit: value, period });
      setLimit("");
      setMsg({ ok: true, text: "Orçamento definido. Você é avisado ao cruzar 50%, 80% e 100%." });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "não consegui salvar" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Orçamento do mês</CardTitle>
        <CardDescription>Limite por categoria, com alertas em 50%, 80% e 100%.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="b-cat">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="b-cat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-lim">Limite (R$)</Label>
              <Input
                id="b-lim"
                inputMode="decimal"
                placeholder="600,00"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-per">Mês</Label>
              <Input
                id="b-per"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
          </div>

          {msg && (
            <p className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>
          )}

          <Button type="submit" disabled={sending} className="w-full sm:w-auto">
            {sending ? <Loader2 className="animate-spin" /> : <Plus />}
            {sending ? "Salvando…" : "Definir orçamento"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
