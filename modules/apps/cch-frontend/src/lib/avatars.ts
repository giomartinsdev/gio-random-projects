import alien from "@/assets/avatars/alien.json";
import blob from "@/assets/avatars/blob.json";
import fantasma from "@/assets/avatars/fantasma.json";
import gato from "@/assets/avatars/gato.json";
import limao from "@/assets/avatars/limao.json";
import robo from "@/assets/avatars/robo.json";
import tangerina from "@/assets/avatars/tangerina.json";
import uva from "@/assets/avatars/uva.json";

// O elenco de bonequinhos. O servidor manda um índice por pessoa
// (state.players[].avatar, submissions[].avatar) -- fixo por pessoa
// enquanto a sala viver -- e o cliente escolhe o personagem aqui.
// Com mais gente que personagens o índice dá a volta (dois jogadores
// compartilham um bonequinho), o que numa mesa de festa é raridade
// aceitável; o nome continua diferenciando.
export const AVATARS = [blob, tangerina, fantasma, gato, robo, alien, limao, uva] as const;

export const AVATAR_NAMES = ["Blob", "Tangerina", "Fantasma", "Gato", "Robô", "Alien", "Limão", "Uva"] as const;

// Índice sempre válido mesmo se o servidor mandar algo fora da faixa
// (roster encurtado no futuro, índice velho num estado em transição).
export function avatarAt(index: number) {
  const n = AVATARS.length;
  return AVATARS[((index % n) + n) % n];
}

export function avatarName(index: number) {
  const n = AVATAR_NAMES.length;
  return AVATAR_NAMES[((index % n) + n) % n];
}