// Jogadores: o índice cross-club. A EA não tem busca por jogador — este índice
// é construído cruzando as partidas acompanhadas.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PlayerProfile } from "../lib/types";
import { Badge, Bar, Card, Empty, PosTag, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { fmt, POS_ORDER, POS_LABEL, ratingColor } from "../lib/format";
import { useI18n } from "../lib/i18n";

export function PlayersPage({ onOpenPlayer }: { onOpenPlayer: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [position, setPosicao] = useState("");
  const [ordem, setOrdem] = useState<"rating" | "goals" | "assists">("rating");
  const [list, setList] = useState<PlayerProfile[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .players(q, 120)
        .then((r) => {
          if (cancelled) return;
          setList(r.players ?? []);
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
    .filter((p) => !position || p.position === position)
    .sort((a, b) => (ordem === "goals" ? b.goals - a.goals : ordem === "assists" ? b.assists - a.assists : b.rating - a.rating));

  const max = Math.max(...filtered.map((p) => (ordem === "goals" ? p.goals : ordem === "assists" ? p.assists : p.rating)), 1);

  // "120 jogadores" lia como "só existem 120" enquanto o cabeçalho da home
  // dizia 1.267. A lista é uma página; o total é o índice. Quando a lista
  // está truncada, dizer as duas coisas.
  const contagem =
    total !== null && total > filtered.length
      ? `${fmt(filtered.length)} / ${fmt(total)} ${t("common.players")}`
      : `${fmt(filtered.length)} ${t("common.players")}`;

  return (
    <>
      <PageHead
        title={t("players.title")}
        sub={t("players.subtitle")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="surface flex min-w-[240px] flex-1 items-center gap-2 px-3 py-2">
          <span className="text-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("players.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label={t("action.search")}
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {[["", t("claim.all")], ...POS_ORDER.map((p) => [p, POS_LABEL[p]] as [string, string])].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPosicao(k)}
              aria-pressed={position === k}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
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
        <div className="flex gap-1.5">
          {([["rating", t("common.rating")], ["goals", t("common.goals")], ["assists", t("common.assists")]] as const).map(([k, label]) => (
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
            title={t("players.notFound")}
            hint={q ? t("players.tryAnotherGamertag") : t("players.appearHint")}
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
                      {p.verified && (
                        <span title={t("claim.verified")} className="inline-block align-[-2px] text-accent">
                          <VerifiedIcon />
                        </span>
                      )}
                    </span>
                    <span className="block font-mono text-[10px] text-faint">
                      {p.club_tag || p.club_name || t("common.noData")}
                    </span>
                  </span>
                  <PosTag position={p.position} />
                  <span className="hidden w-28 sm:block">
                    <Bar
                      value={ordem === "goals" ? p.goals : ordem === "assists" ? p.assists : p.rating}
                      max={max}
                      color="var(--info)"
                    />
                  </span>
                  <span className="tnum w-20 text-right font-mono text-sm font-bold" style={{ color: ordem === "rating" ? ratingColor(p.rating) : "var(--accent)" }}>
                    {ordem === "rating" ? fmt(p.rating, 2) : fmt(ordem === "goals" ? p.goals : p.assists)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        <Badge tone="info">{t("common.index")}</Badge> {t("players.subtitle")}
      </p>
    </>
  );
}
