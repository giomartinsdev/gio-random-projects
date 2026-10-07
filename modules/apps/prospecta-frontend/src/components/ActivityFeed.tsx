import { feedItemFromRun } from "@/lib/activity";
import { useActivityStream } from "@/lib/useActivityStream";
import { useConfigured } from "@/lib/useConfig";
import { Orb } from "./ui/Orb";

// Atividade ao vivo (contrato: GET /agent/activity → SSE). O feed vem só dos
// eventos reais; sem configuração nem stream, mostra vazio honesto.
export function ActivityFeed({ className }: { className?: string }) {
  const cfg = useConfigured();
  const { events, live, error } = useActivityStream(cfg !== null);
  const items = events.map(feedItemFromRun);

  return (
    <section className={className ?? "card flex w-[340px] shrink-0 flex-col gap-4 bg-surface p-5"}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Orb state="researching" size={14} glow={false} />
          <h3 className="text-[15px] font-semibold text-fg">Atividade ao vivo</h3>
        </div>
        {live && <span className="caps text-success">ao vivo</span>}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
          <span className="text-[13px] text-fg-2">Nenhuma atividade</span>
          <span className="text-[12px] text-fg-3">
            {!cfg ? "Configure a API para receber runs." : error ? error : "O feed aparece quando os agentes começarem a rodar."}
          </span>
        </div>
      ) : (
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
      )}
    </section>
  );
}
