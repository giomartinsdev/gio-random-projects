import type { ButtonHTMLAttributes } from "react";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Minus, Plus, X, AlertTriangle } from "lucide-react";
import type { Bloco } from "@/lib/api/dashboard";
import type { Conta } from "@/lib/api/contas";
import { useFonteDados } from "./useFonteDados";
import { Indicador } from "./blocos/Indicador";
import { Pizza } from "./blocos/Pizza";
import { Linha } from "./blocos/Linha";
import { Barra } from "./blocos/Barra";
import { Tabela } from "./blocos/Tabela";

const RENDERERS = {
  indicador: Indicador,
  pizza: Pizza,
  linha: Linha,
  barra: Barra,
  tabela: Tabela,
};

interface BlocoContainerProps {
  bloco: Bloco;
  contas: Conta[] | null;
  onMover: (dx: number, dy: number) => void;
  onRedimensionar: (dl: number, da: number) => void;
  onRemover: () => void;
}

// A grade não usa drag-and-drop de ponteiro -- em vez disso, cada bloco
// tem controles explícitos de mover/redimensionar (setas + +/-). Decisão
// deliberada: cobre "adicionar/remover/redimensionar/reposicionar
// livremente" (FR-041) com bem menos superfície de bug que um motor de
// drag physics, dentro do orçamento desta entrega -- ver README.
export function BlocoContainer({
  bloco,
  contas,
  onMover,
  onRedimensionar,
  onRemover,
}: BlocoContainerProps) {
  const resultado = useFonteDados(bloco, contas);
  const Renderer = RENDERERS[bloco.tipoVisualizacao];

  return (
    <div
      className="group relative flex flex-col rounded-lg border border-border bg-card shadow-crisp"
      style={{
        gridColumn: `span ${bloco.tamanho.largura}`,
        gridRow: `span ${bloco.tamanho.altura}`,
        minHeight: `${bloco.tamanho.altura * 44}px`,
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="truncate text-sm font-medium text-muted-foreground">{bloco.titulo}</h3>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ControleIcone aria-label="Mover para cima" onClick={() => onMover(0, -1)}>
            <ArrowUp size={12} />
          </ControleIcone>
          <ControleIcone aria-label="Mover para baixo" onClick={() => onMover(0, 1)}>
            <ArrowDown size={12} />
          </ControleIcone>
          <ControleIcone aria-label="Mover para esquerda" onClick={() => onMover(-1, 0)}>
            <ArrowLeft size={12} />
          </ControleIcone>
          <ControleIcone aria-label="Mover para direita" onClick={() => onMover(1, 0)}>
            <ArrowRight size={12} />
          </ControleIcone>
          <span className="mx-1 h-3 w-px bg-border" />
          <ControleIcone aria-label="Diminuir largura" onClick={() => onRedimensionar(-1, 0)}>
            <Minus size={12} />
          </ControleIcone>
          <ControleIcone aria-label="Aumentar largura" onClick={() => onRedimensionar(1, 0)}>
            <Plus size={12} />
          </ControleIcone>
          <ControleIcone aria-label="Diminuir altura" onClick={() => onRedimensionar(0, -1)}>
            <span className="text-[10px] font-semibold leading-none">A−</span>
          </ControleIcone>
          <ControleIcone aria-label="Aumentar altura" onClick={() => onRedimensionar(0, 1)}>
            <span className="text-[10px] font-semibold leading-none">A+</span>
          </ControleIcone>
          <span className="mx-1 h-3 w-px bg-border" />
          <ControleIcone aria-label="Remover bloco" onClick={onRemover} destrutivo>
            <X size={12} />
          </ControleIcone>
        </div>
      </div>
      <div className="flex-1 p-4">
        {resultado.status === "indisponivel" && (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-muted-foreground">
            <AlertTriangle size={18} />
            <p className="text-xs">Fonte indisponível — a conta referenciada foi arquivada ou removida.</p>
          </div>
        )}
        {resultado.status === "erro" && (
          <p className="flex h-full items-center justify-center text-xs text-destructive">
            Não foi possível carregar este bloco.
          </p>
        )}
        {resultado.status === "carregando" && (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Carregando…
          </p>
        )}
        {resultado.status === "ok" && <Renderer dados={resultado.dados} />}
      </div>
    </div>
  );
}

function ControleIcone({
  children,
  destrutivo,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { destrutivo?: boolean }) {
  return (
    <button
      className={`rounded p-1 text-muted-foreground hover:bg-secondary ${
        destrutivo ? "hover:text-destructive" : "hover:text-foreground"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
