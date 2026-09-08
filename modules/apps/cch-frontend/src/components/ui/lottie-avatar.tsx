import { Lottie } from "@/components/ui/lottie";
import { avatarAt, avatarName } from "@/lib/avatars";

// O bonequinho de alguém -- o mesmo personagem acompanha a pessoa no
// placar, na fila de jogadas e do lado da carta que ela pôs na mesa
// (o bonequinho é a assinatura de autoria na mesa, então o mesmo
// índice precisa renderizar o mesmo bicho em todo lugar). `stand` põe
// uma sombrinha embaixo, para os que ficam de pé sobre uma carta.
export function Avatar({
  index,
  size = 24,
  className,
  labeled,
}: {
  index: number;
  size?: number;
  className?: string;
  labeled?: boolean;
}) {
  return (
    <Lottie
      animationData={avatarAt(index)}
      size={size}
      className={className}
      title={labeled ? `Bonequinho ${avatarName(index)}` : undefined}
    />
  );
}