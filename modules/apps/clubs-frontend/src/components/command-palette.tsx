// Busca rápida (⌘K / Ctrl+K): o atalho que evita navegar para procurar.
//
// Por que existe: o hub tem diretório de clubes e de jogadores, mas chegar neles
// custa cliques (nav → campo → digitar → item). Para quem já sabe o que quer --
// "o clube do meu amigo", "meu gamertag" -- isso é lento. Um atalho de teclado
// resolve em dois passos e é o que faz um app parecer produto.
//
// O componente consulta as DUAS buscas (clubes e jogadores) em paralelo e mostra
// os resultados numa paleta. Não há índice local: a base do hub muda a cada
// ciclo, então uma busca sempre atual vale mais que um cache que envelhece.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Shield, Star, X } from "lucide-react";
import { api } from "../lib/api";
import type { Club, PlayerProfile } from "../lib/types";
import { useI18n } from "../lib/i18n";
import { Crest } from "./ui";

export function CommandPalette({
  open,
  onClose,
  onOpenClub,
  onOpenPlayer,
}: {
  open: boolean;
  onClose: () => void;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset ao abrir: uma busca velha reaparecendo faria a pessoa achar que o
  // atalho trouxe o resultado errado.
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      // Foco no campo -- o atalho é de teclado, então o cursor tem que estar
      // pronto para digitar sem um clique.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Busca com debounce curto. Termo < 2 letras não busca: é o mesmo corte da
  // busca pública, e evita consultar a base a cada tecla.
  useEffect(() => {
    const termo = q.trim();
    if (!open || termo.length < 2) {
      setClubs([]);
      setPlayers([]);
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      Promise.all([api.searchClubs(termo), api.players(termo, 6)])
        .then(([rc, rp]) => {
          if (cancelled) return;
          setClubs((rc.clubs ?? []).slice(0, 6));
          setPlayers((rp.players ?? []).slice(0, 6));
          setSel(0);
        })
        .catch(() => {
          if (!cancelled) {
            setClubs([]);
            setPlayers([]);
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [q, open]);

  // A lista plana é o que o teclado percorre; o tipo diz para onde navegar.
  const itens = useMemo(
    () => [
      ...clubs.map((c) => ({ tipo: "club" as const, id: c.club_id, nome: c.name, club: c })),
      ...players.map((p) => ({ tipo: "player" as const, id: p.player_id, nome: p.gamertag, player: p })),
    ],
    [clubs, players],
  );

  const escolher = useCallback(
    (i: number) => {
      const item = itens[i];
      if (!item) return;
      if (item.tipo === "club") onOpenClub(item.id);
      else onOpenPlayer(item.id);
      onClose();
    },
    [itens, onOpenClub, onOpenPlayer, onClose],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, itens.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        escolher(sel);
      }
    },
    [itens.length, escolher, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
      style={{ background: "rgba(0,0,0,.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("search.title")}
    >
      <div
        className="surface w-full max-w-xl overflow-hidden rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="size-4 shrink-0 text-faint" strokeWidth={2.5} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("search.placeholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label={t("search.placeholder")}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("action.clear")}
            className="shrink-0 rounded p-1 text-faint hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {q.trim().length < 2 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">{t("search.hint")}</p>
        ) : itens.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">{t("search.empty")}</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {itens.map((item, i) => (
              <li key={`${item.tipo}-${item.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => escolher(i)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left"
                  style={{ background: i === sel ? "var(--accent-soft)" : undefined }}
                >
                  {item.tipo === "club" && item.club ? (
                    <Crest club={item.club} size={22} />
                  ) : (
                    <span className="grid size-[22px] shrink-0 place-items-center rounded bg-[var(--surface-3)] text-faint">
                      <Star className="size-3" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.nome}</span>
                  <span className="label" style={{ color: "var(--text-faint)" }}>
                    {item.tipo === "club" ? t("nav.clubs") : t("nav.players")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 font-mono text-[10px] text-faint">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-line px-1">↑↓</kbd> {t("search.nav")}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-line px-1">↵</kbd> {t("search.open")}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-line px-1">esc</kbd> {t("search.close")}
          </span>
          <Shield className="ml-auto size-3" />
        </div>
      </div>
    </div>
  );
}
