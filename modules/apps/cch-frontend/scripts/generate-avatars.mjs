#!/usr/bin/env node
// Gera os bonequinhos do CCH -- um por pessoa na sala -- como Lottie
// JSON em src/assets/avatars/. Rodado manualmente (node
// scripts/generate-avatars.mjs); os JSONs gerados ficam commitados,
// então o build nunca depende deste script -- ele existe para os
// personagens terem uma fonte legível e paramétrica em vez de blocos
// opacos de After Effects JSON no repo.
//
// Cada personagem é UMA camada de shapes com:
//   - um "idle bob" na posição da camada (respiração, ~3s em loop);
//   - olhos de três partes (esclera branca + pupila que pisca + brilho)
//     em vez de uma bolinha lisa -- é o que faz o rosto ler como rosto
//     mesmo pequeno;
//   - cada personagem pisca em um momento e boia num ritmo diferente,
//     para uma sala cheia não parecer um coral sincronizado.
//
// Tudo em coordenadas de um canvas 200x200, 60fps, loop de 180 frames.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "avatars");
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- helpers

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const INK = "#1e293b"; // traço facial (olhos, boca) de todo mundo

const fill = (color) => ({ ty: "fl", c: { a: 0, k: hex(color) }, o: { a: 0, k: 100 }, nm: "fill" });
const fillOpacity = (color, opacity) => ({ ty: "fl", c: { a: 0, k: hex(color) }, o: { a: 0, k: opacity }, nm: "fill" });
const stroke = (color, w) => ({
  ty: "st", c: { a: 0, k: hex(color) }, o: { a: 0, k: 100 }, w: { a: 0, k: w }, lc: 2, lj: 2, nm: "stroke",
});

// Tamanho do shape: estático, ou piscando (encolhe e volta) quando
// blinkAt é passado. Toda keyframe (menos a última, que não abre
// segmento nenhum) PRECISA do easing temporal i/o -- sem eles o
// lottie-web interpola o raio da elipse para algo próximo de infinito
// (o "olho" vira um bloco sólido cobrindo o personagem inteiro). Vimos
// isso quebrado em produção antes desta função ganhar i/o; o bob da
// camada (bobKeyframes, abaixo) sempre teve isso certo -- é por que só
// os olhos, não o corpo todo, saíam quebrados.
const LINEAR = { i: { x: [0.33, 0.33], y: [1, 1] }, o: { x: [0.67, 0.67], y: [0, 0] } };
const sizeProp = (w, h, blinkAt) => {
  if (blinkAt == null) return { a: 0, k: [w, h] };
  return {
    a: 1,
    k: [
      { t: 0, s: [w, h], ...LINEAR },
      { t: blinkAt, s: [w, h], ...LINEAR },
      { t: blinkAt + 6, s: [Math.max(w * 0.3, 2), Math.max(h * 0.1, 2)], ...LINEAR },
      { t: blinkAt + 12, s: [w, h], ...LINEAR },
      { t: 180, s: [w, h] },
    ],
  };
};

const ellipse = (x, y, w, h, blinkAt) => ({ ty: "el", p: { a: 0, k: [x, y] }, s: sizeProp(w, h, blinkAt), nm: "el" });
const rect = (x, y, w, h, r, blinkAt) => ({
  ty: "rc", p: { a: 0, k: [x, y] }, s: sizeProp(w, h, blinkAt), r: { a: 0, k: r }, nm: "rect",
});
const path = (verts, closed) => ({
  ty: "sh",
  ks: {
    a: 0,
    k: {
      i: verts.map((v) => v.i ?? [0, 0]),
      o: verts.map((v) => v.o ?? [0, 0]),
      v: verts.map((v) => v.p),
      c: !!closed,
    },
  },
  nm: "path",
});

