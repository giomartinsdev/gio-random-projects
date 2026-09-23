// Jogadores: o índice cross-club. A EA não tem busca por jogador — este índice
// é construído cruzando as partidas acompanhadas.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PlayerProfile } from "../lib/types";
import { Badge, Bar, Card, Empty, PosTag, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { fmt, POS_ORDER, POS_LABEL, ratingColor } from "../lib/format";

export function JogadoresPage({ onOpenPlayer }: { onOpenPlayer: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [posicao, setPosicao] = useState("");
  const [ordem, setOrdem] = useState<"nota" | "gols" | "assistencias">("nota");
  const [list, setList] = useState<PlayerProfile[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .players(q, 120)
        .then((r) => {
          if (cancelled) return;
          setList(r.jogadores ?? []);
          setTotal(r.total ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setList([]);
          setTotal(null);
        });
    }, q ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const filtered = (list ?? [])
    .filter((p) => !posicao || p.posicao === posicao)
    .sort((a, b) => (ordem === "gols" ? b.gols - a.gols : ordem === "assistencias" ? b.assistencias - a.assistencias : b.nota - a.nota));

  const max = Math.max(...filtered.map((p) => (ordem === "gols" ? p.gols : ordem === "assistencias" ? p.assistencias : p.nota)), 1);

  // "120 jogadores" lia como "só existem 120" enquanto o cabeçalho da home
  // dizia 1.267. A lista é uma página; o total é o índice. Quando a lista
  // está truncada, dizer as duas coisas.
  const contagem =
    total !== null && total > filtered.length
      ? `${fmt(filtered.length)} de ${fmt(total)} jogadores`
      : `${fmt(filtered.length)} jogadores`;

  return (
    <>
      <PageHead
        title="Jogadores"
        sub="Todos os jogadores que o hub encontrou jogando pelos clubes acompanhados. A EA não oferece busca por jogador — este índice é construído a partir das partidas."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="surface flex min-w-[240px] flex-1 items-center gap-2 px-3 py-2">
          <span className="text-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="gamertag…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label="buscar jogador"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[["", "todos"], ...POS_ORDER.map((p) => [p, POS_LABEL[p]] as [string, string])].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPosicao(k)}
              aria-pressed={posicao === k}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              style={
                posicao === k
                  ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {([["nota", "nota"], ["gols", "gols"], ["assistencias", "assist."]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setOrdem(k)}
              aria-pressed={ordem === k}
              className="rounded-md border px-3 py-1 text-xs transition-colors"
              style={
                ordem === k
                  ? { borderColor: "var(--border-strong)", background: "var(--surface-3)", color: "var(--text)" }
                  : { borderColor: "var(--border)", color: "var(--text-muted)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card title={contagem}>
        {list === null ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <Empty
            title="Nenhum jogador encontrado"
            hint={q ? "Tente outra gamertag." : "Os jogadores aparecem conforme o hub acompanha partidas."}
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {filtered.map((p, i) => (
              <li key={p.player_id}>
                <button
                  type="button"
                  onClick={() => onOpenPlayer(p.player_id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="tnum w-7 shrink-0 text-center font-mono text-xs text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {p.gamertag}{" "}
                      {p.verificado && (
                        <span title="verificado" className="inline-block align-[-2px] text-accent">
                          <VerifiedIcon />
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-[10px] text-faint">
                      {p.club_sigla || p.clube_nome || "sem clube"}
                    </span>
                  </span>
                  <PosTag posicao={p.posicao} />
                  <span className="hidden w-28 sm:block">
                    <Bar
                      value={ordem === "gols" ? p.gols : ordem === "assistencias" ? p.assistencias : p.nota}
                      max={max}
                      color="var(--info)"
                    />
                  </span>
                  <span className="tnum w-20 text-right font-mono text-sm font-bold" style={{ color: ordem === "nota" ? ratingColor(p.nota) : "var(--accent)" }}>
                    {ordem === "nota" ? fmt(p.nota, 2) : fmt(ordem === "gols" ? p.gols : p.assistencias)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        <Badge tone="info">índice</Badge> Um jogador existe aqui através das suas partidas — não há cadastro de
        jogador na EA, então cada linha é derivada do cruzamento de partidas dos clubes.
      </p>
    </>
  );
}
