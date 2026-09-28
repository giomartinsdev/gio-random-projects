// Resgatar pro: a jornada de 3 passos que liga a conta ao jogador.
//
// Passo 1 — achar o clube (busca tolerante a acento, como o resto do hub).
// Passo 2 — escolher o jogador no elenco, com os já resgatados bloqueados.
// Passo 3 — confirmar: o resgate segue o clube e dispara a descoberta.
//
// A tela é usável sem login até o passo 2; o passo de resgate em si exige
// identidade, porque é a conta que fica ligada ao pro. O fetch do elenco é
// sob demanda (não espera o ciclo do worker), então o passo 2 não trava.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Lightbulb,
  Network,
  Radio,
  Target,
  TriangleAlert,
  Users,
} from "lucide-react";
import { api } from "../lib/api";
import type { Club, FetchRun, SquadMember } from "../lib/types";
import { Badge, Card, Crest, Empty, PosTag, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { GoogleSignInButton } from "../components/google-signin";
import { VerifiedIcon } from "../components/icons";
import { fmt, POS_ORDER, POS_SHORT, ratingColor } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useSourceStatus } from "../lib/hooks";

/** Os ícones do passo a passo, por chave. Ficam aqui e não em texto com emoji
 * para renderizarem igual em qualquer sistema e herdarem a cor do tema. */
const FLOW: Record<string, typeof Users> = {
  players: Users,
  resgate: Target,
  rivais: Network,
  fonte: Radio,
  dica: Lightbulb,
  alerta: TriangleAlert,
  check: Check,
};

type Step = 1 | 2 | 3;

