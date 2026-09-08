import alien from "@/assets/avatars/alien.json";
import blob from "@/assets/avatars/blob.json";
import fantasma from "@/assets/avatars/fantasma.json";
import gato from "@/assets/avatars/gato.json";
import limao from "@/assets/avatars/limao.json";
import robo from "@/assets/avatars/robo.json";
import tangerina from "@/assets/avatars/tangerina.json";
import uva from "@/assets/avatars/uva.json";
import estrela from "@/assets/avatars/estrela.json";
import coracao from "@/assets/avatars/coracao.json";
import nuvem from "@/assets/avatars/nuvem.json";
import raposa from "@/assets/avatars/raposa.json";
import urso from "@/assets/avatars/urso.json";
import abelha from "@/assets/avatars/abelha.json";
import dado from "@/assets/avatars/dado.json";
import pau from "@/assets/avatars/pau.json";
import saco from "@/assets/avatars/saco.json";
import bunda from "@/assets/avatars/bunda.json";

// O elenco de bonequinhos. O servidor sorteia um índice por pessoa
// (state.players[].avatar, submissions[].avatar) -- fixo por pessoa
// enquanto a sala viver (ver o Go side's nextAvatarLocked, que sorteia
// em vez de dar sempre os primeiros da lista) -- e o cliente só
// escolhe o personagem aqui. Com mais gente que personagens o índice
// dá a volta (dois jogadores compartilham um bonequinho), o que numa
// mesa de festa de 15+ é raridade aceitável; o nome continua
// diferenciando. A ORDEM IMPORTA: precisa bater com avatarRosterSize e
// a ordem de `names` em scripts/generate-avatars.mjs.
export const AVATARS = [
  blob, tangerina, fantasma, gato, robo, alien, limao, uva,
  estrela, coracao, nuvem, raposa, urso, abelha, dado,
  pau, saco, bunda,
] as const;

export const AVATAR_NAMES = [
  "Blob", "Tangerina", "Fantasma", "Gato", "Robô", "Alien", "Limão", "Uva",
  "Estrela", "Coração", "Nuvem", "Raposa", "Urso", "Abelha", "Dado",
  "Pau", "Saco", "Bunda",
] as const;

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