// Provider do modo Backend: a mesma interface `Store` do mock, com o estado
// vindo do uhumarketing-api.
//
// Por que síncrono: as telas foram escritas contra um store síncrono (o mock).
// Reescrever 6 telas para `async` só para trocar a origem dos dados seria
// reescrever o produto para provar um ponto. Aqui a UI continua otimista — o
// clique aplica na hora — e a persistência acontece atrás, com o documento
// editorial inteiro (PUT /state, debounced).
//
// O que NÃO é otimista, de propósito: disparo de campanha, envio de teste e
// submissão de template. Essas ações custam dinheiro e/ou reputação do número;
// elas esperam a resposta do servidor e mostram o erro real na tela.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type Bootstrap, type EditorialState } from "./api";
import type { LaunchResult, Store } from "./store";
import { StoreContextBridge } from "./storeContext";
import type {
  ActivityEvent,
  Campaign,
  Flow,
  FlowEdge,
  FlowNode,
  MetricPoint,
  Send,
  Template,
  Workspace,
} from "./types";
import { uid } from "./format";

export type SyncStatus = "idle" | "saving" | "saved" | "error";

interface BackendContextValue {
  status: SyncStatus;
  error: string | null;
  provider: Bootstrap["provider"] | null;
  queue: Bootstrap["queue"];
  retry: () => void;
}

const BackendContext = createContext<BackendContextValue | null>(null);

export function useBackend(): BackendContextValue {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend precisa estar dentro de <BackendStoreProvider>");
  return ctx;
}

/** Versão que não lança: telas compartilhadas pelos dois modos usam esta. */
export function useBackendOptional(): BackendContextValue | null {
  return useContext(BackendContext);
}

/** Erro de API no formato que as telas já sabem mostrar. */
export function syncErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    return err.field ? `${err.field}: ${err.message}` : err.message;
  }
  return "Falha ao sincronizar com o backend.";
}

/* ---------------------------------------------------------------- provider */

