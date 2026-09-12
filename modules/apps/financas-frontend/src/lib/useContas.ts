import { useEffect, useState } from "react";
import { listarContas, type Conta } from "@/lib/api/contas";

// Hook compartilhado -- transacional, asset-manager e dashboard todos
// precisam da lista de contas (para popular selects e resolver nomes).
export function useContas() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    listarContas()
      .then((c) => ativo && setContas(c))
      .catch(() => ativo && setErro("Não foi possível carregar as contas."));
    return () => {
      ativo = false;
    };
  }, []);

  return { contas, erro, recarregar: () => listarContas().then(setContas) };
}

export function nomeConta(contas: Conta[] | null, id: string): string {
  return contas?.find((c) => c.id === id)?.nome ?? "Conta desconhecida";
}

export function contaExiste(contas: Conta[] | null, id: string): boolean {
  return !!contas?.some((c) => c.id === id && c.status === "ativa");
}
