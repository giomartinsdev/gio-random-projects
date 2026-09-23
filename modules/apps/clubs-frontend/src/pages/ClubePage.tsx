// Clube: as quatro abas (Resumo, Elenco, Partidas, Números), em linguagem de
// usuário. O clube não acompanhado mostra só os totais gerais, com uma
// explicação explícita — nunca uma tela vazia sem motivo.

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Crosshair, Goal, Skull, Star, Trophy } from "lucide-react";
import { api } from "../lib/api";
import type {
  Club,
  DivisionChange,
  Evolution,
  Match,
  Records,
  SquadMember,
} from "../lib/types";
import { Badge, Card, Crest, Empty, FormChips, Kit, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { WatchStar, type LucideIcon } from "../components/icons";
import { BarChart, DivisionSteps, DonutChart, LineChart, Scatter, Spark } from "../components/charts";
import {
  fmt,
  fmtDate,
  fmtDateTime,
  fmtRefresh,
  POS_LABEL,
  POS_ORDER,
  ratingColor,
  resultColor,
  TIPO_LABEL,
} from "../lib/format";

type Tab = "resumo" | "elenco" | "partidas" | "numeros";

export function ClubePage({
  clubId,
  onOpenMatch,
  onOpenPlayer,
  onOpenClub,
  isWatched,
  onToggleWatch,
  authed,
}: {
  clubId: string;
  onOpenMatch: (id: string) => void;
  onOpenPlayer: (id: string) => void;
  onOpenClub: (id: string) => void;
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
  authed: boolean | null;
}) {
  const [club, setClub] = useState<Club | null>(null);
  const [erro, setErro] = useState("");
  const [tab, setTab] = useState<Tab>("resumo");

  useEffect(() => {
    setClub(null);
    setErro("");
    setTab("resumo");
    api
      .club(clubId)
      .then(setClub)
      .catch((e) => setErro(String(e)));
  }, [clubId]);

  if (erro) return <Empty title="Clube não encontrado" hint={erro} />;
  if (!club) return <Spinner label="carregando clube…" />;

  const notFollowed = !club.acompanhado;

  return (
    <>
      <PageHead
        crumb={
          <button type="button" onClick={() => onOpenClub("")} className="inline-flex items-center gap-1 hover:text-accent">
            <ChevronLeft className="size-3.5" />
            clubes
          </button>
        }
        title={club.nome}
        sub={
          notFollowed
            ? "Este clube ainda não é acompanhado pelo hub — por isso não há elenco nem partidas."
            : [club.estadio, club.divisao_atual ? `Divisão ${club.divisao_atual}` : "", club.nivel ? `nível ${fmt(club.nivel)}` : ""]
                .filter(Boolean)
                .join(" · ")
        }
        actions={
          <>
            <FormChips forma={club.forma} max={10} />
            {authed && (
              <button
                type="button"
                onClick={() => onToggleWatch(club.club_id)}
                className="rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors"
                style={
                  isWatched(club.club_id)
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--border-strong)", color: "var(--text-muted)" }
                }
              >
                {isWatched(club.club_id) ? (
                  <>
                    <WatchStar size={13} filled /> seguindo
                  </>
                ) : (
                  <>
                    <WatchStar size={13} filled={false} /> seguir
                  </>
                )}
              </button>
            )}
          </>
        }
      />

      {notFollowed && <NotIndexed club={club} />}

      {!notFollowed && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(
              [
                ["resumo", "Resumo"],
                ["elenco", "Elenco"],
                ["partidas", "Partidas"],
                ["numeros", "Números"],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className="rounded-md px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors"
                style={
                  tab === id
                    ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }
                    : { background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "resumo" && <ResumoTab club={club} onOpenMatch={onOpenMatch} />}
          {tab === "elenco" && <ElencoTab clubId={club.club_id} onOpenPlayer={onOpenPlayer} />}
          {tab === "partidas" && <PartidasTab clubId={club.club_id} onOpenMatch={onOpenMatch} />}
          {tab === "numeros" && <NumerosTab clubId={club.club_id} club={club} onOpenPlayer={onOpenPlayer} onOpenMatch={onOpenMatch} />}
        </>
      )}
    </>
  );
}

/** O clube conhecido mas não acompanhado: só os totais gerais, com uma
 * explicação de por que o resto não está ali. */
function NotIndexed({ club }: { club: Club }) {
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="jogos" value={fmt(club.jogos)} />
        <Stat label="campanha" value={`${club.vitorias}V ${club.empates}E ${club.derrotas}D`} />
        <Stat label="gols pró · contra" value={`${fmt(club.gols)}:${fmt(club.gols_sofridos)}`} accent />
        <Stat label="pontos" value={fmt(club.pontos)} />
      </div>
      <Card title="Por que não há elenco nem partidas">
        <p className="px-4 py-3 text-sm text-muted">
          O hub traz os dados de um clube quando ele entra na lista de acompanhados. Para este, só existem
          os totais gerais. {""}
          Entre com o Google e siga este clube para o hub passá-lo a acompanhar — o elenco e as partidas
          aparecem na próxima atualização.
        </p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------- resumo

function ResumoTab({ club, onOpenMatch }: { club: Club; onOpenMatch: (id: string) => void }) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  useEffect(() => {
    api.matches(club.club_id, "", 10).then((r) => setMatches(r.partidas ?? [])).catch(() => setMatches([]));
  }, [club.club_id]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="nível"
          value={fmt(club.nivel)}
          sub={club.atualizado_em ? `atualizado ${fmtRefresh(club.atualizado_em)}` : undefined}
          accent
        />
        <Stat label="divisão" value={`D${club.divisao_atual}`} sub={`melhor: D${club.melhor_divisao}`} />
        <Stat label="campanha" value={`${club.vitorias}V ${club.empates}E ${club.derrotas}D`} sub={`${fmt(club.gols)} gols · ${fmt(club.gols_sofridos)} sofridos`} />
        <Stat label="sequência" value={`${club.sequencia?.vitorias ?? 0}V`} sub={`${club.sequencia?.invicta ?? 0} sem perder`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Últimas partidas">
          {matches === null ? (
            <Spinner />
          ) : matches.length === 0 ? (
            <Empty title="Nenhuma partida registrada ainda" hint="O hub traz as partidas na próxima atualização." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {matches.slice(0, 6).map((m) => (
                <li key={m.match_id}>
                  <button
                    type="button"
                    onClick={() => onOpenMatch(m.match_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <ResultBadge resultado={m.nosso_resultado} dnf={m.houve_desistencia} />
                    <span
                      className="tnum font-display w-14 text-lg font-bold"
                      style={{ color: resultColor(m.nosso_resultado) }}
                    >
                      {m.nossos_gols}–{m.gols_deles}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.adversario_nome}</span>
                      <span className="block font-mono text-[10px] text-faint">
                        {TIPO_LABEL[m.tipo]} · {fmtDateTime(m.timestamp)}
                      </span>
                    </span>
                    {m.nota_agregada > 0 && (
                      <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(m.nota_agregada) }}>
                        {fmt(m.nota_agregada, 1)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Uniformes">
            <div className="flex items-center justify-around px-4 py-4">
              <Kit colors={[club.cor_1, club.cor_2, club.cor_3, club.cor_4]} label="casa" />
              <div className="text-center">
                <Crest club={club} size={44} />
                <div className="label mt-1">escudo</div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs">
              <Row k="Estádio" v={club.estadio || "—"} />
              <Row k="Divisão" v={`D${club.divisao_atual}`} />
              <Row k="Melhor divisão" v={`D${club.melhor_divisao}`} />
              <Row k="Promoções" v={fmt(club.promocoes)} />
              <Row k="Rebaixamentos" v={fmt(club.rebaixamentos)} />
            </dl>
          </Card>

          {club.adversarios && club.adversarios.length > 0 && (
            <Card title="Adversários recentes">
              <ul className="divide-y divide-[var(--border)]">
                {club.adversarios.slice(0, 5).map((a) => (
                  <li key={a.club_id} className="flex items-center gap-2 px-4 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                    <span className="tnum font-mono text-faint">
                      {a.vitorias}V {a.empates}E {a.derrotas}D
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="tnum text-right font-mono">{v}</dd>
    </>
  );
}

// ------------------------------------------------------------------- elenco

function ElencoTab({ clubId, onOpenPlayer }: { clubId: string; onOpenPlayer: (id: string) => void }) {
  const [squad, setSquad] = useState<SquadMember[] | null>(null);
  useEffect(() => {
    api.squad(clubId).then((r) => setSquad(r.jogadores ?? [])).catch(() => setSquad([]));
  }, [clubId]);

  if (squad === null) return <Spinner />;
  if (squad.length === 0) {
    return <Empty title="Elenco ainda não disponível" hint="O elenco é montado a partir das partidas acompanhadas." />;
  }

  const porPosicao = POS_ORDER.map((p) => ({
    label: POS_LABEL[p],
    value: squad.filter((s) => s.posicao === p).length,
  }));

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="jogadores" value={fmt(squad.length)} sub={porPosicao.map((p) => `${p.value} ${p.label.slice(0, 3).toLowerCase()}`).join(" · ")} />
        <Stat label="nota média" value={fmt(squad.reduce((a, s) => a + s.nota, 0) / squad.length, 2)} />
        <Stat label="gols" value={fmt(squad.reduce((a, s) => a + s.gols, 0))} sub={`${fmt(squad.reduce((a, s) => a + s.assistencias, 0))} assistências`} />
        <Stat label="melhor em campo" value={fmt(squad.reduce((a, s) => a + s.melhor_em_campo, 0))} sub="vezes" accent />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Jogadores">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-faint">
                  <Th>jogador</Th>
                  <Th>pos.</Th>
                  <Th right>J</Th>
                  <Th right>gols</Th>
                  <Th right>assist.</Th>
                  <Th right>nota</Th>
                  <Th right>forma</Th>
                </tr>
              </thead>
              <tbody>
                {squad.map((s) => (
                  <tr
                    key={s.player_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenPlayer(s.player_id)}
                  >
                    <td className="px-3 py-2 font-semibold">{s.gamertag}</td>
                    <td className="px-3 py-2">
                      <PosTag posicao={s.posicao} />
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.jogos)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.gols)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.assistencias)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold" style={{ color: ratingColor(s.nota) }}>
                      {fmt(s.nota, 2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Spark values={s.forma} width={70} height={20} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Composição">
          <div className="px-4 py-4">
            <DonutChart data={porPosicao} centerLabel="jogadores" size={150} />
          </div>
        </Card>
      </div>
    </>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

// ----------------------------------------------------------------- partidas

function PartidasTab({ clubId, onOpenMatch }: { clubId: string; onOpenMatch: (id: string) => void }) {
  const [tipo, setTipo] = useState("");
  const [list, setList] = useState<Match[] | null>(null);

  useEffect(() => {
    setList(null);
    api.matches(clubId, tipo, 40).then((r) => setList(r.partidas ?? [])).catch(() => setList([]));
  }, [clubId, tipo]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          ["", "todas"],
          ["liga", "liga"],
          ["amistoso", "amistosos"],
          ["playoff", "playoffs"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTipo(k)}
            aria-pressed={tipo === k}
            className="rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors"
            style={
              tipo === k
                ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
            }
          >
            {label}
          </button>
        ))}
        {list && <span className="ml-auto font-mono text-xs text-muted">{fmt(list.length)} partidas</span>}
      </div>

      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Nenhuma partida nesse filtro" hint="Troque o filtro ou aguarde a próxima atualização." />
      ) : (
        <div className="surface overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {list.map((m) => (
              <li key={m.match_id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m.match_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="hidden w-24 shrink-0 font-mono text-[10px] text-faint sm:block">
                    {fmtDate(m.timestamp)}
                  </span>
                  <Badge>{TIPO_LABEL[m.tipo]}</Badge>
                  <ResultBadge resultado={m.nosso_resultado} dnf={m.houve_desistencia} />
                  <span className="tnum font-display w-16 font-bold" style={{ color: resultColor(m.nosso_resultado) }}>
                    {m.nossos_gols}–{m.gols_deles}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.adversario_nome}</span>
                  {m.nota_agregada > 0 && (
                    <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(m.nota_agregada) }}>
                      {fmt(m.nota_agregada, 1)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ números

function NumerosTab({
  clubId,
  club,
  onOpenPlayer,
  onOpenMatch,
}: {
  clubId: string;
  club: Club;
  onOpenPlayer: (id: string) => void;
  onOpenMatch: (id: string) => void;
}) {
  const [evo, setEvo] = useState<Evolution | null>(null);
  const [changes, setChanges] = useState<DivisionChange[]>([]);
  const [rec, setRec] = useState<Records | null>(null);
  const [squad, setSquad] = useState<SquadMember[]>([]);

  useEffect(() => {
    api.evolution(clubId).then(setEvo).catch(() => setEvo({ serie: [], total: 0, atual: null, historico_curto: true }));
    api.divisionChanges(clubId).then((r) => setChanges(r.mudancas ?? [])).catch(() => setChanges([]));
    api.records(clubId).then(setRec).catch(() => setRec(null));
    api.squad(clubId).then((r) => setSquad(r.jogadores ?? [])).catch(() => setSquad([]));
  }, [clubId]);

  const serie = evo?.serie ?? [];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="nível hoje"
          value={fmt(club.nivel)}
          sub={serie.length >= 2 ? `${serie.length} leituras acumuladas` : "o histórico cresce a cada atualização"}
          accent
        />
        <Stat label="mudanças de divisão" value={fmt(changes.length)} sub={changes.length ? "detectadas pelo hub" : "ainda nenhuma"} />
        <Stat label="maior sequência de vitórias" value={`${rec?.maior_sequencia_vitorias ?? 0}V`} sub="no histórico acumulado" />
        <Stat label="jogos sem sofrer gol" value={fmt(rec?.jogos_sem_sofrer_gol ?? 0)} sub={`de ${fmt(rec?.total_partidas ?? 0)} partidas`} />
      </div>

      <div className="mb-4">
        <Card title="Evolução do nível">
          {evo === null ? (
            <Spinner />
          ) : evo.historico_curto ? (
            <Empty
              title="O histórico está começando"
              hint="A EA só informa o nível de agora. O hub guarda uma leitura a cada atualização, então este gráfico ganha forma com o tempo."
            />
          ) : (
            <div className="px-2 py-3">
              <LineChart
                values={serie.map((s) => s.nivel)}
                labels={serie.map((s) => fmtDate(s.lido_em))}
                refLine={{ y: 1600, label: "faixa D2" }}
              />
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Mudanças de divisão">
          {changes.length === 0 ? (
            <Empty title="Nenhuma mudança registrada" hint="Subidas e quedas aparecem aqui conforme o hub acumula leituras." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {changes.map((c, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className="shrink-0"
                    style={{ color: c.tipo === "promocao" ? "var(--success)" : "var(--danger)" }}
                  >
                    {c.tipo === "promocao" ? (
                      <ArrowUp className="size-4" strokeWidth={2.5} />
                    ) : (
                      <ArrowDown className="size-4" strokeWidth={2.5} />
                    )}
                  </span>
                  <span className="flex-1">
                    {c.tipo === "promocao" ? "Subiu" : "Caiu"} da Divisão {c.de} para a {c.para}
                  </span>
                  <span className="font-mono text-[10px] text-faint">{fmtDateTime(c.detectado_em)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Divisão por leitura">
          <DivisionSteps snapshots={serie.slice(-12)} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Livro de recordes">
          {!rec ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rec.maior_goleada && (
                <RecLine medal={Trophy} title="Maior goleada" value={`${rec.maior_goleada.nossos_gols}–${rec.maior_goleada.gols_deles}`} detail={`vs ${rec.maior_goleada.adversario_nome}`} onClick={() => onOpenMatch(rec.maior_goleada!.match_id)} />
              )}
              {rec.pior_derrota && (
                <RecLine medal={Skull} title="Pior derrota" value={`${rec.pior_derrota.nossos_gols}–${rec.pior_derrota.gols_deles}`} detail={`vs ${rec.pior_derrota.adversario_nome}`} onClick={() => onOpenMatch(rec.pior_derrota!.match_id)} />
              )}
              {rec.jogo_com_mais_gols && (
                <RecLine medal={Crosshair} title="Jogo com mais gols" value={String(rec.jogo_com_mais_gols.total_gols)} detail={`vs ${rec.jogo_com_mais_gols.adversario_nome}`} onClick={() => onOpenMatch(rec.jogo_com_mais_gols!.match_id)} />
              )}
              {rec.melhor_nota && (
                <RecLine medal={Star} title="Melhor nota individual" value={fmt(rec.melhor_nota.nota, 2)} detail={`${rec.melhor_nota.gamertag} vs ${rec.melhor_nota.adversario_nome}`} onClick={() => onOpenPlayer(rec.melhor_nota!.player_id)} />
              )}
              {rec.mais_gols_em_um_jogo && (
                <RecLine medal={Goal} title="Mais gols em um jogo" value={String(rec.mais_gols_em_um_jogo.gols)} detail={`${rec.mais_gols_em_um_jogo.gamertag} vs ${rec.mais_gols_em_um_jogo.adversario_nome}`} onClick={() => onOpenPlayer(rec.mais_gols_em_um_jogo!.player_id)} />
              )}
            </ul>
          )}
        </Card>

        <Card title="Artilharia (temporada acompanhada)">
          {squad.length === 0 ? (
            <Empty title="sem dados ainda" />
          ) : (
            <div className="px-2 py-3">
              <BarChart
                height={210}
                items={squad.slice(0, 8).map((s) => ({ label: s.gamertag.slice(0, 8), value: s.gols }))}
              />
            </div>
          )}
        </Card>
      </div>

      {squad.length > 3 && (
        <div className="mt-4">
          <Card title="Gols × nota média">
            <div className="px-2 py-3">
              <Scatter
                height={260}
                xLabel="gols"
                yLabel="nota"
                points={squad.map((s) => ({ x: s.gols, y: s.nota, label: s.gamertag, highlight: s.nota >= 7.8 }))}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function RecLine({
  medal,
  title,
  value,
  detail,
  onClick,
}: {
  medal: LucideIcon;
  title: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  const Icon = medal;
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)]">
          <Icon className="size-3.5" style={{ color: "var(--accent)" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate font-mono text-[10px] text-faint">{detail}</span>
        </span>
        <span className="tnum font-display text-lg font-bold">{value}</span>
      </button>
    </li>
  );
}
