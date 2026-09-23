// Botão de "sincronizar" — força a atualização de um alvo na fonte, sem
// esperar o ciclo do worker (até 15 min).
//
// Aparece no clube e no jogador, e o comportamento é o mesmo nos dois: pede,
// polla o estado, e mostra o que veio. A diferença entre os alvos está só na
// frase do resultado, porque "syncar jogador" atualiza as partidas dos clubes
// dele (a fonte não tem endpoint de jogador).

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { FetchRun } from "../lib/types";
import { fmt } from "../lib/format";

type Target = "club" | "player";

export function SyncButton({
  target,
  targetId,
  onDone,
}: {
  target: Target;
  targetId: string;
  onDone?: () => void;
}) {
  const [run, setRun] = useState<FetchRun | null>(null);
  const [error, setErro] = useState("");
  const poll = useRef<number | null>(null);

  // O estado pode já existir (um pedido anterior, ou o ciclo já trouxe os
  // dados): mostrar antes de qualquer clique evita dizer "sincronizar" quando
  // o dado é recente.
  const carregar = useCallback(() => {
    const pedido = target === "player" ? api.fetchRunJogador(targetId) : api.fetchRun(targetId);
    pedido.then(setRun).catch(() => setRun(null));
  }, [target, targetId]);

  useEffect(() => {
    carregar();
    return () => {
      if (poll.current) window.clearTimeout(poll.current);
    };
  }, [carregar]);

  const sincronizar = useCallback(async () => {
    setErro("");
    setRun((r) => (r ? { ...r, running: true, error: "" } : r));
    try {
      if (target === "player") await api.requestFetchJogador(targetId);
      else await api.requestFetch(targetId);
    } catch {
      setErro("Não conseguimos pedir a atualização.");
      setRun((r) => (r ? { ...r, running: false } : r));
      return;
    }

    // Polla até o worker fechar o pedido. O worker roda a cada ~20s, então o
    // intervalo curto dá a sensação de "pedi e está vindo".
    const tick = async () => {
      try {
        const st = target === "player" ? await api.fetchRunJogador(targetId) : await api.fetchRun(targetId);
        setRun(st);
        if (!st.finished_at) {
          poll.current = window.setTimeout(tick, 2000);
        } else {
          // O dado chegou: quem embute pode querer recarregar o que mostra (o
          // perfil do jogador é derivado das partidas, então muda com o sync).
          onDone?.();
        }
      } catch {
        poll.current = window.setTimeout(tick, 4000);
      }
    };
    tick();
  }, [target, targetId, onDone]);

  const running = run?.running ?? false;
  const pronto = !!run?.finished_at;

  // A frase do resultado diz o que ACONTECEU, não "sucesso": syncar um clube
  // traz jogadores e partidas; syncar um jogador atualiza os clubes dele.
  let resumo = "";
  if (running) resumo = "buscando na fonte…";
  else if (run?.error) resumo = "a fonte recusou esta atualização";
  else if (pronto) {
    resumo =
      target === "player"
        ? `${fmt(run!.clubs)} clubs · ${fmt(run!.matches)} matches`
        : `${fmt(run!.players)} players · ${fmt(run!.matches)} matches`;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={sincronizar}
        disabled={running}
        title="Buscar os dados mais recentes direto da fonte, sem esperar a atualização from_division rotina"
        className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-50"
        style={{
          borderColor: pronto ? "var(--success)" : "var(--border-strong)",
          background: pronto ? "var(--success-soft)" : undefined,
          color: pronto ? "var(--success)" : "var(--text-muted)",
        }}
      >
        <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
        {running ? "sincronizando" : "sincronizar"}
      </button>
      {(resumo || error) && (
        <span
          className="font-mono text-[10px]"
          style={{ color: run?.error || error ? "var(--danger)" : "var(--text-faint)" }}
        >
          {error || resumo}
        </span>
      )}
    </div>
  );
}
