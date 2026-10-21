/**
 * Pure parsers for the Wikipedia snapshot.
 *
 * These live apart from `fetch-wikipedia.mjs` so they can be tested without a
 * network. Every real-data defect so far has been a string transform in this file
 * — a wikilink split at its pipe, a loan club read as a player, an actor with a
 * footballer's name — and none of those need an HTTP request to reproduce.
 */

/** Strips `[[Target|Label]]`, `[[Target]]`, refs and templates from a wikitext value. */
function clean(value) {
  return String(value ?? "")
    .replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Wikimedia's `Artist` field is HTML, not wikitext.
 *
 * A credit reading `<a rel="nofollow" class="external text" href="https://flickr…">Adam Thomas</a> / Wikimedia Commons, CC BY 2.0`
 * is correct data in the wrong shape: it would be escaped and shown verbatim in
 * the footer. This keeps the visible text and the licence, drops the markup.
 */
function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits a template body on `|` at the top level only.
 *
 * `name=[[Laurie Walker (footballer)|Laurie Walker]]` is one field, not two. A
 * naive `split("|")` halves the wikilink and leaves "[[Laurie Walker" in the
 * squad — which is exactly what the first version of this file did.
 */
function splitFields(body) {
  const fields = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "[[" || two === "{{") {
      depth += 1;
      current += two;
      i += 1;
      continue;
    }
    if (two === "]]" || two === "}}") {
      depth = Math.max(0, depth - 1);
      current += two;
      i += 1;
      continue;
    }
    if (body[i] === "|" && depth === 0) {
      fields.push(current);
      current = "";
      continue;
    }
    current += body[i];
  }
  fields.push(current);
  return fields;
}

function parseTemplates(text, name) {
  // Squad templates are flat — no nested braces inside an Fs player line — so a
  // non-greedy match to the first `}}` is correct here.
  const re = new RegExp(`\\{\\{\\s*${name}\\s*\\|([\\s\\S]*?)\\}\\}`, "gi");
  const out = [];
  for (const match of text.matchAll(re)) {
    const fields = {};
    for (const part of splitFields(match[1])) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    out.push(fields);
  }
  return out;
}

/**
 * Member clubs for the current season, from the league article's table.
 *
 * The slice has to stop at the next heading of the same level. Taking a fixed
 * 8,000 characters instead ran into the "League champions" table and turned
 * season articles ("2004–05") into clubs.
 */
function parseClubs(text) {
  const heading = text.match(/==+\s*Member clubs[^=]*==+/i);
  if (!heading || heading.index === undefined) {
    throw new Error("No 'Member clubs' section found; the article layout changed.");
  }
  const level = (heading[0].match(/=+/)?.[0] ?? "==").length;
  const from = heading.index + heading[0].length;
  const rest = text.slice(from);
  // A heading of the same level closes the section.
  const nextHeading = rest.search(new RegExp(`\\n={${level}}[^=]`));
  const segment = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const clubs = [];
  const seen = new Set();
  for (const row of segment.split(/\n\|-\s*\n/).slice(1)) {
    // Only club rows are left-aligned; the header row is a plain cell and would
    // otherwise contribute the "2025–26 in English football" season article.
    if (!/\|\s*style="text-align:left;"\s*\|/i.test(row)) continue;
    const link = row.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!link) continue;
    const target = link[1].trim();
    const label = clean(link[2] ?? link[1]);
    if (!label || seen.has(target)) continue;
    if (/^(File|Image|Category):/i.test(target)) continue;
    if (/\bin English football$/i.test(target)) continue;
    seen.add(target);
    clubs.push({ target, name: label });
  }
  return clubs;
}

/**
 * Squad from an `{{Fs player}}` block.
 *
 * Non-league articles are inconsistent: the template is sometimes `Fs player`,
 * sometimes `Football squad player`, and the name sometimes carries a
 * disambiguator ("Laurie Walker (footballer)") that must not reach the UI.
 */
function parseSquad(text) {
  let rows = parseTemplates(text, "Fs player");
  if (rows.length < 11) rows = rows.concat(parseTemplates(text, "Football squad player"));

  return (
    rows
      .map((f) => {
        const rawName = f.name ?? "";
        // The display name loses the disambiguator; the *article target* keeps it
        // and is what should be looked up in Wikidata. Resolving "Billy Waters"
        // instead of "Billy Waters (footballer, born 1994)" is how a snapshot ends
        // up with a portrait of a different man with the same name.
        //
        // The first link in the field is the player. A loan note appends a second
        // one — "Lewys Benjamin (on loan from [[Wolverhampton Wanderers F.C.|Wolves]])"
        // — and reading whichever link came first is what put a goalkeeper called
        // "Wolves" in the squad.
        const head = rawName.split(/\s*\(on loan\b/i)[0];
        const linked = head.match(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
        // `target` stays null when the name is plain text: a bare name is not an
        // article title, and querying one invites exactly the collision this
        // change removes.
        const target = linked ? linked[1].trim() : null;
        const display = clean(linked ? (linked[2] ?? linked[1]) : head);
        const name = display.replace(/\s*\([^)]*\)\s*$/, "").trim();
        return {
          name,
          target,
          number: f.no ? Number(clean(f.no)) : null,
          position: (f.pos ?? "").toUpperCase().replace(/[^A-Z]/g, "") || null,
          nationality: f.nat ? clean(f.nat).toUpperCase() : null,
          other: clean(f.other),
        };
      })
      // A player whose "name" is a loan note rather than a person is noise.
      .filter((p) => p.name && p.name.length > 2)
  );
}

function infoboxField(text, field) {
  const match = text.match(new RegExp(`\\|\\s*${field}\\s*=\\s*([^\\n]*)`, "i"));
  if (!match) return null;
  const value = clean(match[1]).replace(/\s*,\s*$/, "").trim();
  return value || null;
}

function parseCapacity(text) {
  const raw = infoboxField(text, "capacity");
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  const value = Number(digits);
  // A ground cannot hold fewer than 100 people or more than the largest stadium in
  // Europe; anything outside that is a parse artefact, not a capacity.
  return value >= 100 && value <= 200_000 ? value : null;
}

export {
  clean,
  infoboxField,
  parseCapacity,
  parseClubs,
  parseSquad,
  parseTemplates,
  plainText,
  splitFields,
};
