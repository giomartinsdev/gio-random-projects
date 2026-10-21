/** Formatting helpers. British conventions throughout: £, en-dash scorelines. */

export function money(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`;
  return `${sign}£${abs}`;
}

export function exactMoney(value: number): string {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB")}`;
}

export function scoreline(home: number, away: number): string {
  return `${home}–${away}`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formLabel(result: "home" | "away" | "draw", isHome: boolean): string {
  if (result === "draw") return "D";
  const won = (result === "home" && isHome) || (result === "away" && !isHome);
  return won ? "W" : "L";
}
