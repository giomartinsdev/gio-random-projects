// Timeline da sessão (FR-007): eventos em ordem ascendente, cada um com
// autor, descrição legível do payload e tempo relativo (data absoluta no
// title). A leitura dos payloads usa a união discriminada Evento da lib
// — cada ramo recebe o tipo cheio do seu payload.
import type { Evento } from "@/lib/api";
import { dataAbsoluta, tempoRelativo } from "@/lib/tempo";

export function Timeline({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>;
  }
  return (
    <ol className="space-y-0">
      {eventos.map((evento, indice) => (
        <li key={evento.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
            {indice < eventos.length - 1 && <span className="w-px flex-1 bg-border" />}
          </div>
          <div className="flex-1 pb-4">
            {/* break-words: payload status_mudou traz o pr_link cru — URL
                longa não pode empurrar a linha além da tela (FR-014). */}
            <p className="break-words text-sm">
              <span className="font-medium">{evento.autor.nome}</span>{" "}
              <span className="text-muted-foreground">{descricaoDoEvento(evento)}</span>
            </p>
            <time
              dateTime={new Date(evento.criado_em * 1000).toISOString()}
              title={dataAbsoluta(evento.criado_em)}
              className="text-xs text-muted-foreground"
            >
              {tempoRelativo(evento.criado_em)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Payload → frase em pt-BR, um ramo por tipo (payloads do data-model.md).
function descricaoDoEvento(evento: Evento): string {
  switch (evento.tipo) {
    case "criacao":
      return `criou a sessão "${evento.payload.titulo}"`;
    case "retomada":
      return `assumiu a baton de ${evento.payload.dono_anterior}`;
    case "atualizacao_contexto":
      return `atualizou ${nomesDeCampos(evento.payload.campos)}${
        evento.payload.force ? " (sobrescreveu versão mais recente)" : ""
      }`;
    case "extensao_criada":
      return `criou a extensão "${evento.payload.titulo}"`;
    case "status_mudou": {
      const pr = evento.payload.pr_link ? ` · PR: ${evento.payload.pr_link}` : "";
      return `mudou o status de ${evento.payload.de} para ${evento.payload.para}${pr}`;
    }
  }
}

function nomesDeCampos(campos: string[]): string {
  const nomes: Record<string, string> = {
    contexto_md: "contexto",
    proximos_passos_md: "próximos passos",
  };
  return campos.map((campo) => nomes[campo] ?? campo).join(" e ");
}