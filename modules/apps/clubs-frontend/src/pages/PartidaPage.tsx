// Partida: a súmula dos dois lados, a linha do tempo e os números do jogo.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Match, PlayerLine } from "../lib/types";
import { Badge, Card, Crest, Empty, PosTag, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { EVENT_LABEL, fmt, fmtDateTime, minutes, POS_SHORT, ratingColor, resultColor, TIPO_LABEL } from "../lib/format";

export function PartidaPage({
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
  const [erro, setErro] = useState("");

  useEffect(() => {
    setM(null);
    api.match(matchId).then(setM).catch((e) => setErro(String(e)));
  }, [matchId]);

  if (erro) return <Empty title="Partida não encontrada" hint={erro} />;
  if (!m) return <Spinner label="carregando partida…" />;

  // A súmula vem com os dois lados; separa por clube para desenhar cada bloco.
  const casa = (m.jogadores ?? []).filter((p) => p.club_id === m.clube_casa_id);
  const fora = (m.jogadores ?? []).filter((p) => p.club_id === m.clube_fora_id);
  const melhor = [...(m.jogadores ?? [])].sort((a, b) => b.nota - a.nota)[0];

  return (
    <>
      <PageHead
        crumb={
          <button type="button" onClick={onBack} className="hover:text-accent">
            ← voltar
          </button>
        }
        title={`${m.clube_casa_nome} ${m.gols_casa}–${m.gols_fora} ${m.clube_fora_nome}`}
        sub={`${fmtDateTime(m.timestamp)} · ${TIPO_LABEL[m.tipo]}${m.rodada_playoff ? ` · ${m.rodada_playoff}` : ""}${m.houve_desistencia ? " · decidida por desistência" : ""}`}
      />

      <Card title="Placar">
        <div className="grid grid-cols-3 items-center gap-4 px-4 py-6">
          <button type="button" onClick={() => onOpenClub(m.clube_casa_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ nome: m.clube_casa_nome, sigla: m.clube_casa_sigla, cor_1: 0, cor_2: 0, cor_3: 0, escudo_asset_id: "" }} size={46} />
            <span className="text-sm font-semibold">{m.clube_casa_nome}</span>
          </button>
          <div className="text-center">
            <div className="font-display tnum text-5xl font-bold" style={{ color: resultColor(m.resultado_casa) }}>
              {m.gols_casa}
              <span className="mx-2 opacity-40">–</span>
              {m.gols_fora}
            </div>
            {m.houve_desistencia && (
              <div className="mt-2">
                <Badge tone="accent">⚑ vitória por desistência</Badge>
              </div>
            )}
          </div>
          <button type="button" onClick={() => onOpenClub(m.clube_fora_id)} className="flex flex-col items-center gap-2 hover:text-accent">
            <Crest club={{ nome: m.clube_fora_nome, sigla: m.clube_fora_sigla, cor_1: 0, cor_2: 0, cor_3: 0, escudo_asset_id: "" }} size={46} />
            <span className="text-sm font-semibold">{m.clube_fora_nome}</span>
          </button>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Lineup title={m.clube_casa_nome} lines={casa} onOpenPlayer={onOpenPlayer} />
        <Lineup title={m.clube_fora_nome} lines={fora} onOpenPlayer={onOpenPlayer} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Lances do jogo">
          {!m.lances || m.lances.length === 0 ? (
            <Empty
              title="Sem lances registrados"
              hint="Os lances vêm de campos sem tabela publicada, correlacionados com gols e chutes. Quando não há correlação confiável, nada é mostrado."
            />
          ) : (
            <div className="px-4 py-3">
              <p className="mb-3 text-xs text-muted">
                Estes rótulos são <b>inferidos por correlação</b>, não vêm de uma tabela oficial.
              </p>
              <div className="flex flex-col gap-3">
                {m.lances.map((l) => (
                  <div key={l.player_id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{l.gamertag}</span>
                    {l.eventos.map((e) => (
                      <Badge key={e.rotulo}>
                        {EVENT_LABEL[e.rotulo] ?? e.rotulo}: {e.quantidade}
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
                <span className="font-display text-4xl font-bold" style={{ color: ratingColor(melhor.nota) }}>
                  {fmt(melhor.nota, 2)}
                </span>
                <div>
                  <div className="font-semibold">{melhor.gamertag}</div>
                  <div className="font-mono text-[10px] text-faint">
                    {POS_SHORT[melhor.posicao]} · {melhor.gols}G {melhor.assistencias}A · {minutes(melhor.segundos_jogados)} min
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                A nota agregada do time nesta partida foi{" "}
                <b>{fmt(m.nota_agregada, 1)}</b>. Cada linha da súmula traz passes, desarmes e chutes —
                clique num jogador para ver o perfil completo.
              </p>
            </div>
          ) : (
            <Empty title="sem dados de jogadores" />
          )}
        </Card>
      </div>
    </>
  );
}

function Lineup({ title, lines, onOpenPlayer }: { title: string; lines: PlayerLine[]; onOpenPlayer: (id: string) => void }) {
  const order: Record<string, number> = { goleiro: 0, defensor: 1, meio: 2, atacante: 3 };
  const sorted = [...lines].sort((a, b) => (order[a.posicao] ?? 4) - (order[b.posicao] ?? 4));
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
                <PosTag posicao={p.posicao} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {p.gamertag} {p.melhor_em_campo && <span title="melhor em campo">⭐</span>}
                  </span>
                  <span className="block font-mono text-[10px] text-faint">
                    {p.gols}G {p.assistencias}A · {fmt(p.passes_certos)}/{fmt(p.passes_tentados)} passes ·{" "}
                    {minutes(p.segundos_jogados)} min
                  </span>
                </span>
                <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(p.nota) }}>
                  {fmt(p.nota, 2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
