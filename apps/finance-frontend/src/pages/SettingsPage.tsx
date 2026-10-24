import { useEffect, useState } from "react";
import { LogOut, Moon, Sun } from "lucide-react";
import { Card, Cockpit } from "@/components/primitives";
import { AiDots } from "@/components/aidots";
import { applyTheme, currentTheme, onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { fetchSession, logout, setPhone, type SessionInfo } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Ajustes V3 (ui.pen §V3): profile card com avatar-monograma + stats mono,
// preferências com toggle shadcn (mono caps), zona de risco (vermelho suave)
// e tema claro/escuro. Sem "cockpit editorial".
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

  const initials = (session?.name || session?.email || "GM").slice(0, 2).toUpperCase();

  const row1 = (
    <div className="flex flex-col gap-4">
      {/* Perfil */}
      <Card className="space-y-4 !p-[18px]">
        <div className="flex items-center gap-3">
          <span className="grid size-[46px] shrink-0 place-items-center rounded-full bg-accent text-[14px] font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold tracking-tight">{session?.name || "Usuário"}</p>
            <p className="truncate font-mono text-[9.5px] text-fg-dim">{session?.email}</p>
          </div>
          <span className="pill !py-0.5 font-mono !text-[9px]"><span className="dot bg-up" />online</span>
        </div>
        <div className="flex gap-8 border-t border-border pt-3.5">
          <div>
            <p className="caps">membro desde</p>
            <p className="mono mt-0.5 text-[12.5px] font-semibold">— registro —</p>
          </div>
          <div>
            <p className="caps">whatsapp</p>
            <p className="mono mt-0.5 text-[12.5px] font-semibold">{session?.phone || "vincule o número"}</p>
          </div>
        </div>

        <form onSubmit={savePhone} className="space-y-2.5 border-t border-border pt-4">
          <div className="space-y-1">
            <Label htmlFor="phone" className="text-[11px] text-fg-dim">Número do WhatsApp (user_id)</Label>
            <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhoneInput(e.target.value)} className="mono" />
            <p className="text-[10.5px] dim">Liga esta conta aos lançamentos do bot. Só dígitos, com país (ex.: 5511…).</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="h-[32px] rounded-[10px] bg-fg px-3.5 text-[12px] font-medium text-bg disabled:opacity-50">
              {saving ? "salvando…" : "Salvar número"}
            </button>
            {msg && <p className={msg.ok ? "text-[11.5px] text-up" : "text-[11.5px] text-down"}>{msg.text}</p>}
          </div>
        </form>
      </Card>

      {/* Aparência + sair */}
      <div className="flex flex-col gap-4">
        <Card>
          <div className="hd">
            <p className="caps">aparência</p>
            <AiDots width={26} height={24} />
          </div>
          <div className="seg">
            {(["light", "dark"] as Theme[]).map((t) => (
              <button key={t} data-on={theme === t} onClick={() => { setTheme(t); applyTheme(t); setLocalTheme(t); }}>
                {t === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {t === "light" ? "Claro" : "Escuro"}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] dim">Dots de IA mudam com o tema (ghost claro no modo light).</p>
        </Card>

        <Card>
          <div className="hd"><p className="caps">conta</p></div>
          <button onClick={async () => { await logout(); window.location.reload(); }} className="inline-flex items-center gap-2 text-[12.5px] text-fg-dim transition-colors hover:text-down">
            <LogOut className="size-3.5" /> Sair da conta
          </button>
        </Card>
      </div>
    </div>
  );

  const prefs = [
    ["Avisos no WhatsApp", "transações do dia a dia + réguas de limite", true],
    ["Backfill inicial notifica", "importação histórica de 365 dias", false],
    ["Modo TV", "tela cheia com ciclagem automática", false],
    ["Telemetria", "métricas anônimas de performance", true],
  ] as const;

  const danger = (
    <div className="flex flex-col gap-4">
      <Card className="space-y-2 border-down/40">
        <p className="caps !text-down">zona de risco</p>
        <p className="text-[11.5px] leading-[1.55] text-fg-dim">
          Revogar tudo encerra os consentimentos Open Finance e apaga os dados sincronizados deste servidor.
          Lançamentos manuais continuam.
        </p>
        <span className="text-[10.5px] text-down">a rota de revogação em massa fica na tela Open Finance</span>
      </Card>
      <Card>
        <div className="hd"><p className="caps">preferências do app</p></div>
        <ul className="divide-y divide-border">
          {prefs.map(([t, d, on]) => (
            <li key={t} className="flex h-[38px] items-center gap-3">
              <span className="text-[12px] font-medium text-fg">{t}</span>
              <span className="flex-1 truncate text-[10.5px] text-fg-dim">{d}</span>
              <ToggleV3 on={on} onChange={() => {}} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );

  return (
    <Cockpit
      center={
        <div className="flex flex-col gap-4 pb-6">
          {row1}
          {danger}
        </div>
      }
    />
  );
}

// Toggle shadcn do .pen (Track 32x18, knob 14, brand quando on).
function ToggleV3({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex h-[18px] w-[32px] shrink-0 items-center rounded-full p-[2px] transition-colors",
        on ? "justify-end bg-accent" : "justify-start bg-line-strong",
      )}
    >
      <span className="size-[14px] rounded-full bg-white" />
    </button>
  );
}