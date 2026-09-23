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
import { useI18n } from "../lib/i18n";

const DEFAULTS: NotificationPrefs = {
  channel: "",
  weekly_digest: true,
  records_and_divisions: true,
  match_results: true,
};

export function NotificationsPage({
  authed,
  onSignedIn,
}: {
  authed: boolean | null;
  onSignedIn: () => void;
}) {
  const { t } = useI18n();
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

  if (authed === null) return <Spinner label={t("area.checkingSession")} />;
  if (!authed) {
    return (
      <>
        <PageHead title={t("notif.title")} sub={t("notif.subtitle2")} />
        <div className="mx-auto max-w-xl">
          <Card title={t("notif.signInToConfigure")}>
            <div className="flex flex-col gap-3 px-5 py-5">
              <p className="text-sm text-muted">
                {t("notif.personalHint")}
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
    { key: "weekly_digest", icon: NOTIFY_ICONS.weekly_digest, title: t("notif.weekly"), desc: t("notif.weeklyHint") },
    { key: "records_and_divisions", icon: NOTIFY_ICONS.records_and_divisions, title: t("notif.records"), desc: t("notif.recordsHint") },
    { key: "match_results", icon: NOTIFY_ICONS.match_results, title: t("notif.results"), desc: t("notif.resultsHint") },
  ];

  return (
    <>
      <PageHead
        title={t("notif.title")}
        sub={t("notif.subtitle")}
        actions={<Badge tone={prefs.channel ? "accent" : "default"}>{prefs.channel ? t("notif.channelConfigured") : t("notif.noChannel")}</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t("notif.channel")} value={prefs.channel || t("notif.notConfigured")} sub={prefs.channel ? t("notif.messagesGoHere") : t("notif.nothingSent")} accent={!!prefs.channel} />
        <Stat label={t("notif.alertsOn")} value={fmtOn(rows.filter((r) => prefs[r.key]).length)} sub={`/ ${rows.length}`} />
        <Stat label={t("common.club")} value={t("notif.youFollow")} sub={t("notif.messagesPerClub")} />
      </div>

      <Card title={t("notif.whatToReceive")}>
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
        <Card title={t("notif.discordTitle")}>
          <div className="flex flex-col gap-2 px-4 py-4">
            <label className="flex flex-col gap-2">
              <span className="label">{t("notif.discordHint")}</span>
              <input
                value={prefs.channel}
                onChange={(e) => {
                  setPrefs({ ...prefs, channel: e.target.value });
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
              {saving ? t("action.saving") : saved ? t("action.saved") : t("action.save")}
            </button>
            <p className="text-xs text-muted">
              {t("notif.leaveBlank")}
            </p>
          </div>
        </Card>

        <Card title={t("notif.preview")}>
          <div className="px-4 py-4">
            <div className="surface overflow-hidden">
              <div className="hair-b flex items-center gap-2 px-3 py-2 text-xs text-muted">
                <Bell className="size-3.5" />
                <b className="font-display">{prefs.channel || "#seu-clube"}</b>
              </div>
              <div className="flex gap-3 px-3 py-3">
                <Megaphone className="size-4 shrink-0" style={{ color: "var(--accent)" }} />
                <div>
                  <div className="text-sm font-bold">{t("notif.previewTitle")}</div>
                  <div className="text-xs text-muted">
                    {t("notif.previewBody")}
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              {t("notif.previewHint")}
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
