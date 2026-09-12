import { ValorMonetario } from "@/components/ValorMonetario";
import type { Transacao } from "@/lib/api/transacional";
import type { Ativo } from "@/lib/api/asset-manager";

export function Tabela({ dados }: { dados: unknown }) {
  const lista = dados as (Transacao | Ativo)[];
  if (lista.length === 0) {
    return (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Nada para exibir ainda.
      </p>
    );
  }

  const ehTransacao = "tipo" in lista[0] && (lista[0] as Transacao).data !== undefined && "categoria" in lista[0];

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            {ehTransacao ? (
              <>
                <th className="pb-1.5 font-medium">Data</th>
                <th className="pb-1.5 font-medium">Categoria</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Valor</th>
              </>
            ) : (
              <>
                <th className="pb-1.5 font-medium">Ticker</th>
                <th className="pb-1.5 font-medium">Qtd.</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Rentab.</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lista.slice(0, 12).map((item) =>
            ehTransacao ? (
              <tr key={(item as Transacao).id}>
                <td className="py-1.5 font-mono">
                  {new Date((item as Transacao).data).toLocaleDateString("pt-BR")}
                </td>
                <td className="py-1.5">{(item as Transacao).categoria}</td>
                <td className="py-1.5 pr-2 text-right">
                  <ValorMonetario
                    valor={(item as Transacao).valor}
                    tamanho="sm"
                    tom={(item as Transacao).tipo === "entrada" ? "positivo" : "negativo"}
                    semSinal
                  />
                </td>
              </tr>
            ) : (
              <tr key={(item as Ativo).id}>
                <td className="py-1.5 font-mono">{(item as Ativo).ticker}</td>
                <td className="py-1.5 font-mono tabular">{(item as Ativo).quantidadeAtual}</td>
                <td className="py-1.5 pr-2 text-right">
                  <ValorMonetario
                    valor={(item as Ativo).rentabilidadeAbsoluta}
                    tamanho="sm"
                    tom="auto"
                    semSinal
                  />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
