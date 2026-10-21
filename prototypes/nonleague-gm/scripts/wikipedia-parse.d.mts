/**
 * Types for the build-time Wikipedia parsers.
 *
 * `scripts/` is plain ESM run by Node, not part of the app bundle, but the parsers
 * are the part of the fetcher worth testing and the tests live under `src/`. This
 * declaration is the seam: it lets `wikipedia.test.ts` import real code without
 * pulling the network, cache and CLI half of the script into the app's type graph.
 */

export interface SquadPlayer {
  /** Display name, without the article disambiguator. */
  name: string;
  /** Article title to resolve against Wikidata, or null when the name is unlinked. */
  target: string | null;
  number: number | null;
  position: string | null;
  nationality: string | null;
  other: string;
}

export interface ClubRow {
  target: string;
  name: string;
}

export function clean(value: unknown): string;
export function plainText(value: unknown): string;
export function splitFields(body: string): string[];
export function parseTemplates(text: string, name: string): Record<string, string>[];
export function parseClubs(text: string): ClubRow[];
export function parseSquad(text: string): SquadPlayer[];
export function infoboxField(text: string, field: string): string | null;
export function parseCapacity(text: string): number | null;
