#!/usr/bin/env node
// Gera os bonequinhos do CCH -- um por pessoa na sala -- como Lottie
// JSON em src/assets/avatars/. Rodado manualmente (node
// scripts/generate-avatars.mjs); os JSONs gerados ficam commitados,
// então o build nunca depende deste script -- ele existe para os
// personagens terem uma fonte legível e paramétrica em vez de oito
// blocos opacos de After Effects JSON no repo.
//
// Cada personagem é UMA camada de shapes com:
//   - um "idle bob" na posição da camada (respiração, ~3s em loop);
//   - olhos que piscam animando o tamanho da elipse/retângulo (a
//     elipse encolhe em torno do próprio centro, então não precisa de
//     âncora nenhuma -- por isso o blink é no tamanho e não em escala);
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
const stroke = (color, w) => ({
  ty: "st", c: { a: 0, k: hex(color) }, o: { a: 0, k: 100 }, w: { a: 0, k: w }, lc: 2, lj: 2, nm: "stroke",
});

// Tamanho do shape: estático, ou piscando (encolhe e volta) quando
// blinkAt é passado. Keyframes lineares -- um piscar é rápido demais
// para precisar de easing.
const sizeProp = (w, h, blinkAt) => {
  if (blinkAt == null) return { a: 0, k: [w, h] };
  return {
    a: 1,
    k: [
      { t: 0, s: [w, h] },
      { t: blinkAt, s: [w, h] },
      { t: blinkAt + 6, s: [Math.max(w * 0.3, 2), Math.max(h * 0.1, 2)] },
      { t: blinkAt + 12, s: [w, h] },
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

const eye = (x, y, w, h, blinkAt, color = INK) => group("eye", [ellipse(x, y, w, h, blinkAt), fill(color)]);
const rectEye = (x, y, w, h, blinkAt, color = INK) => group("eye", [rect(x, y, w, h, 4, blinkAt), fill(color)]);

// Olho fechado feliz: um arco em ∩ (controles acima da corda).
const happyEye = (x1, x2, y, w) =>
  group("happy-eye", [
    path([{ p: [x1, y], o: [(x2 - x1) * 0.3, -8] }, { p: [x2, y], i: [-(x2 - x1) * 0.3, -8] }], false),
    stroke(INK, w),
  ]);

// Respiração da camada inteira: 3 keyframes com tangentes espaciais
// (to/ti) para uma senoide macia em vez de um vai-e-vem mecânico.
const bobKeyframes = (amp, midT) => {
  const ease = { i: { x: [0.45, 0.45], y: [1, 1] }, o: { x: [0.55, 0.55], y: [0, 0] } };
  return {
    a: 1,
    k: [
      { t: 0, s: [100, 100 + amp, 0], to: [0, -amp * 0.55, 0], ti: [0, amp * 0.55, 0], ...ease },
      { t: midT, s: [100, 100 - amp, 0], to: [0, amp * 0.55, 0], ti: [0, -amp * 0.55, 0], ...ease },
      { t: 180, s: [100, 100 + amp, 0] },
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

const chars = [
  // Blob: o clássico. Um gotinha verde-água com cara de quem entendeu
  // tudo errado -- e vai ganhar a rodada mesmo assim.
  () =>
    doc("blob", [
      group("body", [ellipse(100, 116, 116, 104), fill("#14b8a6")]),
      eye(78, 100, 14, 18, 100),
      eye(122, 100, 14, 18, 100),
      smile(82, 118, 130, 12, 6),
    ], { amp: 4, mid: 90 }),

  // Tangerina: redondinha, com folha no topo.
  () =>
    doc("tangerina", [
      group("leaf", [ellipse(126, 60, 26, 12), fill("#4ade80")], { p: [126, 60], a: [126, 60], r: -32 }),
      group("body", [ellipse(100, 120, 108, 100), fill("#fb923c")]),
      eye(82, 110, 13, 16, 40),
      eye(118, 110, 13, 16, 40),
      smile(84, 116, 134, 10, 6),
    ], { amp: 3.5, mid: 80 }),

  // Fantasma: elipse com ondulação embaixo ( três bolinhas da cor do
  // corpo furam a silhueta), olhos compridos.
  () =>
    doc("fantasma", [
      group("tail-1", [ellipse(76, 158, 30, 28), fill("#c4b5fd")]),
      group("tail-2", [ellipse(100, 164, 30, 28), fill("#c4b5fd")]),
      group("tail-3", [ellipse(124, 158, 30, 28), fill("#c4b5fd")]),
      group("body", [ellipse(100, 112, 106, 112), fill("#c4b5fd")]),
      eye(84, 100, 14, 22, 120),
      eye(116, 100, 14, 22, 120),
      group("mouth", [ellipse(100, 130, 12, 10), fill(INK)]),
    ], { amp: 5, mid: 100 }),

  // Gato: orelhas triangulares, focinho.
  () =>
    doc("gato", [
      group("ear-l", [path([{ p: [60, 92] }, { p: [72, 48] }, { p: [98, 78] }], true), fill("#f9a8d4")]),
      group("ear-r", [path([{ p: [102, 78] }, { p: [128, 48] }, { p: [140, 92] }], true), fill("#f9a8d4")]),
      group("body", [ellipse(100, 118, 104, 96), fill("#f9a8d4")]),
      eye(84, 108, 12, 14, 70),
      eye(116, 108, 12, 14, 70),
      group("nose", [path([{ p: [94, 126] }, { p: [106, 126] }, { p: [100, 134] }], true), fill(INK)]),
      smile(88, 112, 138, 7, 4),
    ], { amp: 3.5, mid: 70 }),

  // Robô: chapa metálica, olhos de vidro retangulares, antena piscando
  // luz vermelha (o "piscar" dele é a lâmpada, não os olhos).
  () =>
    doc("robo", [
      group("antenna", [path([{ p: [100, 72] }, { p: [100, 52] }], false), stroke(INK, 6)]),
      group("lamp", [ellipse(100, 46, 15, 15, 90), fill("#f87171")]),
      group("body", [rect(100, 120, 106, 98, 20), fill("#94a3b8")]),
      rectEye(83, 108, 17, 22, null),
      rectEye(117, 108, 17, 22, null),
      group("mouth", [path([{ p: [88, 136] }, { p: [112, 136] }], false), stroke(INK, 5)]),
    ], { amp: 2.5, mid: 90 }),

  // Alien: alto, olhos amendoados, duas antenas com bolinha.
  () =>
    doc("alien", [
      group("antenna-l", [path([{ p: [84, 66] }, { p: [74, 44] }], false), stroke(INK, 5)]),
      group("antenna-r", [path([{ p: [116, 66] }, { p: [126, 44] }], false), stroke(INK, 5)]),
      group("ball-l", [ellipse(72, 40, 13, 13), fill("#fbbf24")]),
      group("ball-r", [ellipse(128, 40, 13, 13), fill("#fbbf24")]),
      group("body", [ellipse(100, 118, 96, 118), fill("#4ade80")]),
      eye(81, 102, 17, 24, 130),
      eye(119, 102, 17, 24, 130),
      group("mouth", [path([{ p: [92, 138] }, { p: [108, 138] }], false), stroke(INK, 4)]),
    ], { amp: 4.5, mid: 110 }),

  // Limão: achatado, olhos fechados de tanto rir (não pisca -- já
  // vive de olhos fechados).
  () =>
    doc("limao", [
      group("body", [ellipse(100, 120, 126, 96), fill("#fde047")]),
      happyEye(70, 90, 106, 6),
      happyEye(110, 130, 106, 6),
      group("mouth", [ellipse(100, 130, 18, 13), fill(INK)]),
    ], { amp: 3, mid: 85 }),

  // Uva: ciclope roxo de um olho só, com pezinhos.
  () =>
    doc("uva", [
      group("foot-l", [ellipse(83, 172, 22, 11), fill("#7c3aed")]),
      group("foot-r", [ellipse(117, 172, 22, 11), fill("#7c3aed")]),
      group("body", [rect(100, 118, 92, 112, 28), fill("#a78bfa")]),
      eye(100, 102, 30, 30, 60),
      smile(86, 114, 136, 8, 5),
    ], { amp: 3.5, mid: 95 }),
];

const names = ["blob", "tangerina", "fantasma", "gato", "robo", "alien", "limao", "uva"];
names.forEach((name, i) => {
  const json = JSON.stringify(chars[i](), null, 1);
  writeFileSync(join(outDir, `${name}.json`), json + "\n");
  console.log(`${name}.json  ${(json.length / 1024).toFixed(1)}KB`);
});
console.log(`\n8 bonequinhos em ${outDir}`);