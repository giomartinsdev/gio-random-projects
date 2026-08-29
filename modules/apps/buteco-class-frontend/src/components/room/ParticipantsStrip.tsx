import { Crown } from "lucide-react";
import { cn } from "../../lib/cn.js";

type Participant = { userId: string; userName: string };

// Row of name chips with initials -- the bare text list the old chat
// header had, made scannable. The host gets the Crown (the same
// "mestre da sala" concept both pages already speak in their hints);
// your own chip is marked so it's obvious who you are in the room.
export function ParticipantsStrip({
  participants,
  hostId,
  currentUserId,
  className,
}: {
  participants: Participant[];
  hostId: string | null;
  currentUserId?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center flex-wrap gap-1.5", className)}>
      {participants.map((p) => {
        const initials = p.userName
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("");
        const isHost = p.userId === hostId;
        const isYou = p.userId === currentUserId;
        return (
          <span
            key={p.userId}
            title={isHost ? `${p.userName} · mestre da sala` : isYou ? `${p.userName} · você` : p.userName}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.65rem] max-w-full",
              isHost
                ? "border-buteco-amber/40 bg-buteco-amber/10 text-buteco-amber"
                : "border-white/10 bg-white/5 text-buteco-cream/70",
            )}
          >
            <span aria-hidden="true" className="font-heading font-semibold">
              {initials || "?"}
            </span>
            <span className="max-w-[9rem] truncate">{p.userName}</span>
            {isHost && <Crown size={11} aria-label="mestre da sala" className="shrink-0" />}
            {isYou && <span className="text-buteco-cream/40">(você)</span>}
          </span>
        );
      })}
    </div>
  );
}