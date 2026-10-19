// Provider dos dados: o estado vem do uhumarketing-api, escopado na conta da
// sessão.
//
// Por que síncrono: as telas foram escritas contra um store síncrono e mantê-lo
// evita reescrever 6 telas para provar um ponto. Aqui a UI é otimista — o
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
import { useSession } from "./session";
import type { LaunchResult, Store } from "./store";
import { StoreContextBridge } from "./storeContext";
import type {
  ActivityEvent,
  Campaign,
  Contact,
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

/** Versão que não lança: telas que funcionam sem o provider (ex.: landing). */
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
  const { logout } = useSession();

  // Estado editorial local. Sends/atividade são do servidor e não entram aqui:
  // quem manda na fila é o worker, e sobrescrever isso do navegador apagaria
  // entregas reais.
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
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
    setContacts(data.contacts ?? []);
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
        // Token expirado/revogado não é "backend fora do ar": é sessão
        // encerrada. Mandar para o login é o único desfecho honesto.
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setFatal(syncErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [applyBootstrap, reloadKey, logout]);

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
  //
  // O `setTimeout(0)` não é enfeite: `docRef` é atualizado num efeito, e quem
  // chama `saveNow()` logo depois de um `setState` (publicar fluxo → disparar)
  // veria o documento ANTERIOR. Um macrotask dá tempo do commit e dos efeitos
  // rodarem, e aí o PUT leva o que o operador acabou de editar.
  const flushNow = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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

  // O workspace faz parte do documento editorial, então salvar é o mesmo PUT —
  // mas a tela de Configurações espera a resposta, porque o número de WhatsApp
  // é pré-requisito para disparar e um "salvo" mentiroso esconderia o erro.
  const updateWorkspace = useCallback<Store["updateWorkspace"]>(
    async (patch) => {
      const base = docRef.current;
      if (!base || !base.workspace) return;
      const next = { ...base.workspace, ...patch };
      docRef.current = { ...base, workspace: next };
      setWorkspace(next);
      await flush();
    },
    [flush],
  );

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

  const importContacts = useCallback<Store["importContacts"]>(
    async (rows, tag) => {
      const failed: { line: number; reason: string }[] = [];
      let created = 0;
      for (const [i, row] of rows.entries()) {
        if (!row.consentAt.trim()) {
          failed.push({ line: i + 1, reason: "sem data de consentimento" });
          continue;
        }
        try {
          await api.createContact({
            name: row.name,
            phone: row.phone,
            email: row.email,
            city: row.city,
            tags: [tag],
            optIn: true,
            optInSource: `importação CSV · ${row.consentAt}`,
          });
          created++;
        } catch (err) {
          failed.push({
            line: i + 1,
            reason: err instanceof ApiError ? err.message : "erro ao gravar",
          });
        }
      }
      setReloadKey((k) => k + 1);
      return { created, failed };
    },
    [],
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
          // Guardas do editor: sem laço e sem aresta duplicada.
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

  // Envio de teste: quem enfileira é o servidor, com as mesmas regras de um
  // disparo. Nada é inventado na lista local — o polling traz a linha real,
  // inclusive quando ela falha.
  const testSend = useCallback<NonNullable<Store["testSend"]>>(
    async (id) => {
      const result = await api.testSend(id);
      setReloadKey((k) => k + 1);
      return result;
    },
    [],
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

  // Consulta a Meta sem webhook. Devolve o template atualizado; quem chama
  // mostra o status real em vez de "em análise" indefinido.
  const syncTemplate = useCallback<NonNullable<Store["syncTemplate"]>>(
    async (id) => {
      const tpl = await api.syncTemplate(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? tpl : t)));
      pushActivity({
        kind: "template",
        title: "Status consultado na Meta",
        detail: `${tpl.name} · ${tpl.status}`,
        refId: tpl.id,
      });
      return tpl;
    },
    [pushActivity],
  );

  const checkChannel = useCallback<NonNullable<Store["checkChannel"]>>(
    () => api.checkChannel(),
    [],
  );

  // Ativar/desativar muda o provider do bootstrap: recarrego do servidor em
  // vez de deduzir o estado na tela. Quem sabe se o canal está de pé é o
  // servidor, que acabou de falar com a Meta.
  const activateChannel = useCallback<NonNullable<Store["activateChannel"]>>(
    async (input) => {
      const state = await api.activateChannel(input);
      const data = await api.bootstrap();
      applyBootstrap(data);
      return state;
    },
    [applyBootstrap],
  );

  const deactivateChannel = useCallback<NonNullable<Store["deactivateChannel"]>>(
    async () => {
      await api.deactivateChannel();
      const data = await api.bootstrap();
      applyBootstrap(data);
    },
    [applyBootstrap],
  );

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
      updateWorkspace,
      saveNow: flushNow,
      // O usuário vem do bootstrap, que resolve a sessão no servidor.
      user: boot?.user ?? { name: "", email: "", role: "owner" },
      contacts,
      templates,
      segments,
      campaigns,
      sends,
      flows,
      activity,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      importContacts,
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
      testSend,
      logActivity: pushActivity,
      launchCampaign,
      submitTemplate,
      syncTemplate,
      checkChannel,
      activateChannel,
      deactivateChannel,
      series,
      provider: boot?.provider,
    };
  }, [
    workspace, boot, templates, segments, campaigns, sends, flows, activity,
    updateWorkspace, flushNow, createTemplate, updateTemplate, deleteTemplate, importContacts, createSegment, updateSegment,
    createCampaign, updateCampaign, createFlow, updateFlow, addNode, updateNode,
    removeNode, addEdge, removeEdge, testSend, pushActivity, launchCampaign, submitTemplate, syncTemplate,
    checkChannel, activateChannel, deactivateChannel, series,
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
    // `status` também é do servidor: é o worker que fecha a campanha quando a
    // fila drena. Sem isto, a tela ficava "em execução" para sempre depois de
    // concluída.
    return { ...c, status: s.status, metrics: s.metrics, lastRunAt: s.lastRunAt ?? c.lastRunAt };
  });
}

/* ------------------------------------------------------------------ estados */

function Booting() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg text-fg-2">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent-light" />
      <span className="text-[14px]">Conectando ao backend…</span>
      <span className="font-mono text-[11px] text-fg-3">{api.base || window.location.origin}</span>
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
            onClick={() => location.reload()}
            className="rounded-lg border border-border px-3 py-2 text-[13px] text-fg-2 transition hover:text-fg"
          >
            Recarregar a página
          </button>
        </div>
      </div>
    </div>
  );
}

/** StoreBridge publica o `Store` no contexto que as telas consomem. */
function StoreBridge({ value, children }: { value: Store; children: ReactNode }) {
  return <StoreContextBridge value={value}>{children}</StoreContextBridge>;
}
