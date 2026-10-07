import { useEffect, useRef, useState } from "react";
import { openActivityStream } from "@/lib/api";
import { ACTIVITY_SEED, messageFromRun } from "@/lib/fixtures";
import { Orb } from "./ui/Orb";

type FeedItem = { at: string; verb: string; obj: string; ctx: string };

// Atividade ao vivo (poc.pen §V1 + contrato: GET /agent/activity → SSE). O feed
// começa com a projeção do design e vai recebendo os eventos `agent` do SSE.
export function ActivityFeed({ className }: { className?: string }) {
  const [items, setItems] = useState<FeedItem[]>(ACTIVITY_SEED);
  const [live, setLive] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const handle = openActivityStream(
      (event) => {
        setLive(true);
        setItems((prev) => [messageFromRun(event), ...prev].slice(0, 12));
      },
      () => setLive(false),
    );
    return () => handle.close();
  }, []);

  return (
    <section className={className ?? "card flex w-[340px] shrink-0 flex-col gap-4 bg-surface p-5"}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Orb state="researching" size={14} glow={false} />
          <h3 className="text-[15px] font-semibold text-fg">Atividade ao vivo</h3>
        </div>
        {live && <span className="caps text-success">ao vivo</span>}
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto scroll-thin">
        {items.map((item, i) => (
          <div key={`${item.at}-${item.obj}-${i}`} className="flex animate-feed-in gap-3 py-2.5">
            <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-fg-3">{item.at}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] leading-tight text-accent-light">{item.verb}</span>
              <span className="truncate text-[13px] font-medium text-fg">{item.obj}</span>
              <span className="truncate text-[11px] text-fg-3">{item.ctx}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
