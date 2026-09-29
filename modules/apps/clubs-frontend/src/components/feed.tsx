// O feed de avisos do hub, num componente reutilizável.
//
// Extraído da home porque agora há DUAS telas que o mostram: a home (os últimos
// 3, como amostra) e a página própria `/feed` (o arquivo, paginado). Duplicar o
// item faria as duas divergirem na primeira mudança de layout.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Announcement } from "../lib/types";
import { Card, Empty, Spinner } from "./ui";
import { ANUNCIO_ICONS, FLOW_ICONS } from "./icons";
import { timeAgo } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";

/** A chave de i18n do tipo de aviso. O dado vem em português (`resultado`)
 * porque o banco é assim desde o início; a interface traduz. */
export const FEED_KIND_KEY: Record<Announcement["kind"], Key> = {
  resultado: "feed.kind.resultado",
  ranking: "feed.kind.ranking",
  jogador: "feed.kind.jogador",
  novidade: "feed.kind.novidade",
};

/** A frase do aviso, montada dos FATOS no idioma escolhido.
 *
 * Sem os fatos (linha antiga, gravada antes de o feed guardar `data`), cai no
 * `title` -- que é o único texto que existe nesse caso. */
export function feedTitle(a: Announcement, t: (k: Key, p?: Record<string, string | number>) => string): string {
  const d = a.data;
  if (d?.result && d.our_goals != null && d.their_goals != null) {
    const key: Key = `feed.result.${d.result}` as Key;
    return t(key, { score: `${d.our_goals}–${d.their_goals}` });
  }
  return a.title;
}

/** Um item do feed. */
export function FeedItem({ a }: { a: Announcement }) {
  const { t } = useI18n();
  // O aviso chega com uma CHAVE semântica (`resultado`), não um emoji: quem
  // desenha escolhe o ícone. O fallback pelo tipo cobre avisos gravados antes
  // desta mudança.
  const Icon = ANUNCIO_ICONS[a.icon] ?? ANUNCIO_ICONS[a.kind] ?? FLOW_ICONS.anuncio;
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)]">
        <Icon className="size-4" style={{ color: "var(--accent)" }} />
      </span>
      <div className="min-w-0">
        <div className="label" style={{ color: "var(--accent)" }}>
          {t(FEED_KIND_KEY[a.kind] ?? "feed.kind.novidade")}
        </div>
        <div className="text-sm font-semibold">{feedTitle(a, t)}</div>
        <div className="mt-1 font-mono text-[10px] text-faint">{timeAgo(a.generated_at)}</div>
      </div>
    </li>
  );
}

/** A lista de avisos: o "arquivo" do hub. */
export function FeedList() {
  const { t } = useI18n();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api
      .announcements(60)
      .then((r) => {
        setList(r.announcements ?? []);
        setTotal(r.total ?? 0);
      })
      .catch(() => setList([]));
  }, []);

  return (
    <Card title={`${t("home.feed")} · ${total}`}>
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title={t("home.feedEmpty")} hint={t("home.feedEmptyHint")} />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.map((a) => (
            <FeedItem key={a.id} a={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}
