import { useEffect, useState } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { PageHeader, Panel } from "@/components/primitives";
import { applyTheme, currentTheme, onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { logout, setPhone, type SessionInfo } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Ajustes: conta, telefone (o user_id do ledger), tema e sair.
export function SettingsPage() {
  const [theme, setLocalTheme] = useState<Theme>(() => currentTheme());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [phone, setPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => onThemeChange(setLocalTheme), []);
  useEffect(() => {
    import("@/lib/auth").then(({ fetchSession }) =>
      fetchSession().then((s) => {
        setSession(s);
        setPhoneInput(s.phone ?? "");
      }),
    );
  }, []);

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const s = await setPhone(phone);
      setSession(s);
      setMsg({ ok: true, text: "Número atualizado." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "não consegui salvar" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="preferências" title="Ajustes" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Conta">
          <p className="text-[13px] text-muted-foreground">Conectado como</p>
          <p className="text-[13px]">{session?.name || session?.email || "—"}</p>
          <form onSubmit={savePhone} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Número do WhatsApp (user_id)</Label>
              <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhoneInput(e.target.value)} className="font-mono" />
              <p className="text-[11px] text-muted-foreground">Liga esta conta aos lançamentos do bot. Só dígitos, com país.</p>
            </div>
            {msg && <p className={msg.ok ? "text-[13px] text-success" : "text-[13px] text-destructive"}>{msg.text}</p>}
            <Button type="submit" disabled={saving} size="sm">Salvar número</Button>
          </form>
        </Panel>

        <Panel title="Aparência">
          <div className="flex gap-2">
            {(["light", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTheme(t); applyTheme(t); setLocalTheme(t); }}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${
                  theme === t ? "border-primary text-primary" : "border-border hover:bg-secondary"
                }`}
              >
                {t === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {t === "light" ? "Claro" : "Escuro"}
              </button>
            ))}
          </div>
          <button
            onClick={async () => { await logout(); window.location.reload(); }}
            className="mt-5 inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-destructive"
          >
            <LogOut className="size-4" /> Sair da conta
          </button>
        </Panel>
      </div>
    </div>
  );
}
