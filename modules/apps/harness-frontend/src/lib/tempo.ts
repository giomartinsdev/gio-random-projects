// Formatação de tempo para a UI — timestamps chegam como unix epoch
// seconds do contrato (contracts/api.md). "Tempo relativo" aparece na
// lista e na timeline; a data absoluta fica no title de cada elemento
// para consulta no hover.

const MINUTO = 60;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** "agora" | "há 5 min" | "há 3 h" | "há 2 dias" | data curta. */
export function tempoRelativo(unixSegundos: number): string {
  const segundos = Math.floor(Date.now() / 1000 - unixSegundos);
  if (segundos < MINUTO) return "agora";
  if (segundos < HORA) return `há ${Math.floor(segundos / MINUTO)} min`;
  if (segundos < DIA) return `há ${Math.floor(segundos / HORA)} h`;
  if (segundos < 7 * DIA) return `há ${Math.floor(segundos / DIA)} d`;
  return dataCurta(unixSegundos);
}

/** "12/09/2026 14:30" para título/atributo de consulta. */
export function dataAbsoluta(unixSegundos: number): string {
  return new Date(unixSegundos * 1000).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function dataCurta(unixSegundos: number): string {
  return new Date(unixSegundos * 1000).toLocaleDateString("pt-BR");
}