// Vértices de um polígono estrela de N pontas, coordenadas absolutas
// no canvas (nunca uma posição de grupo -- ver o aviso em
// bobKeyframes sobre por que shape position e group position não se
// somam por engano neste arquivo).
function starVerts(cx, cy, spikes, outerR, innerR, rotDeg = -90) {
  const verts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = ((rotDeg + (i * 360) / (spikes * 2)) * Math.PI) / 180;
    verts.push({ p: [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] });
  }
  return verts;
}

// Todo grupo termina num transform identidade (shapes já são desenhados
// em coordenadas do canvas, então o grupo não carrega geometria).
const tr = (extra = {}) => ({
  ty: "tr",
  p: { a: 0, k: extra.p ?? [0, 0] },
  a: { a: 0, k: extra.a ?? [0, 0] },
  s: { a: 0, k: extra.s ?? [100, 100] },
  r: { a: 0, k: extra.r ?? 0 },
  o: { a: 0, k: 100 },
});
const group = (nm, items, trExtra) => ({ ty: "gr", nm, it: [...items, tr(trExtra)] });

// Sorriso: um cubic aberto cujos dois pontos de controle ficam abaixo
// da corda (dip > 0 = curva pra baixo = sorriso).
const smile = (x1, x2, y, dip, w) =>
  group("smile", [
    path([{ p: [x1, y], o: [(x2 - x1) * 0.28, dip] }, { p: [x2, y], i: [-(x2 - x1) * 0.28, dip] }], false),
    stroke(INK, w),
  ]);

// Olho de três camadas -- esclera branca fixa atrás, pupila que pisca
// no meio, brilho por cima -- em vez de uma bolinha lisa da cor da
// tinta. É o brilho + a esclera que fazem o personagem ler como "tem
// um rosto" mesmo em 18-24px; uma elipse sólida lisa nessa escala vira
// só uma marca de cor. Lottie empilha `it` com o PRIMEIRO item por
// cima, então o brilho vem primeiro e a esclera por último.
const eye = (x, y, w, h, blinkAt, color = INK) =>
  group("eye", [
    group("hl", [ellipse(x - w * 0.16, y - h * 0.2, w * 0.26, h * 0.26), fill("#ffffff")]),
    group("pupil", [ellipse(x, y, w * 0.58, h * 0.58, blinkAt), fill(color)]),
    group("sclera", [ellipse(x, y, w, h), fill("#ffffff")]),
  ]);

// Olho de vidro do robô: sem esclera (ele é uma lente, não um bicho),
// mas ganha o mesmo brilho para não virar um retângulo morto.
const rectEye = (x, y, w, h, blinkAt, color = INK) =>
  group("eye", [
    group("hl", [ellipse(x - w * 0.16, y - h * 0.24, w * 0.32, h * 0.2), fill("#ffffff")]),
    group("glass", [rect(x, y, w, h, 4, blinkAt), fill(color)]),
  ]);

// Olho fechado feliz: um arco em ∩ (controles acima da corda).
const happyEye = (x1, x2, y, w) =>
  group("happy-eye", [
    path([{ p: [x1, y], o: [(x2 - x1) * 0.3, -8] }, { p: [x2, y], i: [-(x2 - x1) * 0.3, -8] }], false),
    stroke(INK, w),
  ]);

// Bochecha corada -- um toque de calor no rosto, opcional (só entra
// nos bichos "fofos"; robô, alien, estrela etc ficam sem).
const blush = (x, y, r) => group("blush", [ellipse(x, y, r, r * 0.62), fillOpacity("#fb7185", 55)]);

