import { useEffect, useState } from "react";
import type { Bloco } from "@/lib/api/dashboard";
import type { Conta } from "@/lib/api/contas";
import { saldoConta } from "@/lib/api/contas";
import { listarTransacoes } from "@/lib/api/transacional";
import { listarAtivos } from "@/lib/api/asset-manager";
import { contaExiste } from "@/lib/useContas";

export type ResultadoFonte =
  | { status: "carregando" }
  | { status: "indisponivel" }
  | { status: "erro" }
  | { status: "ok"; dados: unknown };

// O dashboard-api não valida se a fonte referenciada por um bloco ainda
// existe (edge case do spec: conta arquivada/excluída) -- essa
// responsabilidade fica no frontend. Cada bloco chama isso para
// descobrir o que renderizar; "indisponivel" nunca derruba o resto da
// tela (ver DashboardPage / BlocoContainer).
export function useFonteDados(bloco: Bloco, contas: Conta[] | null): ResultadoFonte {
  const [resultado, setResultado] = useState<ResultadoFonte>({ status: "carregando" });

  useEffect(() => {
    let ativo = true;
    const fonte = bloco.fonteDados;

    if (contas === null) return; // ainda carregando a lista de contas

    if ("contaId" in fonte && fonte.contaId && !contaExiste(contas, fonte.contaId)) {
      setResultado({ status: "indisponivel" });
      return;
    }

    setResultado({ status: "carregando" });

    async function carregar() {
      try {
        switch (fonte.tipo) {
          case "saldo-consolidado": {
            const ativas = (contas ?? []).filter((c) => c.status === "ativa");
            const saldos = await Promise.all(
              ativas.map((c) => saldoConta(c.id).catch(() => ({ saldo: 0 }))),
            );
            // contas-api's /saldo é hoje um placeholder documentado
            // (devolve {contaId, observacao}, sem o campo saldo, até
            // transacional-api/asset-manager-api estarem integrados) --
            // Number(undefined) é NaN, então blindamos com || 0 para
            // não propagar "R$ NaN" pra tela enquanto isso não existe.
            const total = saldos.reduce((acc, s) => acc + (Number(s.saldo) || 0), 0);
            return { total, contas: ativas.length };
          }
          case "gastos-por-categoria": {
            const de = new Date();
            de.setDate(de.getDate() - (fonte.periodoDias ?? 30));
            const transacoes = await listarTransacoes({
              conta: fonte.contaId,
              de: de.toISOString().slice(0, 10),
            });
            const porCategoria = new Map<string, number>();
            for (const t of transacoes) {
              if (t.tipo !== "saida") continue;
              porCategoria.set(t.categoria, (porCategoria.get(t.categoria) ?? 0) + t.valor);
            }
            return Array.from(porCategoria, ([categoria, valor]) => ({ categoria, valor }));
          }
          case "evolucao-patrimonial": {
            const de = new Date();
            de.setDate(de.getDate() - (fonte.periodoDias ?? 90));
            const transacoes = await listarTransacoes({ de: de.toISOString().slice(0, 10) });
            const porDia = new Map<string, number>();
            for (const t of transacoes) {
              const delta = t.tipo === "entrada" ? t.valor : -t.valor;
              porDia.set(t.data, (porDia.get(t.data) ?? 0) + delta);
            }
            const dias = Array.from(porDia.entries()).sort(([a], [b]) => a.localeCompare(b));
            let acumulado = 0;
            return dias.map(([data, delta]) => {
              acumulado += delta;
              return { data, valor: acumulado };
            });
          }
          case "extrato-conta": {
            return listarTransacoes({ conta: fonte.contaId });
          }
          case "carteira-ativos": {
            return listarAtivos(fonte.contaId);
          }
        }
      } catch {
        throw new Error("falha ao carregar fonte de dados");
      }
    }

    carregar()
      .then((dados) => ativo && setResultado({ status: "ok", dados }))
      .catch(() => ativo && setResultado({ status: "erro" }));

    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bloco.id, JSON.stringify(bloco.fonteDados), contas]);

  return resultado;
}
