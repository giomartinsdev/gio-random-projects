// Partida: a súmula dos dois lados, a linha do tempo e os números do jogo.

import { useEffect, useState } from "react";
import { ChevronLeft, Flag, Star } from "lucide-react";
import { api } from "../lib/api";
import type { Match, PlayerLine } from "../lib/types";
import { Badge, Card, Crest, Empty, MatchKindBadge, PosTag, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { EVENT_LABEL, fmt, fmtDateTime, minutes, POS_SHORT, ratingColor, resultColor } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { DocumentMeta } from "../lib/document-meta";

export function MatchPage({
  matchId,
  onOpenClub,
  onOpenPlayer,
  onBack,
}: {
  matchId: string;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [m, setM] = useState<Match | null>(null);
  const [error, setErro] = useState("");

  useEffect(() => {
    setM(null);
    api.match(matchId).then(setM).catch((e) => setErro(String(e)));
  }, [matchId]);

  if (error) return <Empty title={t("match.notFound")} hint={error} />;
  if (!m) return <Spinner label={t("match.loading")} />;

  // A súmula vem com os dois lados; separa por clube para desenhar cada bloco.
  // O escudo dos dois lados é semeado pelo club_id -- a súmula não carrega o
  // clube inteiro, só o nome e a sigla, e o id é o que mantém o mesmo escudo
  // da lista e do perfil.
  const home = (m.players ?? []).filter((p) => p.club_id === m.home_club_id);
  const away = (m.players ?? []).filter((p) => p.club_id === m.away_club_id);
  const melhor = [...(m.players ?? [])].sort((a, b) => b.rating - a.rating)[0];

  return (
    <>
      <DocumentMeta
        title={`${m.home_club_name} ${m.home_goals}–${m.away_goals} ${m.away_club_name}`}
        description={`${fmtDateTime(m.timestamp)}${m.playoff_round ? ` · ${m.playoff_round}` : ""}`}
        path={`/match/${m.match_id}`}
      />
      <PageHead
        crumb={
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 hover:text-accent">
            <ChevronLeft className="size-3.5" />
            {t("action.back")}
          </button>
        }
        title={`${m.home_club_name} ${m.home_goals}–${m.away_goals} ${m.away_club_name}`}
        sub={`${fmtDateTime(m.timestamp)}${m.playoff_round ? ` · ${m.playoff_round}` : ""}${m.decided_by_forfeit ? t("match.decidedByForfeit") : ""}`}
        actions={<MatchKindBadge kind={m.kind} />}
      />

      <Card title={t("common.result")}>
        <div className="grid grid-cols-3 items-center gap-4 px-4 py-6">
          <button type="button" onClick={() => onOpenClub(m.home_club_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ name: m.home_club_name, tag: m.home_club_tag, color_1: 0, color_2: 0, color_3: 0, color_4: 0, crest_asset_id: "", club_id: m.home_club_id }} size={46} />
            <span className="text-sm font-semibold">{m.home_club_name}</span>
          </button>
          <div className="text-center">
            <div className="font-display tnum text-5xl font-bold" style={{ color: resultColor(m.home_result) }}>
              {m.home_goals}
              <span className="mx-2 opacity-40">–</span>
              {m.away_goals}
            </div>
            {m.decided_by_forfeit && (
              <div className="mt-2">
                <Badge tone="accent">
                  <Flag className="size-3" strokeWidth={2.5} /> {t("common.result")}
                </Badge>
              </div>
            )}
          </div>
          <button type="button" onClick={() => onOpenClub(m.away_club_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ name: m.away_club_name, tag: m.away_club_tag, color_1: 0, color_2: 0, color_3: 0, color_4: 0, crest_asset_id: "", club_id: m.away_club_id }} size={46} />
            <span className="text-sm font-semibold">{m.away_club_name}</span>
          </button>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Lineup title={m.home_club_name} lines={home} onOpenPlayer={onOpenPlayer} />
        <Lineup title={m.away_club_name} lines={away} onOpenPlayer={onOpenPlayer} />
      </div>

      <MatchHighlights m={m} onOpenClub={onOpenClub} onOpenPlayer={onOpenPlayer} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title={t("match.events")}>
          {!m.events || m.events.length === 0 ? (
            <Empty
              title={t("match.noEvents")}
              hint={t("match.eventsHint")}
            />
          ) : (
            <div className="px-4 py-3">
              <p className="mb-3 text-xs text-muted">
                {t("common.inferred")}
              </p>
              <div className="flex flex-col gap-3">
                {m.events.map((l) => (
                  <div key={l.player_id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{l.gamertag}</span>
                    {l.eventos.map((e) => (
                      <Badge key={e.label}>
                        {EVENT_LABEL[e.label] ?? e.label}: {e.quantidade}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title={t("common.highlight")}>
          {melhor ? (
            <div className="px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="font-display text-4xl font-bold" style={{ color: ratingColor(melhor.rating) }}>
                  {fmt(melhor.rating, 2)}
                </span>
                <div>
                  <div className="font-semibold">{melhor.gamertag}</div>
                  <div className="font-mono text-[10px] text-faint">
                    {POS_SHORT[melhor.position]} · {melhor.goals}G {melhor.assists}A · {minutes(melhor.seconds_played)} min
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                {t("match.avgRating", { v: fmt(m.avg_rating, 1) })}
              </p>
            </div>
          ) : (
            <Empty title={t("common.noData")} />
          )}
        </Card>
      </div>
    </>
  );
}

function Lineup({ title, lines, onOpenPlayer }: { title: string; lines: PlayerLine[]; onOpenPlayer: (id: string) => void }) {  const { t } = useI18n();
  const order: Record<string, number> = { goalkeeper: 0, defender: 1, midfielder: 2, forward: 3 };
  const sorted = [...lines].sort((a, b) => (order[a.position] ?? 4) - (order[b.position] ?? 4));
  return (
    <Card title={title}>
      {sorted.length === 0 ? (
        <Empty title={t("match.noSheet")} />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sorted.map((p) => (
            <li key={p.player_id}>
              <button
                type="button"
                onClick={() => onOpenPlayer(p.player_id)}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
              >
                <PosTag position={p.position} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {p.gamertag}{" "}
                    {p.man_of_the_match && (
                      <span title={t("player.motm")} className="inline-block align-[-2px]">
                        <Star
                          className="size-3.5"
                          fill="var(--gold)"
                          strokeWidth={0}
                          style={{ color: "var(--gold)" }}
                        />
                      </span>
                    )}
                  </span>
                  <span className="block font-mono text-[10px] text-faint">
                    {p.goals}G {p.assists}A · {fmt(p.passes_made)}/{fmt(p.passes_attempted)} passes ·{" "}
                    {minutes(p.seconds_played)} min
                  </span>
                </span>
                <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(p.rating) }}>
                  {fmt(p.rating, 2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Destaques automáticos: o melhor em campo, hat-tricks e goleadas.
 *
 * Derivados da própria súmula -- não há curadoria. É o que dá à partida uma
 * leitura de relance: quem foi o destaque, se alguém fez 3+, se foi goleada. */
function MatchHighlights({
  m,
  onOpenClub,
  onOpenPlayer,
}: {
  m: Match;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const { t } = useI18n();
  const players = m.players ?? [];
  if (players.length === 0) return null;

  const melhor = [...players].sort((a, b) => b.rating - a.rating)[0];
  const hatTricks = players.filter((p) => p.goals >= 3);
  const margin = Math.abs(m.home_goals - m.away_goals);
  const goleada = margin >= 4;

  return (
    <div className="mt-4">
      <Card title={t("match.highlights")}>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {melhor && (
            <button
              type="button"
              onClick={() => onOpenPlayer(melhor.player_id)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <Star className="size-3.5" style={{ color: "var(--warning)" }} />
              <span className="flex flex-col">
                <span className="label">{t("match.bestOnPitch")}</span>
                <span className="text-xs font-semibold">
                  {melhor.gamertag} · {fmt(melhor.rating, 1)}
                </span>
              </span>
            </button>
          )}
          {hatTricks.map((p) => (
            <button
              key={p.player_id}
              type="button"
              onClick={() => onOpenPlayer(p.player_id)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <span className="text-base leading-none">⚽</span>
              <span className="flex flex-col">
                <span className="label">{t("match.hatTrick")}</span>
                <span className="text-xs font-semibold">
                  {p.gamertag} · {p.goals}
                </span>
              </span>
            </button>
          ))}
          {goleada && (
            <button
              type="button"
              onClick={() => onOpenClub(m.home_goals >= m.away_goals ? m.home_club_id : m.away_club_id)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <span className="flex flex-col">
                <span className="label">{t("match.rout")}</span>
                <span className="text-xs font-semibold">
                  {m.home_goals}–{m.away_goals}
                </span>
              </span>
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
