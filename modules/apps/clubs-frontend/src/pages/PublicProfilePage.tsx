// Perfil público: a página que uma pessoa ESCOLHEU tornar pública.
//
// O padrão do hub é isolar dado pessoal (FR-025/SC-005); esta tela só mostra
// algo quando a pessoa ligou `publico` nas preferências. O que aparece é o que
// já era público -- o pro reivindicado (com o selo de verificado) e os clubes
// que ela segue --, nunca o e-mail.

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type { PublicProfile } from "../lib/types";
import { Card, Crest, Empty, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { fmt } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { DocumentMeta } from "../lib/document-meta";

export function PublicProfilePage({ handle, onOpenClub }: { handle: string; onOpenClub: (id: string) => void }) {
  const { t } = useI18n();
  const [p, setP] = useState<PublicProfile | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setP(null);
    setErro(false);
    api.publicProfile(handle).then(setP).catch(() => setErro(true));
  }, [handle]);

  if (erro) {
    return (
      <>
        <PageHead title={t("profile.title")} />
        <Empty title={t("profile.notFound")} hint={t("profile.notFoundHint")} />
      </>
    );
  }
  if (!p) return <Spinner label={t("player.loading")} />;

  const clubs = p.clubs ?? [];
  return (
    <>
      <DocumentMeta
        title={p.gamertag || handle}
        description={`${t("profile.title")} · ${clubs.length} ${t("common.clubs")}`}
        path={`/u/${handle}`}
      />
      <PageHead
        title={p.gamertag || `@${handle}`}
        sub={`@${p.handle}`}
        actions={
          p.pro?.verified ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--success)" }}>
              <VerifiedIcon /> {t("claim.verified")}
            </span>
          ) : undefined
        }
      />

      {p.pro && (
        <div className="mb-4">
          <Card title={t("area.yourPro2")}>
            <button
              type="button"
              onClick={() => onOpenClub(p.pro!.club_id)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-3"
            >
              <Crest
                club={{ name: p.pro.club_name, tag: p.pro.club_tag, color_1: 0, color_2: 0, color_3: 0, color_4: 0, crest_asset_id: "", club_id: p.pro.club_id }}
                size={40}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{p.gamertag}</span>
                <span className="block font-mono text-[10px] text-faint">{p.pro.club_name}</span>
              </span>
              <ShieldCheck className="size-4" style={{ color: "var(--success)" }} />
            </button>
          </Card>
        </div>
      )}

      <Card title={`${t("area.clubsYouFollow2")} · ${fmt(clubs.length)}`}>
        {clubs.length === 0 ? (
          <Empty title={t("area.noneFollowed")} hint={t("area.noneFollowedHint")} />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {clubs.map((c) => (
              <li key={c.club_id}>
                <button
                  type="button"
                  onClick={() => onOpenClub(c.club_id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                >
                  <Crest club={{ name: c.name, tag: c.tag, color_1: 0, color_2: 0, color_3: 0, color_4: 0, crest_asset_id: "", club_id: c.club_id }} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                  <span className="font-mono text-[10px] text-faint">D{c.division_at_read}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
