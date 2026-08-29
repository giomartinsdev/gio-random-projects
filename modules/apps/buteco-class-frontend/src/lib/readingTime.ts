// ~200 wpm over the body, with markdown links reduced to their label
// (a URL of 60 characters isn't 12 words of reading).
export function readingTimeMinutes(markdown: string): number {
  const words = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function readingTimeLabel(markdown: string): string {
  return `${readingTimeMinutes(markdown)} min de leitura`;
}