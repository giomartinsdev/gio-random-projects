/**
 * The fetcher is a build-time script, not shipped code, but its parsers are where
 * every real-data defect has actually come from: a wikilink split down the middle,
 * a loan club read as a player, an actor with a footballer's name. Those are all
 * pure string transforms, so they are tested directly rather than by hitting the
 * network.
 */
import { describe, expect, it } from "vitest";

import {
  clean,
  infoboxField,
  parseCapacity,
  parseClubs,
  parseSquad,
  plainText,
  splitFields,
} from "../../scripts/wikipedia-parse.mjs";

describe("splitFields", () => {
  it("does not split a wikilink down the middle", () => {
    // The naive `split("|")` this replaces turned this into two fields, leaving
    // "[[Laurie Walker" as the player's name in the shipped snapshot.
    const body = "no=1|name=[[Laurie Walker (footballer)|Laurie Walker]]|pos=GK";
    expect(splitFields(body)).toEqual([
      "no=1",
      "name=[[Laurie Walker (footballer)|Laurie Walker]]",
      "pos=GK",
    ]);
  });

  it("does not split a nested template", () => {
    expect(splitFields("a=1|b={{flag|ENG}}|c=3")).toEqual(["a=1", "b={{flag|ENG}}", "c=3"]);
  });
});

describe("clean", () => {
  it("keeps the display half of a piped link", () => {
    expect(clean("[[Wolverhampton Wanderers F.C.|Wolves]]")).toBe("Wolves");
  });

  it("drops references and templates", () => {
    expect(clean("Deva Stadium<ref>{{cite web|url=x}}</ref>")).toBe("Deva Stadium");
  });
});

describe("plainText", () => {
  it("strips the HTML Commons puts in an author field", () => {
    // This is a raw `extmetadata.Artist` value; escaped into the footer it would
    // have shipped an <a> tag to the user.
    const raw =
      '<a rel="nofollow" class="external text" href="https://flickr.com/people/1">Adam Thomas</a>';
    expect(plainText(raw)).toBe("Adam Thomas");
  });

  it("decodes the entities that survive stripping", () => {
    expect(plainText("Q&amp;A &quot;Ltd&quot;")).toBe('Q&A "Ltd"');
  });
});

describe("parseSquad", () => {
  const squad = (body: string) => `==Current squad==\n{{fs start}}\n${body}\n{{fs end}}`;

  it("reads the linked article as the identity and the label as the name", () => {
    const [player] = parseSquad(
      squad("{{Fs player|no=11|nat=ENG|pos=FW|name=[[Billy Waters (footballer, born 1994)|Billy Waters]]}}"),
    );

    expect(player.name).toBe("Billy Waters");
    // The disambiguator is exactly what makes the lookup unambiguous.
    expect(player.target).toBe("Billy Waters (footballer, born 1994)");
  });

  it("does not mistake a loan club for the player", () => {
    // "Lewys Benjamin (on loan from [[Wolverhampton Wanderers F.C.|Wolves]])"
    // shipped a goalkeeper called "Wolves" before this was parsed properly.
    const [player] = parseSquad(
      squad("{{Fs player|no=13|nat=WAL|pos=GK|name=Lewys Benjamin (on loan from [[Wolverhampton Wanderers F.C.|Wolves]])}}"),
    );

    expect(player.name).toBe("Lewys Benjamin");
    expect(player.target).toBeNull();
  });

  it("has no target for an unlinked name, so no lookup is attempted", () => {
    const [player] = parseSquad(squad("{{Fs player|no=2|nat=ENG|pos=DF|name=Matt Curley}}"));

    expect(player.name).toBe("Matt Curley");
    expect(player.target).toBeNull();
  });

  it("keeps numbers, positions and nationalities", () => {
    const [player] = parseSquad(
      squad("{{Fs player|no=7|nat=SCO|pos=MF|name=Declan Weeks|captain=yes}}"),
    );

    expect(player.number).toBe(7);
    expect(player.position).toBe("MF");
    expect(player.nationality).toBe("SCO");
  });
});

describe("parseClubs", () => {
  it("reads only the member-club rows and stops at the next section", () => {
    // The first version sliced a fixed length and ran into the champions table,
    // turning season articles into clubs.
    const wikitext = `
==Member clubs for 2026–27==
{| class="wikitable"
|-
!Club
!Finishing position [[2025–26 in English football|2025–26]]
|-
|style="text-align:left;"|[[AFC Telford United]]||11th
|-
|style="text-align:left;"|[[Bedford Town F.C.|Bedford Town]]||18th
|}
==League champions==
|-
|style="text-align:left;"|[[2004–05 in English football|2004–05]]||Champions
`;

    expect(parseClubs(wikitext)).toEqual([
      { target: "AFC Telford United", name: "AFC Telford United" },
      { target: "Bedford Town F.C.", name: "Bedford Town" },
    ]);
  });

  it("refuses an article with no member-club section", () => {
    expect(() => parseClubs("==History==\nNothing here.")).toThrow(/Member clubs/);
  });
});

describe("infoboxField", () => {
  it("does not truncate a venue at a wikilink pipe", () => {
    const text = "| ground = The New Eyrie, [[Cardington, Bedfordshire|Cardington]]\n| capacity = 3,000";
    expect(infoboxField(text, "ground")).toBe("The New Eyrie, Cardington");
  });

  it("reads a capacity with a thousands separator", () => {
    expect(parseCapacity("| capacity = 6,300")).toBe(6300);
  });

  it("reads through a citation rather than choking on it", () => {
    // Refs and templates are stripped before the digits are read, so a citation
    // year can never be mistaken for the capacity.
    const text = '| capacity = 6,300<ref name="ground">{{cite web|date=2024}}</ref>';
    expect(parseCapacity(text)).toBe(6300);
  });
});
