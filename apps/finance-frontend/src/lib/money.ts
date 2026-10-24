// Regras de dinheiro do SPA (§3.4). O domínio proíbe float; o formulário
// entrega string decimal. Estas funções são puras e testadas — um "45,00" que
// virasse número seria a primeira chance de imprecisão no caminho.
import { formatBRL } from "./api";

export const BRL_CURRENCY = "BRL";

/**
 * ``"45"`` / ``"45,50"`` / ``"1.234,56"`` -> ``"45.00"`` / ``"45.50"`` /
 * ``"1234.56"`` (decimal canônico). Devolve ``None`` para valor <= 0 ou
 * não numérico — quem chama mostra o erro, não registra lixo.
 */
export function toDecimalString(raw: string): string | null {
  const clean = raw.trim().replace(/\s/g, "");
  if (!clean) return null;
  const normalised =
    clean.includes(",") && clean.includes(".")
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  const value = Number(normalised);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(2);
}

/** O instante tz-aware para um dia ``YYYY-MM-DD`` (meio-dia local, com offset). */
export function occurredAtForDay(day: string): string {
  return new Date(`${day}T12:00:00`).toISOString();
}

export { formatBRL };
