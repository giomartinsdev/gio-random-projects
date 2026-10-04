import { useEffect, useState } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { Card, Cockpit, PageHead } from "@/components/primitives";
import { applyTheme, currentTheme, onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { fetchSession, logout, setPhone, type SessionInfo } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const [theme, setLocalTheme] = useState<Theme>(() => currentTheme());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [phone, setPhoneInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => onThemeChange(setLocalTheme), []);
  useEffect(() => {
    fetchSession().then((s) => {
      setSession(s);
      setPhoneInput(s.phone ?? "");
    });
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

  const center = (
    <div className="space-y-3">
      <PageHead kick="preferências" title="Ajustes" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card title="Conta">
          <p className="text-[12px] dim">Conectado como</p>
          <p className="text-[13px]">{session?.name || session?.email || "—"}</p>
          <form onSubmit={savePhone} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Número do WhatsApp (user_id)</Label>
              <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhoneInput(e.target.value)} className="font-mono" />
              <p className="text-[11px] dim">Liga esta conta aos lançamentos do bot. Só dígitos, com país.</p>
            </div>
            {msg && <p className={msg.ok ? "text-[13px] text-success" : "text-[13px] text-down"}>{msg.text}</p>}
            <Button type="submit" disabled={saving} size="sm">Salvar número</Button>
          </form>
        </Card>

        <Card title="Aparência">
          <div className="seg">
            {(["light", "dark"] as Theme[]).map((t) => (
              <button key={t} data-on={theme === t} onClick={() => { setTheme(t); applyTheme(t); setLocalTheme(t); }}>
                {t === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {t === "light" ? "Claro" : "Escuro"}
              </button>
            ))}
          </div>
          <button onClick={async () => { await logout(); window.location.reload(); }} className="mt-6 inline-flex items-center gap-2 text-[13px] dim hover:text-down">
            <LogOut className="size-3.5" /> Sair da conta
          </button>
        </Card>
      </div>
    </div>
  );

  return <Cockpit center={center} />;
}
