import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Plus, Trash2 } from "lucide-react";
import { api, formatBRL, type Notification } from "@/lib/api";
import { Card, Cockpit, Empty, PageHead } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["Alimentação", "Transporte", "Contas", "Lazer", "Saúde", "Educação", "Moradia", "Compras", "Outros"];

// Notificações no formato cockpit: centro com as regras, rail direito com o
// formulário. O disparo é do worker conversacional (WhatsApp).
export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.notifications();
      setItems(res.notifications ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    try {
      await api.deleteNotification(id);
      setTimeout(load, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui remover");
    }
  }

  const center = (
    <div className="space-y-3">
      <PageHead kick="avisos" title="Notificações" sub="Regras que disparam um aviso no seu WhatsApp." />
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card>
        {loading ? (
          <Empty text="carregando…" />
        ) : items.length === 0 ? (
          <Empty text="Nenhuma regra de aviso cadastrada." />
        ) : (
          <ul>
            {items.map((n) => (
              <li key={n.id} className="row">
                <span className="av">{n.enabled ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{describe(n)}</span>
                  <span className="block text-[11px] dim">canal {n.channel} · {n.enabled ? "ativa" : "pausada"}</span>
                </span>
                <button onClick={() => remove(n.id)} className="p-1.5 text-fg-dim hover:text-down" title="Remover">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  return <Cockpit center={center} right={<NotificationForm onDone={load} />} />;
}

function describe(n: Notification): string {
  switch (n.kind) {
    case "category_threshold": return `Avisar quando ${n.category || "uma categoria"} passar de ${formatBRL(n.threshold)}`;
    case "large_transaction": return `Avisar em transações acima de ${formatBRL(n.threshold)}`;
    case "any_transaction": return "Avisar em toda transação";
    default: return n.kind;
  }
}

function NotificationForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<string>("category_threshold");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const needsThreshold = kind !== "any_transaction";
  const needsCategory = kind === "category_threshold";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = toDecimal(threshold);
    if (needsThreshold && !value) return setMsg({ ok: false, text: "Informe um valor maior que zero." });
    setBusy(true);
    setMsg(null);
    try {
      await api.setNotification({ kind, category: needsCategory ? category : undefined, threshold: needsThreshold ? value! : undefined, enabled: true });
      setThreshold("");
      setMsg({ ok: true, text: "Regra criada." });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "não consegui salvar" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Nova regra">
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="category_threshold">Categoria passou de um valor</SelectItem>
              <SelectItem value="large_transaction">Transação grande</SelectItem>
              <SelectItem value="any_transaction">Toda transação</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsCategory && (
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {needsThreshold && (
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input inputMode="decimal" placeholder="300,00" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        )}
        {msg && <p className={msg.ok ? "text-[13px] text-success" : "text-[13px] text-down"}>{msg.text}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Criar regra
        </Button>
      </form>
    </Card>
  );
}

function toDecimal(raw: string): string | null {
  const clean = raw.trim().replace(/\s/g, "");
  const n = clean.includes(",") && clean.includes(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toFixed(2) : null;
}