export function BackendStoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Estado editorial local. Sends/atividade são do servidor e não entram aqui:
  // quem manda na fila é o worker, e sobrescrever isso do navegador apagaria
  // entregas reais.
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [segments, setSegments] = useState<Store["segments"]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [sends, setSends] = useState<Send[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  // O documento editorial mais recente, lido pelo flush.
  //
  // Sem este ref, o `flush` debounced fecharia sobre o estado do render em que
  // foi criado: criar uma campanha agenda o PUT, mas o timer dispara com a
  // lista ANTERIOR — o servidor recebe o documento sem a campanha nova e o
  // `deleteMissing` a apaga logo depois de criada. Era exatamente esse o bug.
  const docRef = useRef<EditorialState | null>(null);
  useEffect(() => {
    if (!workspace) return;
    docRef.current = { workspace, templates, segments, campaigns, flows };
  }, [workspace, templates, segments, campaigns, flows]);

  const applyBootstrap = useCallback((data: Bootstrap) => {
    setBoot(data);
    setWorkspace(data.workspace);
    setTemplates(data.templates);
    setSegments(data.segments);
    setCampaigns(data.campaigns);
    setFlows(data.flows);
    setSends(data.sends);
    setActivity(data.activity);
  }, []);

  useEffect(() => {
    let alive = true;
    setFatal(null);
    api
      .bootstrap()
      .then((data) => {
        if (!alive) return;
        applyBootstrap(data);
        setStatus("saved");
      })
      .catch((err) => {
        if (!alive) return;
        setFatal(syncErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [applyBootstrap, reloadKey]);

  // Sincronização: um PUT com o documento editorial inteiro, 450 ms depois da
  // última edição. Curto o bastante para o operador confiar, longo o bastante
  // para arrastar um nó no canvas não virar 60 requisições.
  const flush = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;
    setStatus("saving");
    try {
      const data = await api.putState(doc);
      // O servidor devolve o estado mesclado (status de template, métricas de
      // campanha, fila). Adotamos só o que ele é dono; o editorial local
      // permanece, para não pular o cursor de quem está digitando.
      setTemplates((prev) => mergeServerFields(prev, data.templates));
      setCampaigns((prev) => mergeCampaignMetrics(prev, data.campaigns));
      setSegments(data.segments);
      setSends(data.sends);
      setActivity((prev) => mergeActivity(prev, data.activity));
      setStatus("saved");
      setError(null);
      dirty.current = false;
    } catch (err) {
      setStatus("error");
      setError(syncErrorMessage(err));
    }
  }, []);

  // flushNow cancela o debounce e espera o PUT terminar. É o que a submissão
  // de template precisa: o rascunho tem que existir no servidor antes do POST
  // /submit, senão a Meta recebe um id que o banco ainda não conhece.
  const flushNow = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    await flush();
  }, [flush]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flush();
    }, 450);
  }, [flush]);

  // Polling leve para o que o servidor muda sozinho: fila andando, webhook
  // marcando entrega/leitura. Sem isso, o operador dispara uma campanha e olha
  // para uma tela congelada.
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (dirty.current) return;
      try {
        const data = await api.bootstrap();
        setSends(data.sends);
        setActivity((prev) => mergeActivity(prev, data.activity));
        setCampaigns((prev) => mergeCampaignMetrics(prev, data.campaigns));
        setSegments(data.segments);
        setTemplates((prev) => mergeServerFields(prev, data.templates));
        setBoot((prev) =>
          prev ? { ...prev, provider: data.provider, queue: data.queue } : data,
        );
      } catch {
        // Silencioso: o próximo tick tenta de novo. Erro de polling não deve
        // piscar na tela de quem só está lendo o dashboard.
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const pushActivity = useCallback((e: Omit<ActivityEvent, "id" | "at">) => {
    setActivity((prev) => [{ ...e, id: uid("act"), at: new Date().toISOString() }, ...prev].slice(0, 60));
  }, []);

  /* ------------------------------------------------------------- mutações */

  const createTemplate = useCallback<Store["createTemplate"]>(
    (input) => {
      const t: Template = {
        ...input,
        id: uid("tpl"),
        metaId: "—",
        quality: 0,
        metrics: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setTemplates((prev) => [t, ...prev]);
      schedule();

      // "Enviar para análise" no editor: grava o rascunho e só então submete.
      // O id é gerado no cliente e aceito pelo PUT, então o servidor conhece
      // exatamente este template quando a submissão chega.
      if (input.status === "pending") {
        queueMicrotask(async () => {
          try {
            await flushNow();
            const submitted = await api.submitTemplate(t.id);
            setTemplates((prev) => prev.map((x) => (x.id === submitted.id ? submitted : x)));
            setActivity((prev) => [
              {
                id: uid("act"),
                at: new Date().toISOString(),
                kind: "template",
                title: "Template enviado para a Meta",
                detail: `${submitted.name} · ${submitted.status}`,
                refId: submitted.id,
              },
              ...prev,
            ]);
            setStatus("saved");
          } catch (err) {
            setStatus("error");
            setError(syncErrorMessage(err));
          }
        });
      }
      return t;
    },
    [schedule, flushNow],
  );

  const updateTemplate = useCallback<Store["updateTemplate"]>(
    (id, patch) => {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                // Conteúdo mudou → rascunho. A mesma regra do servidor, aplicada
                // aqui para a tela não mostrar "aprovado" por 450 ms.
                status: patch.body !== undefined || patch.header !== undefined ? "draft" : t.status,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      schedule();
    },
    [schedule],
  );

  const deleteTemplate = useCallback<Store["deleteTemplate"]>(
    (id) => {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      schedule();
    },
    [schedule],
  );

  const createSegment = useCallback<Store["createSegment"]>(
    (input) => {
      const s: Store["segments"][number] = {
        ...input,
        id: uid("seg"),
        contactsCount: input.contactsCount ?? 0,
        sample: [],
        updatedAt: new Date().toISOString(),
      };
      setSegments((prev) => [s, ...prev]);
      schedule();
      return s;
    },
    [schedule],
  );

  const updateSegment = useCallback<Store["updateSegment"]>(
    (id, patch) => {
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s)),
      );
      schedule();
    },
    [schedule],
  );

  const createCampaign = useCallback<Store["createCampaign"]>(
    (input) => {
      const c: Campaign = {
        ...input,
        id: uid("cmp"),
        metrics: {
          audience: 0, queued: 0, sent: 0, delivered: 0, read: 0,
          replied: 0, converted: 0, failed: 0, optOut: 0, revenue: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setCampaigns((prev) => [c, ...prev]);
      schedule();
      return c;
    },
    [schedule],
  );

  const updateCampaign = useCallback<Store["updateCampaign"]>(
    (id, patch) => {
      setCampaigns((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)),
      );
      schedule();
    },
    [schedule],
  );

  const createFlow = useCallback<Store["createFlow"]>(
    (input) => {
      const f: Flow = {
        ...input,
        id: uid("flow"),
        runs: { total: 0, success: 0, failed: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setFlows((prev) => [f, ...prev]);
      schedule();
      return f;
    },
    [schedule],
  );

  const updateFlow = useCallback<Store["updateFlow"]>(
    (id, patch) => {
      setFlows((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: new Date().toISOString() } : f)),
      );
      schedule();
    },
    [schedule],
  );

  const addNode = useCallback<Store["addNode"]>(
    (flowId, node: FlowNode) => {
      setFlows((prev) =>
        prev.map((f) => (f.id === flowId ? { ...f, nodes: [...f.nodes, node], updatedAt: new Date().toISOString() } : f)),
      );
      schedule();
    },
    [schedule],
  );

  const updateNode = useCallback<Store["updateNode"]>(
    (flowId, nodeId, patch) => {
      setFlows((prev) =>
        prev.map((f) =>
          f.id === flowId
            ? {
                ...f,
                nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
                updatedAt: new Date().toISOString(),
              }
            : f,
        ),
      );
      schedule();
    },
    [schedule],
  );

  const removeNode = useCallback<Store["removeNode"]>(
    (flowId, nodeId) => {
      setFlows((prev) =>
        prev.map((f) =>
          f.id === flowId
            ? {
                ...f,
                nodes: f.nodes.filter((n) => n.id !== nodeId),
                edges: f.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
                updatedAt: new Date().toISOString(),
              }
            : f,
        ),
      );
      schedule();
    },
    [schedule],
  );

  const addEdge = useCallback<Store["addEdge"]>(
    (flowId, edge: Omit<FlowEdge, "id">) => {
      setFlows((prev) =>
        prev.map((f) => {
          if (f.id !== flowId) return f;
          // Mesmas guardas do mock: sem laço e sem aresta duplicada.
          if (edge.from === edge.to) return f;
          if (f.edges.some((e) => e.from === edge.from && e.to === edge.to)) return f;
          return { ...f, edges: [...f.edges, { ...edge, id: uid("e") }], updatedAt: new Date().toISOString() };
        }),
      );
      schedule();
    },
    [schedule],
  );

  const removeEdge = useCallback<Store["removeEdge"]>(
    (flowId, edgeId) => {
      setFlows((prev) =>
        prev.map((f) =>
          f.id === flowId
            ? { ...f, edges: f.edges.filter((e) => e.id !== edgeId), updatedAt: new Date().toISOString() }
            : f,
        ),
      );
      schedule();
    },
    [schedule],
  );

  // Envio manual da tela de campanhas: no modo real, quem enfileira é o
  // servidor. A tela otimista mostra a linha; o polling traz o status real
  // (que pode ser "failed", e aí a linha muda de cor).
  const enqueueSend = useCallback<Store["enqueueSend"]>(
    (input) => {
      const s: Send = { ...input, id: uid("snd"), at: new Date().toISOString(), cost: 0.0625 };
      setSends((prev) => [s, ...prev]);
      if (input.campaignId) {
        api
          .testSend(input.campaignId)
          .then(() => flush())
          .catch((err) => {
            setStatus("error");
            setError(syncErrorMessage(err));
          });
      }
      return s;
    },
    [flush],
  );

  // Disparo real. Este é o único caminho em que a tela ESPERA o servidor: se o
  // template não está aprovado ou o telefone não está configurado, o erro tem
  // que aparecer — não dá para "otimisticamente" enviar mensagem no WhatsApp de
  // alguém. Depois do launch, o polling (5 s) traz a fila andando.
  const launchCampaign = useCallback<NonNullable<Store["launchCampaign"]>>(
    async (id) => {
      const result = await api.launchCampaign(id);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, status: "running", lastRunAt: new Date().toISOString() }
            : c,
        ),
      );
      pushActivity({
        kind: "campaign",
        title: "Campanha disparada",
        detail: `${result.queued} na fila · ${result.skipped} ignorados por falta de opt-in`,
        refId: id,
      });
      return result as LaunchResult;
    },
    [pushActivity],
  );

  // Submissão a partir do drawer do template (rascunho/rejeitado). Mesma regra
  // do editor: garante que o rascunho está no banco e só então chama a Meta.
  const submitTemplate = useCallback<NonNullable<Store["submitTemplate"]>>(
    async (id) => {
      await flushNow();
      const submitted = await api.submitTemplate(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? submitted : t)));
      pushActivity({
        kind: "template",
        title: "Template enviado para a Meta",
        detail: `${submitted.name} · ${submitted.status}`,
        refId: submitted.id,
      });
      return submitted;
    },
    [flushNow, pushActivity],
  );

  const reset = useCallback(() => {
    setStatus("saving");
    api
      .resetDemo()
      .then(() => api.bootstrap())
      .then((data) => {
        applyBootstrap(data);
        setStatus("saved");
        setError(null);
      })
      .catch((err) => {
        setStatus("error");
        setError(syncErrorMessage(err));
      });
  }, [applyBootstrap]);

  // Série diária calculada no SQL (todos os envios, não a página de 120).
  // O corte de dias é feito aqui porque o bootstrap manda uma janela fixa.
  const series = useCallback(
    (days: number): MetricPoint[] => (boot?.series ?? []).slice(-days),
    [boot],
  );

  const value = useMemo<Store | null>(() => {
    if (!workspace) return null;
    return {
      workspace,
      // O usuário é a sessão da POC; o backend não tem multi-tenant ainda.
      user: boot?.user ?? { name: "Marina Reis", email: "marina@cafeaurora.com.br", role: "Head de Growth" },
      templates,
      segments,
      campaigns,
      sends,
      flows,
      activity,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      createSegment,
      updateSegment,
      createCampaign,
      updateCampaign,
      createFlow,
      updateFlow,
      addNode,
      updateNode,
      removeNode,
      addEdge,
      removeEdge,
      enqueueSend,
      logActivity: pushActivity,
      reset,
      launchCampaign,
      submitTemplate,
      series,
    };
  }, [
    workspace, boot, templates, segments, campaigns, sends, flows, activity,
    createTemplate, updateTemplate, deleteTemplate, createSegment, updateSegment,
    createCampaign, updateCampaign, createFlow, updateFlow, addNode, updateNode,
    removeNode, addEdge, removeEdge, enqueueSend, pushActivity, reset, launchCampaign, submitTemplate, series,
  ]);

  return (
    <BackendContext.Provider
      value={{
        status,
        error,
        provider: boot?.provider ?? null,
        queue: boot?.queue ?? [],
        retry: () => setReloadKey((k) => k + 1),
      }}
    >
      {fatal ? (
        <BackendDown message={fatal} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : value ? (
        <StoreBridge value={value}>{children}</StoreBridge>
      ) : (
        <Booting />
      )}
    </BackendContext.Provider>
  );
}