// Respiração da camada inteira: 3 keyframes com tangentes espaciais
// (to/ti) para uma senoide macia em vez de um vai-e-vem mecânico. The
// layer's anchor is (0,0) (see layer(), below) and every shape is
// already drawn in absolute canvas coordinates -- so this position
// must baseline at (0,0) too. A (100,100) baseline here (this
// function's original bug) doesn't nudge the character, it TRANSLATES
// the whole body by (100,100) on top of its own already-absolute
// coordinates, shoving nearly the entire character outside the 200x200
// clip and leaving only a stray corner sliver on screen -- which is
// exactly the "bugged icon" every avatar rendered as until this fix.
const bobKeyframes = (amp, midT) => {
  const ease = { i: { x: [0.45, 0.45], y: [1, 1] }, o: { x: [0.55, 0.55], y: [0, 0] } };
  return {
    a: 1,
    k: [
      { t: 0, s: [0, amp, 0], to: [0, -amp * 0.55, 0], ti: [0, amp * 0.55, 0], ...ease },
      { t: midT, s: [0, -amp, 0], to: [0, amp * 0.55, 0], ti: [0, -amp * 0.55, 0], ...ease },
      { t: 180, s: [0, amp, 0] },
    ],
  };
};

const layer = (nm, shapes, bob) => ({
  ddd: 0, ind: 1, ty: 4, nm, sr: 1,
  ks: {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: bob,
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
  },
  ao: 0,
  shapes,
  ip: 0, op: 180, st: 0, bm: 0,
});

const doc = (nm, shapes, bobOpts) => ({
  v: "5.9.0", fr: 60, ip: 0, op: 180, w: 200, h: 200, nm, ddd: 0,
  assets: [],
  layers: [layer(nm, shapes, bobKeyframes(bobOpts.amp ?? 4, bobOpts.mid ?? 90))],
  markers: [],
});

// ------------------------------------------------------------- personagens
//
// 18 no total -- o suficiente pra uma sala cheia raramente repetir
// ninguém (o servidor sorteia um índice livre por pessoa, ver
// game.go's nextAvatarLocked; o cliente usa `avatar % 18` só como
// rede de segurança pra uma sala anormalmente grande).

