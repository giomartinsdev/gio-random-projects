// Home: anúncios + rankings globais. É a porta de entrada e funciona sem login.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Announcement, ClubRef, RankPlayer } from "../lib/types";
import { Badge, Bar, Card, Crest, Empty, Pager, RankMedallion, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { ANUNCIO_ICONS, FLOW_ICONS, VerifiedIcon } from "../components/icons";
import { BarChart } from "../components/charts";
import { fmt, POS_SHORT, timeAgo } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";

/** A chave de i18n do tipo de aviso. O dado vem em português (`resultado`)
 * porque o banco é assim desde o início; a interface traduz. */
const FEED_KIND_KEY: Record<Announcement["kind"], Key> = {
  resultado: "feed.kind.resultado",
  ranking: "feed.kind.ranking",
  jogador: "feed.kind.jogador",
  novidade: "feed.kind.novidade",
};

/** A frase do aviso, montada dos FATOS no idioma escolhido.
 *
 * Sem os fatos (linha antiga, gravada antes de o feed guardar `data`), cai no
 * `title` -- que é o único texto que existe nesse caso. */
function feedTitle(a: Announcement, t: (k: Key, p?: Record<string, string | number>) => string): string {
  const d = a.data;
  if (d?.result && d.our_goals != null && d.their_goals != null) {
    const key: Key = `feed.result.${d.result}` as Key;
    return t(key, { score: `${d.our_goals}–${d.their_goals}` });
  }
  return a.title;
}

type RankTab = "clubs" | "players";

// A home não é o arquivo: o feed mostra os últimos 3 e o ranking, 10 por
// página. Quem quer tudo vai para Clubes/Jogadores.
const FEED = 3;
const PER_PAGE = 10;

export function HomePage({ onOpenClub, onOpenPlayer }: { onOpenClub: (id: string) => void; onOpenPlayer: (id: string) => void }) {
  const { t } = useI18n();
  const [announcements, setAnuncios] = useState<Announcement[] | null>(null);
  const [totalAnuncios, setTotalAnuncios] = useState(0);
  const [tab, setTab] = useState<RankTab>("clubs");
  const [metric, setMetrica] = useState("skill_rating");
  const [page, setPage] = useState(0);
  const [clubs, setClubes] = useState<ClubRef[] | null>(null);
  const [players, setJogadores] = useState<RankPlayer[] | null>(null);
  const [totalRanking, setTotalRanking] = useState(0);
  // Os números do cabeçalho são totais, não o tamanho da página: depois de
  // paginar o ranking, `clubes.length` passou a ser 10. O índice de clubes
  // vem de /api/clubs (que devolve a lista inteira, sem paginar).
  const [totalClubes, setTotalClubes] = useState<number | null>(null);
  // O número do cabeçalho é o índice inteiro, não a página do ranking: o
  // ranking carrega só ao abrir a aba, então usá-lo aqui mostrava 0 na home.
  const [totalJogadores, setTotalJogadores] = useState<number | null>(null);
  const [error, setErro] = useState("");

  useEffect(() => {
    api
      .announcements(FEED)
      .then((r) => {
        setAnuncios(r.announcements ?? []);
        setTotalAnuncios(r.total ?? 0);
      })
      .catch(() => setAnuncios([]));
  }, []);

  useEffect(() => {
    api.playerCount().then(setTotalJogadores).catch(() => setTotalJogadores(0));
    api.clubs().then((r) => setTotalClubes(r.total ?? (r.clubs?.length ?? 0))).catch(() => setTotalClubes(0));
  }, []);

  // Trocar de aba ou de métrica volta à primeira página: manter a página 5
  // numa ordenação nova mostraria um recorte sem sentido.
  useEffect(() => {
    setPage(0);
  }, [tab, metric]);

  useEffect(() => {
    setErro("");
    const offset = page * PER_PAGE;
    if (tab === "clubs") {
      api
        .rankingClubs(metric, PER_PAGE, offset)
        .then((r) => {
          setClubes(r.clubs ?? []);
          setTotalRanking(r.total ?? 0);
        })
        .catch((e) => setErro(String(e)));
    } else {
      api
        .rankingPlayers(metric === "skill_rating" ? "rating" : metric, PER_PAGE, offset)
        .then((r) => {
          setJogadores(r.players ?? []);
          setTotalRanking(r.total ?? 0);
        })
        .catch((e) => setErro(String(e)));
    }
  }, [tab, metric, page]);

  const metricas = tab === "clubs"
    ? [
        { id: "skill_rating", label: t("admin.levelReadings") && t("home.metric.levelShort") },
        { id: "pontos", label: t("common.points") },
        { id: "goals", label: t("common.goals") },
        { id: "clean_sheets", label: t("home.metric.cleanSheetsShort") },
      ]
    : [
        { id: "rating", label: t("common.rating") },
        { id: "goals", label: t("common.goals") },
        { id: "assists", label: t("home.metric.assistsShort") },
        { id: "goals_per_game", label: t("home.metric.goalsPerGame") },
      ];

  const maxClube = Math.max(...(clubs ?? []).map((c) => c.skill_rating), 1);
  const maxJogador = Math.max(...(players ?? []).map((p) => p.rating), 1);

  // A posição é absoluta, não da página: o medalhão da página 2 começa em 11.
  const posBase = page * PER_PAGE;
  const totalPages = Math.max(1, Math.ceil(totalRanking / PER_PAGE));
  // O rótulo nomeia o recorte, porque "1 / 2" sozinho não diz de quê.
  const pagerLabel = `${fmt(posBase + (tab === "clubs" ? clubs?.length ?? 0 : players?.length ?? 0))} / ${fmt(totalRanking)}`;

  return (
    <>
      <PageHead
        title={t("home.title")}
        sub={t("home.subtitle")}
        actions={<Badge tone="accent">pro clubs · ea fc 27</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${t("common.clubs")} ${t("common.index")}`} value={fmt(totalClubes ?? 0)} sub={t("home.subtitle") && t("common.history")} accent />
        <Stat label={t("home.playersIndexed")} value={fmt(totalJogadores ?? 0)} sub={t("home.knownByMatches")} />
        <Stat label={t("home.announcements")} value={fmt(totalAnuncios)} sub={t("home.generatedFromResults")} />
        <Stat label={t("common.history")} value={t("home.continuous")} sub={t("home.growsEachUpdate")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title={t("home.feed")}>
          {announcements === null ? (
            <Spinner />
          ) : announcements.length === 0 ? (
            <Empty
              title={t("home.feedEmpty")}
              hint={t("home.feedEmptyHint")}
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {announcements.map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)]">
                    {(() => {
                      // O aviso chega com uma CHAVE semântica (`resultado`),
                      // não um emoji: quem desenha escolhe o ícone. O fallback
                      // pelo tipo cobre avisos gravados antes desta mudança.
                      const Icon =
                        ANUNCIO_ICONS[a.icon] ?? ANUNCIO_ICONS[a.kind] ?? FLOW_ICONS.anuncio;
                      return <Icon className="size-4" style={{ color: "var(--accent)" }} />;
                    })()}
                  </span>
                  <div className="min-w-0">
                    <div className="label" style={{ color: "var(--accent)" }}>
                      {t(FEED_KIND_KEY[a.kind] ?? "feed.kind.novidade")}
                    </div>
                    <div className="text-sm font-semibold">{feedTitle(a, t)}</div>
                    <div className="mt-1 font-mono text-[10px] text-faint">{timeAgo(a.generated_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Nível por clube">
          <div className="px-2 py-3">
            {clubs && clubs.length > 0 ? (
              <BarChart
                height={210}
                items={clubs.slice(0, 7).map((c) => ({ label: c.tag || c.name.slice(0, 3), value: c.skill_rating }))}
              />
            ) : (
              <Empty title={t("common.noData")} hint={t("home.levelEmptyHint")} />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title={t("home.globalRanking")}
          actions={
            <>
              <div className="flex rounded-md border border-line bg-surface-2 p-[3px]">
                {(["clubs", "players"] as RankTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTab(t);
                      setMetrica(t === "clubs" ? "skill_rating" : "rating");
                    }}
                    aria-pressed={tab === t}
                    className="rounded-sm px-3 py-1 text-xs font-semibold capitalize transition-colors"
                    style={
                      tab === t
                        ? { background: "var(--surface)", color: "var(--text)" }
                        : { color: "var(--text-muted)" }
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          }
        >
          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
            {metricas.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetrica(m.id)}
                aria-pressed={metric === m.id}
                className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                style={
                  metric === m.id
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {error ? (
            <Empty title={t("home.rankingFailed")} hint={error} />
          ) : tab === "clubs" ? (
            clubs === null ? (
              <Spinner />
            ) : clubs.length === 0 ? (
              <Empty title={t("home.noClubs")} hint={t("home.noClubsHint")} />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {clubs.map((c, i) => (
                  <li key={c.club_id}>
                    <button
                      type="button"
                      onClick={() => onOpenClub(c.club_id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                    >
                      <RankMedallion pos={posBase + i + 1} />
                      <Crest club={c} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.name}</span>
                        <span className="block font-mono text-[10px] text-faint">
                          D{c.division_at_read} · {fmt(c.points)} {t("common.points")}
                        </span>
                      </span>
                      <span className="hidden w-32 sm:block">
                        <Bar value={c.skill_rating} max={maxClube} />
                      </span>
                      <span className="tnum w-16 text-right font-mono text-sm font-bold text-accent">
                        {fmt(metric === "points" ? c.points : metric === "goals" ? c.goals : metric === "clean_sheets" ? c.clean_sheets : c.skill_rating)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : players === null ? (
            <Spinner />
          ) : players.length === 0 ? (
            <Empty title={t("home.noPlayers")} hint={t("home.noPlayersHint")} />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {players.map((p, i) => (
                  <li key={p.player_id}>
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(p.player_id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                    >
                      <RankMedallion pos={posBase + i + 1} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {p.gamertag}{" "}
                        {p.verified && (
                          <span title="verified" className="inline-block align-[-2px] text-accent">
                            <VerifiedIcon />
                          </span>
                        )}
                      </span>
                      <span className="block font-mono text-[10px] text-faint">
                        {POS_SHORT[p.position]} · {p.club_tag || p.club_name}
                      </span>
                    </span>
                    <span className="hidden w-28 sm:block">
                      <Bar value={p.rating} max={maxJogador} color="var(--info)" />
                    </span>
                    <span className="tnum w-16 text-right font-mono text-sm font-bold text-accent">
                      {fmt(metric === "goals" ? p.goals : metric === "assists" ? p.assists : metric === "goals_per_game" ? p.goals_per_game : p.rating, metric === "rating" ? 2 : 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!error && <Pager page={page} totalPages={totalPages} onPage={setPage} label={pagerLabel} />}
        </Card>
      </div>
    </>
  );
}
