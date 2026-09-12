// Rascunho de formulário em localStorage — edge case da spec: "API
// indisponível: frontend mostra estado de erro e mantém o rascunho do
// form localmente (localStorage) para não perder o que foi digitado".
// Todo acesso é envolvido em try/catch: storage pode vir vazio ou ser
// bloqueado (janela privada) e a página tem que seguir funcionando.

export function lerRascunho<T>(chave: string): T | null {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return null;
    return JSON.parse(bruto) as T;
  } catch {
    return null;
  }
}

export function salvarRascunho<T>(chave: string, valor: T): void {
  try {
    window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // sem storage: a digitação sobrevive só até o reload — aceitável.
  }
}

export function limparRascunho(chave: string): void {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    // nada a limpar sem storage.
  }
}