// IMPORTANT ordering rule: lottie-web treats index 0 of a shapes array
// as FRONTMOST (it ends up last in the rendered SVG, which is what
// paints on top) -- so any face feature (eye, nose, mouth, blush,
// stripe, patch, pip) MUST come before the base body fill in this
// array, or the body paints right over it and the character ends up
// looking like a flat color blob with nothing on it. Every character
// below lists the body (and any body-colored filler pieces, like
// fantasma's tail bumps) LAST for exactly this reason.
const chars = [
  // Blob: o clássico. Um gotinha verde-água com cara de quem entendeu
  // tudo errado -- e vai ganhar a rodada mesmo assim.
  () =>
    doc("blob", [
      eye(78, 100, 16, 20, 100),
      eye(122, 100, 16, 20, 100),
      smile(82, 118, 130, 12, 6),
      blush(72, 118, 11),
      blush(128, 118, 11),
      group("body", [ellipse(100, 116, 116, 104), fill("#14b8a6")]),
    ], { amp: 4, mid: 90 }),

  // Tangerina: redondinha, com folha no topo.
  () =>
    doc("tangerina", [
      group("leaf", [ellipse(126, 60, 26, 12), fill("#4ade80")], { p: [126, 60], a: [126, 60], r: -32 }),
      eye(82, 110, 15, 18, 40),
      eye(118, 110, 15, 18, 40),
      smile(84, 116, 134, 10, 6),
      blush(76, 122, 10),
      blush(124, 122, 10),
      group("body", [ellipse(100, 120, 108, 100), fill("#fb923c")]),
    ], { amp: 3.5, mid: 80 }),

  // Fantasma: elipse com ondulação embaixo ( três bolinhas da cor do
  // corpo furam a silhueta), olhos compridos.
  () =>
    doc("fantasma", [
      eye(84, 100, 16, 24, 120),
      eye(116, 100, 16, 24, 120),
      group("mouth", [ellipse(100, 130, 12, 10), fill(INK)]),
      group("tail-1", [ellipse(76, 158, 30, 28), fill("#c4b5fd")]),
      group("tail-2", [ellipse(100, 164, 30, 28), fill("#c4b5fd")]),
      group("tail-3", [ellipse(124, 158, 30, 28), fill("#c4b5fd")]),
      group("body", [ellipse(100, 112, 106, 112), fill("#c4b5fd")]),
    ], { amp: 5, mid: 100 }),

  // Gato: orelhas triangulares, focinho.
  () =>
    doc("gato", [
      group("ear-l", [path([{ p: [60, 92] }, { p: [72, 48] }, { p: [98, 78] }], true), fill("#f9a8d4")]),
      group("ear-r", [path([{ p: [102, 78] }, { p: [128, 48] }, { p: [140, 92] }], true), fill("#f9a8d4")]),
      blush(78, 122, 9),
      blush(122, 122, 9),
      eye(84, 108, 14, 16, 70),
      eye(116, 108, 14, 16, 70),
      group("nose", [path([{ p: [94, 126] }, { p: [106, 126] }, { p: [100, 134] }], true), fill(INK)]),
      smile(88, 112, 138, 7, 4),
      group("body", [ellipse(100, 118, 104, 96), fill("#f9a8d4")]),
    ], { amp: 3.5, mid: 70 }),

  // Robô: chapa metálica, olhos de vidro retangulares, antena piscando
  // luz vermelha (o "piscar" dele é a lâmpada, não os olhos).
  () =>
    doc("robo", [
      group("antenna", [path([{ p: [100, 72] }, { p: [100, 52] }], false), stroke(INK, 6)]),
      group("lamp", [ellipse(100, 46, 15, 15, 90), fill("#f87171")]),
      rectEye(83, 108, 18, 24, null),
      rectEye(117, 108, 18, 24, null),
      group("mouth", [path([{ p: [88, 136] }, { p: [112, 136] }], false), stroke(INK, 5)]),
      group("body", [rect(100, 120, 106, 98, 20), fill("#94a3b8")]),
    ], { amp: 2.5, mid: 90 }),

  // Alien: alto, olhos amendoados, duas antenas com bolinha.
  () =>
    doc("alien", [
      group("antenna-l", [path([{ p: [84, 66] }, { p: [74, 44] }], false), stroke(INK, 5)]),
      group("antenna-r", [path([{ p: [116, 66] }, { p: [126, 44] }], false), stroke(INK, 5)]),
      group("ball-l", [ellipse(72, 40, 13, 13), fill("#fbbf24")]),
      group("ball-r", [ellipse(128, 40, 13, 13), fill("#fbbf24")]),
      eye(81, 102, 19, 26, 130),
      eye(119, 102, 19, 26, 130),
      group("mouth", [path([{ p: [92, 138] }, { p: [108, 138] }], false), stroke(INK, 4)]),
      group("body", [ellipse(100, 118, 96, 118), fill("#4ade80")]),
    ], { amp: 4.5, mid: 110 }),

  // Limão: achatado, olhos fechados de tanto rir (não pisca -- já
  // vive de olhos fechados).
  () =>
    doc("limao", [
      blush(66, 124, 11),
      blush(134, 124, 11),
      happyEye(70, 90, 106, 6),
      happyEye(110, 130, 106, 6),
      group("mouth", [ellipse(100, 130, 18, 13), fill(INK)]),
      group("body", [ellipse(100, 120, 126, 96), fill("#fde047")]),
    ], { amp: 3, mid: 85 }),

  // Uva: ciclope roxo de um olho só, com pezinhos.
  () =>
    doc("uva", [
      group("foot-l", [ellipse(83, 172, 22, 11), fill("#7c3aed")]),
      group("foot-r", [ellipse(117, 172, 22, 11), fill("#7c3aed")]),
      eye(100, 102, 34, 34, 60),
      smile(86, 114, 136, 8, 5),
      group("body", [rect(100, 118, 92, 112, 28), fill("#a78bfa")]),
    ], { amp: 3.5, mid: 95 }),

  // Estrela: um polígono de 5 pontas, cara de quem já ganhou antes e
  // sabe disso.
  () =>
    doc("estrela", [
      blush(68, 122, 9),
      blush(132, 122, 9),
      eye(86, 106, 14, 17, 55),
      eye(114, 106, 14, 17, 55),
      smile(88, 112, 128, 9, 5),
      group("body", [path(starVerts(100, 112, 5, 62, 26), true), fill("#fde047")]),
    ], { amp: 3.5, mid: 95 }),

  // Coração: dois lóbulos e uma base -- o mascote mais sincero da mesa.
  () =>
    doc("coracao", [
      eye(84, 96, 14, 17, 85),
      eye(116, 96, 14, 17, 85),
      smile(88, 112, 118, 5, 5),
      group("lobe-l", [ellipse(78, 90, 44, 44), fill("#fb7185")]),
      group("lobe-r", [ellipse(122, 90, 44, 44), fill("#fb7185")]),
      group("base", [path([{ p: [58, 96] }, { p: [100, 168] }, { p: [142, 96] }], true), fill("#fb7185")]),
    ], { amp: 4, mid: 100 }),

  // Nuvem: três bolhas sobrepostas, cara de sonolenta.
  () =>
    doc("nuvem", [
      happyEye(80, 96, 108, 5),
      happyEye(112, 128, 108, 5),
      group("mouth", [ellipse(100, 122, 10, 7), fill(INK)]),
      group("puff-l", [ellipse(66, 122, 46, 40), fill("#e0f2fe")]),
      group("puff-r", [ellipse(134, 122, 46, 40), fill("#e0f2fe")]),
      group("puff-mid", [ellipse(100, 100, 62, 52), fill("#e0f2fe")]),
    ], { amp: 3, mid: 100 }),

  // Raposa: laranja, orelhas triangulares grandes, focinho branco.
  () =>
    doc("raposa", [
      group("ear-l-in", [path([{ p: [70, 78] }, { p: [75, 52] }, { p: [92, 74] }], true), fill("#fff7ed")]),
      group("ear-r-in", [path([{ p: [108, 74] }, { p: [125, 52] }, { p: [130, 78] }], true), fill("#fff7ed")]),
      group("ear-l", [path([{ p: [62, 88] }, { p: [70, 40] }, { p: [102, 76] }], true), fill("#fb923c")]),
      group("ear-r", [path([{ p: [98, 76] }, { p: [130, 40] }, { p: [138, 88] }], true), fill("#fb923c")]),
      eye(84, 108, 13, 16, 65),
      eye(116, 108, 13, 16, 65),
      group("nose", [ellipse(100, 132, 9, 7), fill(INK)]),
      group("cheek", [path([{ p: [70, 118] }, { p: [100, 150] }, { p: [130, 118] }], true), fill("#fff7ed")]),
      group("body", [ellipse(100, 120, 100, 92), fill("#fb923c")]),
    ], { amp: 3.5, mid: 75 }),

  // Urso: castanho, orelhas redondas, focinho claro.
  () =>
    doc("urso", [
      group("ear-l", [ellipse(66, 62, 24, 24), fill("#a16207")]),
      group("ear-r", [ellipse(134, 62, 24, 24), fill("#a16207")]),
      blush(72, 124, 10),
      blush(128, 124, 10),
      eye(82, 106, 14, 16, 95),
      eye(118, 106, 14, 16, 95),
      group("nose", [ellipse(100, 122, 9, 7), fill(INK)]),
      group("snout", [ellipse(100, 132, 38, 28), fill("#fef3c7")]),
      group("body", [ellipse(100, 120, 110, 100), fill("#ca8a04")]),
    ], { amp: 3, mid: 85 }),

  // Abelha: listrada, asas translúcidas, sempre parece ocupada.
  () =>
    doc("abelha", [
      group("wing-l", [ellipse(70, 86, 28, 18), fillOpacity("#e0f2fe", 70)]),
      group("wing-r", [ellipse(130, 86, 28, 18), fillOpacity("#e0f2fe", 70)]),
      eye(84, 106, 13, 15, 45),
      eye(116, 106, 13, 15, 45),
      smile(90, 110, 130, 6, 4),
      group("stripe-1", [rect(100, 104, 92, 16, 8), fill("#1e293b")]),
      group("stripe-2", [rect(100, 136, 92, 16, 8), fill("#1e293b")]),
      group("body", [ellipse(100, 120, 92, 84), fill("#fde047")]),
    ], { amp: 4, mid: 90 }),

  // Dado: um cubo arredondado com pips -- o único da mesa que não é
  // um bicho, e ele sabe disso.
  () =>
    doc("dado", [
      eye(84, 112, 13, 16, 60, "#0ea5e9"),
      eye(116, 112, 13, 16, 60, "#0ea5e9"),
      smile(88, 116, 132, 6, 5),
      group("pip-tl", [ellipse(72, 88, 12, 12), fill(INK)]),
      group("pip-tr", [ellipse(128, 88, 12, 12), fill(INK)]),
      group("pip-bl", [ellipse(72, 144, 12, 12), fill(INK)]),
      group("pip-br", [ellipse(128, 144, 12, 12), fill(INK)]),
      group("body", [rect(100, 116, 122, 122, 24), fill("#fafaf9")]),
    ], { amp: 2.5, mid: 90 }),

  // Pau: cápsula rosada com carinha na glande -- o humor do jogo já é
  // pesado (ver os decks), o elenco de bonequinhos acompanha.
  () =>
    doc("pau", [
      eye(88, 62, 11, 13, 75),
      eye(112, 62, 11, 13, 75),
      smile(90, 80, 76, 6, 4),
      group("ridge", [path([{ p: [76, 94] }, { p: [124, 94] }], false), stroke("#c2664f", 4)]),
      group("shaft", [rect(100, 132, 56, 108, 27), fill("#f4a988")]),
      group("head", [ellipse(100, 66, 66, 58), fill("#eb9074")]),
    ], { amp: 3, mid: 90 }),

  // Saco: dois lóbulos enrugados -- cara de quem não tem pressa
  // nenhuma pra lugar nenhum.
  () =>
    doc("saco", [
      eye(84, 104, 13, 15, 100),
      eye(116, 104, 13, 15, 100),
      smile(88, 122, 122, 5, 4),
      group("crease", [path([{ p: [100, 88] }, { p: [100, 152] }], false), stroke("#c2664f", 3)]),
      group("lobe-l", [ellipse(76, 122, 62, 68), fill("#f4a988")]),
      group("lobe-r", [ellipse(124, 122, 62, 68), fill("#f4a988")]),
    ], { amp: 3.5, mid: 95 }),

  // Bunda: duas bochechas e uma fenda -- olhinhos no topo pra ficar
  // ainda mais sem noção.
  () =>
    doc("bunda", [
      happyEye(64, 84, 96, 5),
      happyEye(116, 136, 96, 5),
      group("crack", [path([{ p: [100, 82] }, { p: [100, 168] }], false), stroke("#c2664f", 4)]),
      group("cheek-l", [ellipse(78, 122, 74, 92), fill("#f4a988")]),
      group("cheek-r", [ellipse(122, 122, 74, 92), fill("#f4a988")]),
    ], { amp: 2.5, mid: 100 }),
];

const names = [
  "blob", "tangerina", "fantasma", "gato", "robo", "alien", "limao", "uva",
  "estrela", "coracao", "nuvem", "raposa", "urso", "abelha", "dado",
  "pau", "saco", "bunda",
];
names.forEach((name, i) => {
  const json = JSON.stringify(chars[i](), null, 1);
  writeFileSync(join(outDir, `${name}.json`), json + "\n");
  console.log(`${name}.json  ${(json.length / 1024).toFixed(1)}KB`);
});
console.log(`\n${names.length} bonequinhos em ${outDir}`);
