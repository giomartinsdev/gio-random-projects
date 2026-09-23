// Clubes: busca (tolerante a acento, no servidor) + diretório em tabela densa.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import type { Club } from "../lib/types";
import { Crest, Empty, FormChips, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { WatchStar } from "../components/icons";
import { fmt } from "../lib/format";

export function ClubesPage({
  onOpenClub,
  isWatched,
  onToggleWatch,
  authed,
}: {
  onOpenClub: (id: string) => void;
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
  authed: boolean | null;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Club[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchClubs(q)
        .then((r) => !cancelled && setList(r.clubes ?? []))
        .catch(() => !cancelled && setList([]));
    }, q ? 180 : 0); // debounce: a busca é pública e barata, mas não a cada tecla
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const seguidos = authed ? (list ?? []).filter((c) => isWatched(c.club_id)) : [];

  return (
    <>
      <PageHead
        title="Clubes"
        sub="Procure qualquer clube do servidor. Os que o hub acompanha abrem por completo; os outros mostram o histórico geral."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="surface flex min-w-[260px] flex-1 items-center gap-2 px-3 py-2">
          <span className="text-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="nome do clube… (funciona sem acento)"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="buscar clube"
          />
        </label>
        {list && <span className="font-mono text-xs text-muted">{fmt(list.length)} resultados</span>}
      </div>

      {seguidos.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label">você segue</span>
          {seguidos.map((c) => (
            <button
              key={c.club_id}
              type="button"
              onClick={() => onOpenClub(c.club_id)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-bold text-accent"
            >
              <WatchStar size={11} filled /> {c.sigla || c.nome}
            </button>
          ))}
        </div>
      )}

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-faint">
                <Th>clube</Th>
                <Th right>div.</Th>
                <Th right>V</Th>
                <Th right>E</Th>
                <Th right>D</Th>
                <Th right>gols</Th>
                <Th right>pontos</Th>
                <Th right>nível</Th>
                <Th>forma</Th>
                <Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {list === null ? (
                <tr>
                  <td colSpan={10}>
                    <Spinner />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <Empty title="Nenhum clube encontrado" hint="Tente outro nome — a busca ignora acentos e maiúsculas." />
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr
                    key={c.club_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenClub(c.club_id)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Crest club={c} size={24} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{c.nome}</div>
                          <div className="font-mono text-[10px] text-faint">
                            {c.acompanhado ? "acompanhado" : "histórico geral"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.divisao_atual ? `D${c.divisao_atual}` : "—"}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.vitorias)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.empates)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.derrotas)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.gols)}:{fmt(c.gols_sofridos)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold text-accent">{fmt(c.pontos)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.nivel ? fmt(c.nivel) : "—"}</td>
                    <td className="px-3 py-2">
                      <FormChips forma={c.forma} max={5} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {authed ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatch(c.club_id);
                          }}
                          title={isWatched(c.club_id) ? "deixar de seguir" : "seguir clube"}
                          style={{ color: isWatched(c.club_id) ? "var(--gold)" : "var(--text-faint)" }}
                        >
                          <WatchStar size={16} filled={isWatched(c.club_id)} />
                        </button>
                      ) : (
                        <ChevronRight className="size-3.5 text-faint" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!authed && (
        <p className="mt-4 text-sm text-muted">
          Entre com o Google para seguir clubes e ter o hub sincronizando os seus automaticamente.
        </p>
      )}
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
