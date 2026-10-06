import { useCallback, useEffect, useMemo, useState } from "react";
import { Database } from "lucide-react";
import { api, type OFRawRecord } from "@/lib/api";
import { Card, Cockpit, Empty } from "@/components/primitives";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

// Dados brutos: o JSON cru de cada recurso que o provedor entregou. É a prova
// de que nada se perdeu — mesmo um recurso que ainda não tem tela normalizada
// aparece aqui, e pode ser reprocessado quando a normalização existir.
export function RawDataPage() {
  const [records, setRecords] = useState<OFRawRecord[]>([]);
  const [resource, setResource] = useState("");
  const [selected, setSelected] = useState<OFRawRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.ofRaw();
      setRecords(r.records ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 60);

  const resources = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.resource, (m.get(r.resource) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [records]);

  const visible = resource ? records.filter((r) => r.resource === resource) : records;

  const left = (
    <Card>
      <p className="kick mb-1">{records.length} registros crus</p>
      <p className="kick">Recursos capturados</p>
      <ul className="mt-2">
        {resources.length === 0 && <li className="text-[11px] dim">nada ainda</li>}
        {resources.map(([res, n]) => (
          <li key={res}>
            <button
              onClick={() => setResource(resource === res ? "" : res)}
              className={`flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[11.5px] ${resource === res ? "bg-accent/15 text-accent" : "text-fg hover:bg-surface-2"}`}
            >
              <span className="truncate">{res}</span>
              <span className="mono text-[10px] dim">{n}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );

  const center = (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card title="Registros" right={<Database className="size-3.5 text-fg-dim" />}>
        {visible.length === 0 && !loading ? (
          <Empty text="Nenhum dado cru capturado ainda. O conector grava no próximo sync." />
        ) : (
          <ul>
            {visible.slice(0, 200).map((r) => (
              <li key={r.id}>
                <button onClick={() => setSelected(r)} className="row w-full px-1 text-left">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-fg">{r.external_id}</span>
                    <span className="block text-[10.5px] dim">{r.resource} · {new Date(r.captured_at).toLocaleString("pt-BR")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  const right = (
    <Card title="JSON">
      {!selected ? (
        <Empty text="Selecione um registro." />
      ) : (
        <pre className="max-h-[70vh] overflow-auto scroll-thin whitespace-pre-wrap break-all rounded-[8px] bg-surface-2 p-3 text-[10.5px] leading-[1.5] mono">
          {pretty(selected.payload)}
        </pre>
      )}
    </Card>
  );

  return <Cockpit left={left} center={center} right={right} />;
}

function pretty(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
