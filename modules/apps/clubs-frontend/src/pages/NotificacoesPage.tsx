// Notificações: o que o hub manda para o Discord do clube. Tudo desligável —
// e o hub opera normalmente sem canal configurado.

import { useEffect, useState } from "react";
import { Bell, Megaphone } from "lucide-react";
import { api } from "../lib/api";
import type { NotificationPrefs } from "../lib/types";
import { Badge, Card, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { GoogleSignInButton } from "../components/google-signin";
import { NOTIFY_ICONS, type LucideIcon } from "../components/icons";

const DEFAULTS: NotificationPrefs = {
  canal: "",
  resumo_periodico: true,
  recordes_e_divisoes: true,
  resultado_partidas: true,
};

export function NotificacoesPage({
  authed,
  onSignedIn,
}: {
  authed: boolean | null;
  onSignedIn: () => void;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authed !== true) return;
    api
      .notifications()
      .then((p) => setPrefs({ ...DEFAULTS, ...p }))
      .catch(() => setPrefs(DEFAULTS));
  }, [authed]);

  if (authed === null) return <Spinner label="verificando sua sessão…" />;
  if (!authed) {
    return (
      <>
        <PageHead title="Notificações" sub="Receba no Discord os resultados, os recordes e o resumo do seu clube." />
        <div className="mx-auto max-w-xl">
          <Card title="Entre para configurar">
            <div className="flex flex-col gap-3 px-5 py-5">
              <p className="text-sm text-muted">
                As notificações são pessoais: sem login não há para quem enviar. O resto do hub continua aberto.
              </p>
              <GoogleSignInButton onSuccess={onSignedIn} />
            </div>
          </Card>
        </div>
      </>
    );
  }

  if (!prefs) return <Spinner />;

  const toggle = (key: keyof NotificationPrefs) => {
    setPrefs({ ...prefs, [key]: !prefs[key] });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.saveNotifications(prefs);
      setSaved(true);
    } catch {
      // Uma falha de gravação não pode virar uma tela de erro: o hub continua.
    } finally {
      setSaving(false);
    }
  };

  const rows: Array<{ key: keyof NotificationPrefs; icon: LucideIcon; title: string; desc: string }> = [
    { key: "resumo_periodico", icon: NOTIFY_ICONS.resumo_periodico, title: "Resumo semanal", desc: "Toda segunda, um resumo com os jogos e destaques" },
    { key: "recordes_e_divisoes", icon: NOTIFY_ICONS.recordes_e_divisoes, title: "Recordes e divisões", desc: "Aviso quando o clube bate um recorde ou muda de divisão" },
    { key: "resultado_partidas", icon: NOTIFY_ICONS.resultado_partidas, title: "Resultado das partidas", desc: "Ao fim de cada jogo, com quem foi o melhor em campo" },
  ];

  return (
    <>
      <PageHead
        title="Notificações"
        sub="Escolha o que o hub manda para o Discord do seu clube. Tudo desligável, nada obrigatório."
        actions={<Badge tone={prefs.canal ? "accent" : "default"}>{prefs.canal ? "canal configurado" : "sem canal"}</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="canal" value={prefs.canal || "não configurado"} sub={prefs.canal ? "as mensagens vão para cá" : "nada é enviado até configurar"} accent={!!prefs.canal} />
        <Stat label="avisos ligados" value={fmtOn(rows.filter((r) => prefs[r.key]).length)} sub={`de ${rows.length}`} />
        <Stat label="clube" value="o que você segue" sub="as mensagens são por clube" />
      </div>

      <Card title="O que você quer receber">
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.key} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--surface-3)]">
                  <Icon className="size-4" strokeWidth={2} style={{ color: "var(--text-muted)" }} />
                </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{r.title}</span>
                <span className="block text-xs text-muted">{r.desc}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={!!prefs[r.key]}
                onClick={() => toggle(r.key)}
                className="relative h-6 w-11 shrink-0 rounded-full border transition-colors"
                style={
                  prefs[r.key]
                    ? { background: "var(--accent-soft)", borderColor: "var(--accent)" }
                    : { background: "var(--surface-3)", borderColor: "var(--border-strong)" }
                }
              >
                <span
                  className="absolute top-[2px] size-[18px] rounded-full transition-[transform,background]"
                  style={{
                    left: 2,
                    transform: prefs[r.key] ? "translateX(18px)" : "none",
                    background: prefs[r.key] ? "var(--accent)" : "var(--text-faint)",
                  }}
                />
              </button>
            </li>
            );
          })}
        </ul>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Canal do Discord">
          <div className="flex flex-col gap-2 px-4 py-4">
            <label className="flex flex-col gap-2">
              <span className="label">webhook ou canal</span>
              <input
                value={prefs.canal}
                onChange={(e) => {
                  setPrefs({ ...prefs, canal: e.target.value });
                  setSaved(false);
                }}
                placeholder="ex.: #vilanova-digest"
                className="rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm outline-none"
              />
            </label>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-1 rounded-md px-4 py-2 font-display text-xs font-bold uppercase tracking-wide disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {saving ? "salvando…" : saved ? "salvo" : "salvar"}
            </button>
            <p className="text-xs text-muted">
              Deixe em branco para desligar: o hub continua funcionando normalmente, sem erro na tela.
            </p>
          </div>
        </Card>

        <Card title="Prévia das mensagens">
          <div className="px-4 py-4">
            <div className="surface overflow-hidden">
              <div className="hair-b flex items-center gap-2 px-3 py-2 text-xs text-muted">
                <Bell className="size-3.5" />
                <b className="font-display">{prefs.canal || "#seu-clube"}</b>
              </div>
              <div className="flex gap-3 px-3 py-3">
                <Megaphone className="size-4 shrink-0" style={{ color: "var(--accent)" }} />
                <div>
                  <div className="text-sm font-bold">Recap da semana</div>
                  <div className="text-xs text-muted">
                    Resultados, melhor XI por nota e o destaque da rodada — o mesmo conteúdo que a aba Números
                    mostra.
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              As mensagens são geradas a partir dos mesmos fatos que o hub grava: nenhum conteúdo é digitado à mão.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function fmtOn(n: number): string {
  return String(n);
}
