import type { Bloco, DashboardLayout, FonteDados, TipoVisualizacao } from "@/lib/api/dashboard";

// Cada fonte produz uma forma própria de dados -- {total, contas}
// escalar pro saldo, [{categoria, valor}] pros gastos, [{data, valor}]
// pra evolução, listas de transações/ativos pro extrato e carteira --
// e nem toda visualização consome qualquer forma. Um "indicador" sobre
// uma lista lia dados.total de um array e rendia "R$ NaN" com a
// legenda sem número ("somado de contas ativas"). Estes dois mapas são
// a fonte de verdade do pareamento: o formulário de novo bloco só
// oferece combinações válidas e o layout salvo é normalizado no
// carregamento, consertando blocos antigos criados quando o par era
// livre (ver normalizarLayout).
export const VISUALIZACAO_PADRAO: Record<FonteDados["tipo"], TipoVisualizacao> = {
  "saldo-consolidado": "indicador",
  "gastos-por-categoria": "pizza",
  "evolucao-patrimonial": "linha",
  "extrato-conta": "tabela",
  "carteira-ativos": "tabela",
};

const VALIDAS: Record<FonteDados["tipo"], TipoVisualizacao[]> = {
  "saldo-consolidado": ["indicador"],
  "gastos-por-categoria": ["pizza", "barra"],
  "evolucao-patrimonial": ["linha"],
  "extrato-conta": ["tabela"],
  "carteira-ativos": ["tabela"],
};

export function visualizacoesValidas(fonte: FonteDados["tipo"]): TipoVisualizacao[] {
  return VALIDAS[fonte];
}

export const ROTULO_VISUALIZACAO: Record<TipoVisualizacao, string> = {
  indicador: "Indicador",
  linha: "Linha",
  barra: "Barra",
  pizza: "Pizza",
  tabela: "Tabela",
};

export function visualizacaoCompativel(fonte: FonteDados["tipo"], v: TipoVisualizacao): boolean {
  return VALIDAS[fonte].includes(v);
}

// Conserta blocos salvos cuja visualização não casa com a fonte,
// trocando-a pela natural da fonte e preservando todo o resto. Roda no
// carregamento do layout; a versão consertada vai pro dashboard-api na
// próxima edição que a pessoa fizer.
export function normalizarLayout(layout: DashboardLayout): DashboardLayout {
  return {
    blocos: layout.blocos.map((b: Bloco) =>
      visualizacaoCompativel(b.fonteDados.tipo, b.tipoVisualizacao)
        ? b
        : { ...b, tipoVisualizacao: VISUALIZACAO_PADRAO[b.fonteDados.tipo] },
    ),
  };
}