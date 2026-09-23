// Partida: a súmula dos dois lados, a linha do tempo e os números do jogo.

import { useEffect, useState } from "react";
import { ChevronLeft, Flag, Star } from "lucide-react";
import { api } from "../lib/api";
import type { Match, PlayerLine } from "../lib/types";
import { Badge, Card, Crest, Empty, PosTag, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { EVENT_LABEL, fmt, fmtDateTime, minutes, POS_SHORT, ratingColor, resultColor, TIPO_LABEL } from "../lib/format";

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
  const [m, setM] = useState<Match | null>(null);
  const [error, setErro] = useState("");

  useEffect(() => {
    setM(null);
    api.match(matchId).then(setM).catch((e) => setErro(String(e)));
  }, [matchId]);

  if (error) return <Empty title="Partida não encontrada" hint={error} />;
  if (!m) return <Spinner label="carregando partida…" />;

  // A súmula vem com os dois lados; separa por clube para desenhar cada bloco.
  const casa = (m.players ?? []).filter((p) => p.club_id === m.home_club_id);
  const fora = (m.players ?? []).filter((p) => p.club_id === m.away_club_id);
  const melhor = [...(m.players ?? [])].sort((a, b) => b.rating - a.rating)[0];

  return (
    <>
      <PageHead
        crumb={
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 hover:text-accent">
            <ChevronLeft className="size-3.5" />
            voltar
          </button>
        }
        title={`${m.home_club_name} ${m.home_goals}–${m.away_goals} ${m.away_club_name}`}
        sub={`${fmtDateTime(m.timestamp)} · ${TIPO_LABEL[m.kind]}${m.playoff_round ? ` · ${m.playoff_round}` : ""}${m.decided_by_forfeit ? " · decidida por desistência" : ""}`}
      />

      <Card title="Placar">
        <div className="grid grid-cols-3 items-center gap-4 px-4 py-6">
          <button type="button" onClick={() => onOpenClub(m.home_club_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ name: m.home_club_name, tag: m.home_club_tag, color_1: 0, color_2: 0, color_3: 0, crest_asset_id: "" }} size={46} />
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
                  <Flag className="size-3" strokeWidth={2.5} /> vitória por desistência
                </Badge>
              </div>
            )}
          </div>
          <button type="button" onClick={() => onOpenClub(m.away_club_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ name: m.away_club_name, tag: m.away_club_tag, color_1: 0, color_2: 0, color_3: 0, crest_asset_id: "" }} size={46} />
            <span className="text-sm font-semibold">{m.away_club_name}</span>
          </button>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Lineup title={m.home_club_name} lines={casa} onOpenPlayer={onOpenPlayer} />
        <Lineup title={m.away_club_name} lines={fora} onOpenPlayer={onOpenPlayer} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Events do jogo">
          {!m.events || m.events.length === 0 ? (
            <Empty
              title="Sem events registrados"
              hint="Os events vêm from_division campos sem tabela publicada, correlacionados com goals e shots. Quando não há correlação confiável, nada é mostrado."
            />
          ) : (
            <div className="px-4 py-3">
              <p className="mb-3 text-xs text-muted">
                Estes rótulos são <b>inferidos por correlação</b>, não vêm from_division uma tabela oficial.
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

        <Card title="Destaque">
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
                A rating agregada do time nesta partida foi{" "}
                <b>{fmt(m.avg_rating, 1)}</b>. Cada linha da súmula traz passes, desarmes e shots —
                clique num jogador to_division ver o perfil completo.
              </p>
            </div>
          ) : (
            <Empty title="sem dados from_division players" />
          )}
        </Card>
      </div>
    </>
  );
}

function Lineup({ title, lines, onOpenPlayer }: { title: string; lines: PlayerLine[]; onOpenPlayer: (id: string) => void }) {
  const order: Record<string, number> = { goalkeeper: 0, defensor: 1, meio: 2, atacante: 3 };
  const sorted = [...lines].sort((a, b) => (order[a.position] ?? 4) - (order[b.position] ?? 4));
  return (
    <Card title={title}>
      {sorted.length === 0 ? (
        <Empty title="sem súmula deste lado" />
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
                      <span title="melhor em campo" className="inline-block align-[-2px]">
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
