// Identidade visual do clube, derivada do que a EA manda.
//
// A EA não publica uma tabela de formas nem uma imagem de escudo: o
// `crest_asset_id` é um id opaco, sem URL. Pior, o `customKit` da maioria dos
// clubes volta no DEFAULT dela (branco #F2F2F2 em cima, roxo #582063 embaixo),
// então desenhar só a partir das cores fazia quase todo escudo sair idêntico.
//
// Aqui a forma, o padrão e -- quando o clube não customizou o kit -- as cores
// saem de um hash do próprio clube. O mesmo clube desenha sempre o mesmo
// escudo, e clubes diferentes se distinguem. Quem TEM cores próprias na fonte
// continua sendo desenhado com elas: o hash nunca sobrescreve dado real.

/** O kit que a EA devolve para quem não customizou o uniforme (kitColor1
 * branco, kitColor2 roxo). Reconhecê-lo é o que separa "este clube escolheu
 * branco e roxo" de "a EA não sabe as cores deste clube" -- sem isso, os dois
 * casos viram o mesmo escudo genérico. */
const EA_DEFAULT_KIT = { color1: 0xf2f2f2, color2: 0x582063 };

/** FNV-1a de 32 bits. Só precisa ser estável e bem distribuído: a mesma seed
 * tem que dar sempre o mesmo escudo, e seeds parecidas (ids vizinhos) não. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seed do clube, da mais estável para a menos.
 *
 * O `club_id` vem primeiro porque é o único identificador de fato único: a EA
 * manda o MESMO `crest_asset_id` para clubes diferentes (medido em produção:
 * "Bayern" e "20p Tigers" chegam os dois com 99160827), então usá-lo como
 * chave fazia dois clubes desenharem o mesmo escudo. O nome é o que sobra
 * quando a tela só tem o nome -- a súmula de uma partida não traz o clube
 * inteiro. */
export function crestSeed(club: { crest_asset_id?: string; club_id?: string; name?: string; tag?: string }): string {
  return club.club_id || club.crest_asset_id || club.name || club.tag || "fc";
}

export function toHex(decimal: number | undefined | null): string {
  return "#" + Number(decimal ?? 0).toString(16).padStart(6, "0");
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

const INK_LIGHT = "#ffffff";
// Preto puro, não quase-preto: com #0b0d0f a zona de empate entre as duas
// tintas cai para ~4.4 (abaixo do AA de 4.5); com #000000 o pior caso sobe
// para ~4.6 em toda a faixa de hue. Ver o comentário de `inkOn`.
const INK_DARK = "#000000";

function luminance(hexColor: string): number {
  const c = hexColor.replace("#", "");
  const chan = (i: number) => parseInt(c.slice(i, i + 2), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(chan(0)) + 0.7152 * lin(chan(2)) + 0.0722 * lin(chan(4));
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A cor que fica legível sobre `bg`. Escolhe entre preto e branco pelo
 * contraste REAL, não por um limiar de luminância: nas cores amarelo-
 * esverdeadas (a faixa de hue ~60-90) o limiar erra e nenhum dos dois passa --
 * medir os dois lados é o único jeito de garantir a sigla legível, e o fundo
 * agora vem de um hash, então não dá para assumir contraste. */
function inkOn(bg: string): string {
  return contrast(INK_LIGHT, bg) >= contrast(INK_DARK, bg) ? INK_LIGHT : INK_DARK;
}

export type Palette = {
  /** Fundo do escudo. */
  base: string;
  /** Detalhe (padrão e contorno). */
  detail: string;
  /** A cor legível sobre `base`, para a sigla. */
  ink: string;
  /** As quatro cores do uniforme, já normalizadas. */
  kits: [string, string, string, string];
  /** true = as cores vieram do hash (a EA mandou o default); false = são as
   * cores reais que o clube escolheu. */
  derived: boolean;
};

/** Normaliza as cores do clube numa paleta usável.
 *
 * Se o clube customizou o kit, as cores dele mandam. Se não, as cores são
 * derivadas da seed -- dois tons análogos (um escuro e um claro o bastante
 * para o gradiente ler como um escudo, não como um borrão) mais as duas cores
 * do uniforme. */
export function clubPalette(
  seed: string,
  colors: number[],
): Palette {
  const [r1, r2, r3, r4] = colors.map((c) => Number(c ?? 0));
  const isDefault =
    (r1 === EA_DEFAULT_KIT.color1 && r2 === EA_DEFAULT_KIT.color2) || (r1 === 0 && r2 === 0) || (!r1 && !r2);

  if (!isDefault) {
    const c1 = toHex(r1);
    const c2 = toHex(r2) === "#000000" ? toHex(r3 || r1) : toHex(r2);
    return {
      base: c1,
      detail: c2,
      ink: inkOn(c1),
      kits: [toHex(r1), toHex(r2), toHex(r3 || r1), toHex(r4 || r2)],
      derived: false,
    };
  }

  // Três bits independentes do hash, não um hue só: com 360 valores de matiz
  // o aniversário ainda colide (3 em 60 clubes medidos com ids reais). Matiz
  // x saturação x luminosidade dá ~10^5 combinações, todas dentro da faixa
  // que lê como cor de clube -- nem pastel, nem neon.
  const h = hash32(seed + "|palette");
  const hue = h % 360;
  const sat = 46 + ((h >>> 9) % 26); // 46..71
  const light = 33 + ((h >>> 17) % 13); // 33..45
  const base = hslToHex(hue, sat, light);
  const detail = hslToHex((hue + 28) % 360, Math.min(74, sat + 8), Math.max(18, light - 18));
  return {
    base,
    detail,
    ink: inkOn(base),
    kits: [
      base,
      detail,
      hslToHex((hue + 200) % 360, 40, 92),
      hslToHex((hue + 180) % 360, Math.min(70, sat), Math.max(22, light - 10)),
    ],
    derived: true,
  };
}

/** As formas de escudo. O `crest_asset_id` existe mas não tem tabela
 * publicada, então não dá para mapear id->forma: o hash escolhe uma. São
 * deliberadamente distintas (clássico, reto, redondo, hexagonal, oval,
 * arredondado) para que a silhueta sozinha já diferencie dois clubes. */
const SHAPES = [
  "M50 4L94 20V56C94 82 74 98 50 106 26 98 6 82 6 56V20Z",
  "M10 8H90V58C90 84 70 100 50 106 30 100 10 84 10 58Z",
  "M50 6A44 44 0 1 0 50 94A44 44 0 1 0 50 6Z",
  "M50 4L92 24V72L50 106 8 72V24Z",
  "M24 8H76Q92 8 92 24V56C92 82 74 98 50 106 26 98 8 82 8 56V24Q8 8 24 8Z",
  "M50 6C78 6 92 28 92 56 92 84 74 100 50 106 26 100 8 84 8 56 8 28 22 6 50 6Z",
] as const;

export function crestShape(seed: string): string {
  return SHAPES[hash32(seed + "|shape") % SHAPES.length];
}

/** Os padrões desenhados sobre a forma, recortados por ela. Um escudo sólido
 * lê como "bloco de cor"; o padrão dá o segundo eixo de variação quando a
 * forma e a cor já batem. "solid" é o primeiro para não pesar todo escudo. */
export type Pattern = "solid" | "stripe" | "stripes" | "band" | "diagonal" | "half" | "chevron";
const PATTERNS: Pattern[] = ["solid", "stripe", "stripes", "band", "diagonal", "half", "chevron"];

export function crestPattern(seed: string): Pattern {
  return PATTERNS[hash32(seed + "|pattern") % PATTERNS.length];
}