/* ---------------------------------------------------------------- auxiliares */

/**
 * Mescla os campos que o servidor é dono num template local. O corpo local
 * vence enquanto o PUT não volta — senão o cursor pularia no meio da digitação.
 */
function mergeServerFields(local: Template[], server: Template[]): Template[] {
  const byId = new Map(server.map((t) => [t.id, t]));
  return local.map((t) => {
    const s = byId.get(t.id);
    if (!s) return t;
    return {
      ...t,
      status: s.status,
      metaId: s.metaId,
      quality: s.quality,
      metrics: s.metrics,
      rejectionReason: s.rejectionReason,
    };
  });
}

/**
 * Une a atividade do servidor com a que o cliente acabou de registrar.
 *
 * O log é auditável e vive no banco, mas uma ação feita agora (publicar fluxo,
 * disparar) entra na hora na tela. Substituir a lista inteira pelo polling
 * fazia esse registro piscar e desaparecer em 5 s — pior que não mostrar.
 * Entradas locais ficam no máximo 2 minutos, até o servidor alcançá-las.
 */
function mergeActivity(local: ActivityEvent[], server: ActivityEvent[]): ActivityEvent[] {
  const seen = new Set(server.map((e) => e.id));
  const cutoff = Date.now() - 120_000;
  const recent = local.filter(
    (e) => !seen.has(e.id) && new Date(e.at).getTime() >= cutoff,
  );
  return [...recent, ...server]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 60);
}

