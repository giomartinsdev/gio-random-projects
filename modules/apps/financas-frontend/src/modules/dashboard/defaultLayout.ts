import type { DashboardLayout } from "@/lib/api/dashboard";

// FR-040: layout padrão exibido sem qualquer configuração da pessoa
// usuária -- saldo consolidado, gastos por categoria, evolução
// patrimonial. Puramente client-side (não precisa ser uma entidade
// persistida, ver data-model.md § DashboardLayout); "restaurar padrão"
// (FR-044) apenas troca `blocos` por isto e salva como qualquer edição.
export const LAYOUT_PADRAO: DashboardLayout = {
  blocos: [
    {
      id: "saldo-consolidado",
      tipoVisualizacao: "indicador",
      titulo: "Saldo consolidado",
      fonteDados: { tipo: "saldo-consolidado" },
      posicao: { x: 0, y: 0 },
      tamanho: { largura: 4, altura: 2 },
    },
    {
      id: "gastos-por-categoria",
      tipoVisualizacao: "pizza",
      titulo: "Gastos por categoria",
      fonteDados: { tipo: "gastos-por-categoria", periodoDias: 30 },
      posicao: { x: 4, y: 0 },
      tamanho: { largura: 4, altura: 4 },
    },
    {
      id: "evolucao-patrimonial",
      tipoVisualizacao: "linha",
      titulo: "Evolução patrimonial",
      fonteDados: { tipo: "evolucao-patrimonial", periodoDias: 90 },
      posicao: { x: 0, y: 2 },
      tamanho: { largura: 4, altura: 4 },
    },
  ],
};