export function ClaimPage({
  authed,
  claimed,
  onClaim,
  onSignedIn,
  onOpenClub,
  onOpenPlayer,
}: {
  authed: boolean | null;
  claimed: { player_id: string } | null;
  onClaim: (clubId: string, playerId: string) => Promise<void>;
  onSignedIn: () => void;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const [club, setClub] = useState<Club | null>(null);

  // Passo 1 -> 2: escolher o clube.
  const pickClub = useCallback((c: Club) => {
    setClub(c);
    setStep(2);
  }, []);

  // O resgate concluído leva ao passo 3.
  const finish = useCallback(() => setStep(3), []);

  return (
    <>
      <PageHead
        title={t("claim.title")}
        sub={t("claim.subtitle")}
      />
      <StepBar step={step} club={club} />
      {step === 1 && <StepBuscar onPick={pickClub} />}
      {step === 2 && club && (
        <StepEscolher
          club={club}
          authed={authed}
          claimed={claimed}
          onBack={() => setStep(1)}
          onClaim={onClaim}
          onDone={finish}
          onOpenPlayer={onOpenPlayer}
          onSignedIn={onSignedIn}
        />
      )}
      {step === 3 && club && (
        <StepPronto club={club} onOpenClub={onOpenClub} onRestart={() => { setClub(null); setStep(1); }} onSignedIn={onSignedIn} authed={authed} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- step bar

function StepBar({ step, club }: { step: Step; club: Club | null }) {
  const { t } = useI18n();
  const steps: Array<[Step, string, string]> = [
    [1, t("claim.step1"), club?.name || t("claim.step1Hint")],
    [2, t("claim.step2"), t("claim.step2Hint")],
    [3, t("claim.step3"), t("claim.step3Hint")],
  ];
  return (
    <div className="surface mb-4 flex flex-wrap items-center gap-2 px-4 py-3">
      {steps.map(([id, title, hint], i) => {
        const state = step > id ? "done" : step === id ? "active" : "todo";
        return (
          <div key={id} className="flex items-center gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-bold"
                style={
                  state === "done"
                    ? { background: "var(--success)", color: "var(--accent-ink)" }
                    : state === "active"
                      ? { background: "var(--accent)", color: "var(--accent-ink)" }
                      : { background: "var(--surface-2)", color: "var(--text-faint)", border: "1px solid var(--border-strong)" }
                }
              >
                {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : id}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold" style={{ color: state === "todo" ? "var(--text-muted)" : "var(--text)" }}>
                  {title}
                </span>
                <span className="font-mono text-[10px] text-faint">{hint}</span>
              </span>
            </div>
            {i < steps.length - 1 && <span className="mx-1 h-0.5 w-5" style={{ background: "var(--border-strong)" }} />}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ passo 1

function StepBuscar({ onPick }: { onPick: (c: Club) => void }) {
  const { t } = useI18n();
  const source = useSourceStatus();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Club[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  // A busca local só conhece o que o hub já viu. Quando ela devolve pouco,
  // caímos na busca AO VIVO na fonte -- senão quem chega com um clube novo
  // procura por ele, não acha e conclui que a tela está quebrada.
  const [buscandoAoVivo, setBuscandoAoVivo] = useState(false);
  const [aoVivo, setAoVivo] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const termo = q.trim();
    setAoVivo(false);
    if (pollRef.current) window.clearTimeout(pollRef.current);
    if (termo.length < 2) {
      setList(null);
      return;
    }

    let cancelled = false;
    setBuscando(true);

    const run = async () => {
      // 1. Local primeiro: é instantâneo e já traz os dados completos.
      let locais: Club[] = [];
      try {
        const r = await api.searchClubs(termo);
        locais = r.clubs ?? [];
      } catch {
        locais = [];
      }
      if (cancelled) return;
      setList(locais);
      setBuscando(false);

      // 2. Pouco resultado? Vai na fonte. O corte em 2 é de propósito: um
      // termo que já acha vários clubes não precisa pagar a latência do CDN.
      if (locais.length >= 2) return;
      setBuscandoAoVivo(true);
      try {
        await api.requestSearchLive(termo);
      } catch {
        setBuscandoAoVivo(false);
        return;
      }

      // 3. Polla o estado até o worker trazer. O termo é a chave da fila, então
      // reusa a linha se já foi buscado antes.
      const tick = async () => {
        if (cancelled) return;
        try {
          const st = await api.searchLiveStatus(termo);
          if (cancelled) return;
          if (st.finished_at) {
            setBuscandoAoVivo(false);
            setAoVivo(true);
            if (st.found > 0) {
              const r = await api.searchClubs(termo);
              if (!cancelled) setList(r.clubs ?? []);
            }
            return;
          }
          pollRef.current = window.setTimeout(tick, 1800);
        } catch {
          if (!cancelled) pollRef.current = window.setTimeout(tick, 3500);
        }
      };
      tick();
    };

    const t = window.setTimeout(run, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [q]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <Card title={t("claim.findClub")}>
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-xs text-muted">{t("claim.findClubHint")}</p>
            <label className="flex items-center gap-2.5 rounded-md px-3.5 py-3" style={{ background: "var(--surface-2)", border: "1.5px solid var(--accent)" }}>
              <span className="text-accent">⌕</span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("claim.clubNamePlaceholder")}
                className="w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-faint"
                aria-label={t("action.search")}
              />
              {q && (
                <button type="button" onClick={() => setQ("")} className="font-mono text-[11px] text-faint hover:text-ink">
                  {t("action.clear")}
                </button>
              )}
            </label>
            <div className="font-mono text-[11px] text-muted">
              {q.trim().length < 2
                ? t("claim.searchingHint")
                : buscando
                  ? t("claim.searching")
                  : buscandoAoVivo
                    ? t("claim.searchingSource")
                    : `${fmt(list?.length ?? 0)} ${t("common.clubs")} — “${q.trim()}”`}
            </div>
            {buscandoAoVivo && (
              <div className="flex items-start gap-2 rounded-md px-3 py-2.5" style={{ background: "var(--info-soft)" }}>
                <Radio className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--info)" }} />
                <p className="text-[11px] text-muted">
                  {t("claim.liveSearchHint")}
                </p>
              </div>
            )}
            {source?.available === false && (
              <div className="flex items-start gap-2 rounded-md px-3 py-2.5" style={{ background: "var(--warning-soft, var(--info-soft))" }}>
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--warning)" }} />
                <p className="text-[11px] text-muted">
                  <span className="font-semibold">{t("source.down")}</span> {t("source.searchPending")}
                </p>
              </div>
            )}
          </div>
        </Card>

        {list !== null && (
          <Card title={`${fmt(list.length)} ${list.length === 1 ? t("common.club") : t("common.clubs")}`} actions={<span className="inline-flex items-center gap-1 text-[10px] text-faint">{t("claim.tapToSeePlayers")} <ArrowRight className="size-3" /></span>}>
            {list.length === 0 ? (
              <Empty
                title={buscandoAoVivo ? t("claim.searchingSource") : t("claim.notFound")}
                hint={
                  buscandoAoVivo
                    ? t("claim.sourceWillRespond")
                    : aoVivo
                      ? t("claim.notFoundLive")
                      : t("claim.tryNameOrTag")
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {list.map((c) => (
                  <li key={c.club_id}>
                    <button
                      type="button"
                      onClick={() => onPick(c)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
                    >
                      <Crest club={c} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{c.name}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
                          <span className="rounded-full px-1.5 py-px font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                            D{c.division}
                          </span>
                          <span className="text-faint">·</span>
                          <span>{t("common.level")} {fmt(c.skill_rating)}</span>
                          <span className="text-faint">·</span>
                          <span>{fmt(c.played)} {t("common.played")}</span>
                        </span>
                      </span>
                      {c.tracked ? <Badge tone="accent">{t("common.tracked")}</Badge> : <Badge>{t("common.notTracked")}</Badge>}
                      <ArrowRight className="size-3.5 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Card title={t("claim.howItWorks")}>
          <ol className="flex flex-col gap-3.5 px-4 py-4">
            {[
              ["players", t("claim.how1"), t("claim.how1Hint")],
              ["resgate", t("claim.how2"), t("claim.how2Hint")],
              ["rivais", t("claim.how3"), t("claim.how3Hint")],
            ].map(([icon, title, h]) => {
              const Icon = FLOW[icon];
              return (
                <li key={title} className="flex items-start gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: "var(--accent-soft)" }}>
                    <Icon className="size-3.5" style={{ color: "var(--accent)" }} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[12.5px] font-bold">{title}</span>
                    <span className="text-[11px] text-muted">{h}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="surface flex items-start gap-2.5 px-3.5 py-3.5">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--gold)" }} />
          <div>
            <div className="text-xs font-bold">{t("claim.tipTitle")}</div>
            <p className="mt-0.5 text-[11px] text-muted">
              {t("claim.tipHint")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ passo 2

function StepEscolher({
  club,
  authed,
  claimed,
  onBack,
  onClaim,
  onDone,
  onOpenPlayer,
  onSignedIn,
}: {
  club: Club;
  authed: boolean | null;
  claimed: { player_id: string } | null;
  onBack: () => void;
  onClaim: (clubId: string, playerId: string) => Promise<void>;
  onDone: () => void;
  onOpenPlayer: (id: string) => void;
  onSignedIn: () => void;
}) {
  const { t } = useI18n();
  const source = useSourceStatus();
  const [squad, setSquad] = useState<SquadMember[] | null>(null);
  const [fetchState, setFetchState] = useState<FetchRun | null>(null);
  const [q, setQ] = useState("");
  const [position, setPosicao] = useState("");
  const [sel, setSel] = useState<SquadMember | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [error, setErro] = useState("");
  const pollRef = useRef<number | null>(null);

  const carregarElenco = useCallback(() => {
    api
      .squad(club.club_id)
      .then((r) => setSquad(r.players ?? []))
      .catch(() => setSquad([]));
  }, [club.club_id]);

  // Pede o fetch e polla até o elenco chegar. O ciclo do worker roda a cada
  // 15 min, então sem o pedido sob demanda a tela ficaria vazia por muito
  // tempo. O poll para sozinho quando o run conclui.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const run = await api.fetchRun(club.club_id);
        if (cancelled) return;
        setFetchState(run);
        if (run.finished_at) {
          carregarElenco();
          return; // pronto: para de pollar
        }
        pollRef.current = window.setTimeout(tick, 2000);
      } catch {
        if (!cancelled) pollRef.current = window.setTimeout(tick, 4000);
      }
    };

    // O clube pode já ter elenco (hub acompanhado): mostra direto e ainda
    // pede o fetch, que é idempotente e traz o que faltar.
    carregarElenco();
    api.requestFetch(club.club_id).catch(() => {});
    tick();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [club.club_id, carregarElenco]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (squad ?? [])
      .filter((p) => !position || p.position === position)
      .filter((p) => !needle || p.gamertag.toLowerCase().includes(needle))
      .sort((a, b) => b.rating - a.rating);
  }, [squad, q, position]);

  const buscando = !fetchState?.finished_at && (squad?.length ?? 0) === 0;

  async function resgatar() {
    if (!sel) return;
    setSalvando(true);
    setErro("");
    try {
      await onClaim(club.club_id, sel.player_id);
      onDone();
    } catch {
      setErro(t("claim.failed"));
      setSalvando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted" style={{ borderColor: "var(--border-strong)" }}>
            <ChevronLeft className="size-3.5" />
            {t("claim.changeClub")}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold">{club.name}</div>
            <div className="font-mono text-[10.5px] text-faint">D{club.division} · {t("common.level")} {fmt(club.skill_rating)}</div>
          </div>
        </div>

        {/* Campanha do clube, visível ENQUANTO o elenco é buscado na fonte. Um
            spinner sozinho não confirma "é este o clube certo?" -- e a busca do
            elenco pode demorar. Estes números o hub já tem, então mostrá-los
            aqui faz a espera ter conteúdo em vez de ser um vazio girando. */}
        <div className="flex flex-wrap gap-2">
          <Stat label={t("claim.campaignHint")} value={`${fmt(club.played)} ${t("common.played")}`} sub={`${fmt(club.wins)}V ${fmt(club.draws)}E ${fmt(club.losses)}D`} accent />
          <Stat label={t("common.goals")} value={`${fmt(club.goals)}–${fmt(club.goals_conceded)}`} sub={t("club.goalsForAgainst")} />
          <Stat label={t("common.division")} value={`D${club.division}`} sub={`${t("club.bestDivision")} D${club.best_division}`} />
          <Stat label={t("common.level")} value={fmt(club.skill_rating)} sub={t("club.levelToday")} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="surface flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2">
            <span className="text-faint">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("claim.filterPlayer")}
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
              aria-label={t("claim.filterPlayer")}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[["", t("claim.all")], ...POS_ORDER.map((p) => [p, POS_SHORT[p]] as [string, string])].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPosicao(k)}
                aria-pressed={position === k}
                className="rounded-full border px-3 py-1.5 font-mono text-[11px] font-bold transition-colors"
                style={
                  position === k
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Card
          title={t("claim.squad")}
          actions={
            <span className="font-mono text-[10px] text-faint">
              {buscando ? t("claim.fetchingSquadShort") : `${fmt(filtered.length)} ${t("common.players")}`}
            </span>
          }
        >
          {squad === null ? (
            <Spinner label={t("claim.loadingSquad")} />
          ) : buscando ? (
            <div className="flex flex-col gap-3 px-4 py-4">
              <Spinner label={t("claim.fetchingSquad")} />
              {source?.available === false && (
                <p className="text-center text-[11px] text-muted">
                  <span className="font-semibold">{t("source.down")}</span> {t("source.syncPending")}
                </p>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <Empty title={t("claim.noPlayers")} hint={t("claim.noPlayersHint")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-faint">
                    <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase">{t("common.player")}</th>
                    <th className="px-3 py-2.5 text-left font-mono text-[10px] uppercase">{t("common.pos")}</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] uppercase">{t("common.played")}</th>
                    <th className="px-3 py-2.5 text-right font-mono text-[10px] uppercase">{t("common.rating")}</th>
                    <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase">{t("claim.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const meu = claimed?.player_id === p.player_id;
                    const bloqueado = !!p.resgatado && !meu;
                    const selecionado = sel?.player_id === p.player_id;
                    return (
                      <tr
                        key={p.player_id}
                        onClick={() => !bloqueado && setSel(p)}
                        className="border-t border-line transition-colors"
                        style={{ background: selecionado ? "var(--accent-soft)" : undefined, cursor: bloqueado ? "not-allowed" : "pointer", opacity: bloqueado ? 0.55 : 1 }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md font-display text-[11px] font-bold" style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}>
                              {p.gamertag.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="flex flex-col">
                              <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPlayer(p.player_id); }} className="text-left font-semibold hover:text-accent">
                                {p.gamertag}{" "}
                                {meu && (
                                  <span title={t("claim.yourPro")} className="inline-block align-[-2px]" style={{ color: "var(--success)" }}>
                                    <VerifiedIcon />
                                  </span>
                                )}
                              </button>
                              <span className="font-mono text-[10px] text-faint">{fmt(p.goals)} {t("common.goals")} · {fmt(p.assists)} {t("common.assists")}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><PosTag position={p.position} /></td>
                        <td className="tnum px-3 py-2.5 text-right font-mono text-muted">{fmt(p.played)}</td>
                        <td className="tnum px-3 py-2.5 text-right font-display font-bold" style={{ color: ratingColor(p.rating) }}>{fmt(p.rating, 2)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {meu ? (
                            <span className="rounded-md px-3 py-1.5 font-display text-[10.5px] font-bold uppercase tracking-wide" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
                              {t("claim.yourPro")}
                            </span>
                          ) : bloqueado ? (
                            <span className="rounded-md px-3 py-1.5 font-display text-[10.5px] font-bold uppercase tracking-wide text-faint" style={{ background: "var(--surface-3)" }}>
                              {t("claim.claimed")}
                            </span>
                          ) : (
                            <span
                              className="rounded-md px-3 py-1.5 font-display text-[10.5px] font-bold uppercase tracking-wide"
                              style={selecionado ? { background: "var(--accent)", color: "var(--accent-ink)" } : { border: "1px solid var(--accent)", color: "var(--accent)" }}
                            >
                              {selecionado ? t("common.selected") : t("player.thisIsMe")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {sel ? (
          <div className="surface flex flex-col gap-3.5 px-4 py-4" style={{ borderColor: "var(--accent)", borderWidth: 1.5 }}>
            <Badge tone="accent">{t("common.selected")}</Badge>
            <div className="flex items-center gap-3">
              <span className="grid size-13 shrink-0 place-items-center rounded-md font-display text-lg font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)", width: 52, height: 52 }}>
                {sel.gamertag.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-display text-base font-bold">{sel.gamertag}</span>
                <span className="font-mono text-[10.5px] text-faint">{sel.position} · {club.name}</span>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t("common.rating")} value={fmt(sel.rating, 2)} />
              <Stat label={t("common.goals")} value={fmt(sel.goals)} />
              <Stat label={t("common.played")} value={fmt(sel.played)} />
            </div>
            <div className="flex items-start gap-2.5 rounded-md px-3 py-3" style={{ background: "var(--warning-soft)" }}>
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" style={{ color: "var(--warning)" }} />
              <p className="text-[10.5px] text-muted">
                {t("claim.confirmHint")}
              </p>
            </div>
            {authed === true ? (
              <button
                type="button"
                disabled={salvando}
                onClick={resgatar}
                className="flex items-center justify-center gap-2 rounded-md px-4 py-3 font-display text-xs font-bold uppercase tracking-wide disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                {salvando ? (
                  t("claim.claiming")
                ) : (
                  <>
                    <Check className="size-3.5" strokeWidth={3} /> {t("claim.claimThis")}
                  </>
                )}
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <GoogleSignInButton onSuccess={() => { onSignedIn(); }} />
                <p className="text-center text-[10.5px] text-muted">{t("claim.signInToClaim")}</p>
              </div>
            )}
            {error && <p className="text-center text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
          </div>
        ) : (
          <div className="surface flex flex-col gap-2 px-4 py-4">
            <div className="text-sm font-bold">{t("claim.choosePlayer")}</div>
            <p className="text-xs text-muted">
              {t("claim.choosePlayerHint")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ passo 3

function StepPronto({
  club,
  authed,
  onOpenClub,
  onRestart,
  onSignedIn,
}: {
  club: Club;
  authed: boolean | null;
  onOpenClub: (id: string) => void;
  onRestart: () => void;
  onSignedIn: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <div className="surface flex items-center gap-4 px-5 py-5" style={{ borderColor: "var(--success)", borderWidth: 1.5 }}>
          <span className="grid size-14 shrink-0 place-items-center rounded-md" style={{ background: "var(--success-soft)", color: "var(--success)" }}>
            <Check className="size-6" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-xl font-bold">{t("claim.claimed")}</span>
              <Badge tone="accent">
                <VerifiedIcon /> {t("claim.verified")}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {t("claim.doneSubtitle")}
            </p>
          </div>
        </div>

        <Card title={t("claim.discovering")} actions={<span className="text-[10px] text-faint">{t("claim.discoveringHint")}</span>}>
          <div className="flex flex-col gap-3 px-4 py-4">
            {[
              ["check", t("claim.youPlayHere"), club.name, "done"],
              ["users", t("claim.rivals"), t("claim.rivalsHint"), "active"],
              ["network", t("claim.rivalsOfRivals"), t("claim.rivalsOfRivalsHint"), "todo"],
            ].map(([icon, title, h, state]) => {
              const Icon = FLOW[icon as string];
              return (
                <div key={title as string} className="flex items-center gap-3 rounded-md px-3.5 py-3" style={{ background: "var(--surface-2)" }}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ background: state === "done" ? "var(--success-soft)" : state === "active" ? "var(--accent-soft)" : "var(--surface-3)", color: state === "done" ? "var(--success)" : state === "active" ? "var(--accent)" : "var(--text-faint)" }}>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[12.5px] font-bold" style={{ color: state === "todo" ? "var(--text-muted)" : "var(--text)" }}>{title}</span>
                    <span className="truncate text-[10.5px] text-faint">{h}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenClub(club.club_id)} className="rounded-md px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {t("claim.viewMyClub")}
          </button>
          <button type="button" onClick={onRestart} className="rounded-md border px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-muted" style={{ borderColor: "var(--border-strong)" }}>
            {t("claim.claimAnother")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card title={t("claim.nextStep")}>
          <ul className="flex flex-col gap-3 px-4 py-4">
            {[
              [t("claim.discordAlerts"), t("notif.subtitle2")],
              [t("claim.favoriteClubs"), t("claim.favoritesHint")],
              [t("nav.myArea"), t("claim.myAreaHint")],
            ].map(([title, h]) => (
              <li key={title} className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-md" style={{ background: "var(--surface-2)" }}>
                  <ArrowRight className="size-3.5 text-faint" />
                </span>
                <span className="flex flex-col">
                  <span className="text-[12.5px] font-bold">{title}</span>
                  <span className="text-[10.5px] text-faint">{h}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        {authed !== true && (
          <div className="surface flex flex-col items-center gap-2 px-4 py-4">
            <p className="text-center text-xs text-muted">{t("claim.saveHint")}</p>
            <GoogleSignInButton onSuccess={onSignedIn} />
          </div>
        )}
      </div>
    </div>
  );
}
