// Ícones da interface, vindos do lucide.
//
// Existem como módulo próprio por dois motivos: o mapeamento semântico
// (o ícone de "verificado é BadgeCheck, não um caractere ✓") fica num lugar
// só, e trocar de biblioteca nunca vira uma caça em vinte arquivos.
//
// Nada aqui é emoji. Emoji como ícone de interface rende inconsistência entre
// sistemas (cada SO desenha uma cara) e não herda a cor do texto.

import {
  BadgeCheck,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Flag,
  Lightbulb,
  Megaphone,
  Network,
  Radio,
  RefreshCw,
  Star,
  Target,
  Trophy,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

export type { LucideIcon };

/** Marca de conferido: mesmo peso visual onde quer que apareça. */
export function VerifiedIcon({ className = "size-3.5" }: { className?: string }) {
  return <BadgeCheck className={className} strokeWidth={2.5} />;
}

/** A estrela de "acompanhando" — cheia quando seguindo, vazia quando não. */
export function WatchStar({ size = 16, filled }: { size?: number; filled: boolean }) {
  return (
    <Star
      style={{ width: size, height: size }}
      strokeWidth={2}
      fill={filled ? "currentColor" : "none"}
    />
  );
}

/** O ícone de cada tipo de aviso que a pessoa pode escolher receber. */
export const NOTIFY_ICONS: Record<string, LucideIcon> = {
  weekly_digest: RefreshCw,
  records_and_divisions: Trophy,
  match_results: Radio,
};

/** Passos/resumo do resgate — o mesmo trio de ícones em toda a jornada. */
export const FLOW_ICONS = {
  players: Users,
  resgate: Target,
  rivais: Network,
  fonte: Radio,
  dica: Lightbulb,
  anuncio: Megaphone,
  alerta: TriangleAlert,
};

/** O ícone de um aviso, pela chave semântica que o hub grava (`resultado`) ou
 * pelo tipo. Antes o backend mandava emoji; agora manda chave. */
export const ANUNCIO_ICONS: Record<string, LucideIcon> = {
  resultado: Flag,
  ranking: Trophy,
  jogador: Users,
  novidade: Megaphone,
};

/** Navegação de página. */
export const PaginationIcons = { prev: ChevronLeft, next: ChevronRight };
/** O selo de vitória por desistência. */
export const DesistenciaIcon = Flag;
/** O check do passo concluído. */
export const StepCheckIcon = Check;
/** Reexport direto para quem precisa pontual. */
export { Compass, Star, Bell, RefreshCw };