/** Métricas de campanha vêm de `sends`; o editorial local fica como está. */
function mergeCampaignMetrics(local: Campaign[], server: Campaign[]): Campaign[] {
  const byId = new Map(server.map((c) => [c.id, c]));
  return local.map((c) => {
    const s = byId.get(c.id);
    if (!s) return c;
    return { ...c, metrics: s.metrics, lastRunAt: s.lastRunAt ?? c.lastRunAt };
  });
}

/* ------------------------------------------------------------------ estados */

function Booting() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg text-fg-2">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-light" />
      <span className="text-[14px]">Conectando ao backend…</span>
      <span className="font-mono text-[11px] text-fg-3">{api.base}</span>
    </div>
  );
}

function BackendDown({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[520px] rounded-xl border border-danger/30 bg-surface p-6">
        <h1 className="text-[17px] font-semibold text-fg">Backend não respondeu</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">{message}</p>
        <div className="mt-4 rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg-3">
          <div>cd modules/apps/uhumarketing-api</div>
          <div>docker compose up -d</div>
          <div>npm run dev --prefix ../uhumarketing-frontend</div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onRetry}
            className="rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-fg transition hover:bg-accent/90"
          >
            Tentar de novo
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("uhumarketing:data-source");
              location.reload();
            }}
            className="rounded-lg border border-border px-3 py-2 text-[13px] text-fg-2 transition hover:text-fg"
          >
            Voltar para o modo Demo
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * StoreBridge publica o `Store` no mesmo contexto que o mock usa — as telas não
 * sabem qual dos dois está ativo.
 */
function StoreBridge({ value, children }: { value: Store; children: ReactNode }) {
  return <StoreContextBridge value={value}>{children}</StoreContextBridge>;
}
