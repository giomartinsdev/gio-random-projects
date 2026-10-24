# Arquitetura

Visão **do que roda hoje**. Cada diagrama foi conferido contra o cluster vivo
(`kubectl get pods -A`) e contra `k8s/apps/`. Quando divergir, o código manda —
e se o código também divergir do cluster, o cluster é o bug.

- **Cluster**: k3s, um nó, arm64. Toda a carga em Kubernetes.
- **Apps** (o que é construído): `apps/*` → imagens no registry.
- **Manifests** (o que é reconciliado): `k8s/apps/<namespace>/<serviço>/`.
- **Infra de nuvem**: `infra/terraform` — Cloudflare (DNS, Access, mTLS) e
  baseline do host (firewall, pacotes).
- **Contrato compartilhado**: `packages/finance-contracts` (envelope + eventos,
  importado por `finance-api` e pelo worker, nunca copiado).

---

## 1. Visão geral

Um VPS (arm64) roda um cluster k3s de um nó. O **Cloudflare** fica na frente
de tudo (DNS + Access + TLS de borda). O tráfego entra pelo **ingress-nginx**
(`IngressClass nic`, `hostNetwork`, dono da :80/:443) e vai por hostname para
o Service certo. Um registro de container não existe mais: Docker zerado.

```mermaid
flowchart TB
  net((Internet))
  cf[["Cloudflare<br/>DNS + Access + TLS"]]
  net --> cf

  subgraph VPS["VPS (arm64) · k3s single-node"]
    direction TB
    nic["ingress-nginx (class nic)<br/>hostNetwork :80/:443"]

    subgraph applications["ns applications"]
      dapi["domain-api"]
      dworker["domain-worker"]
      fapi["finance-api"]
      fwk["finance-customersupport-worker"]
      telaapi["tela-api + mediamtx + coturn"]
      ninerouter["9router"]
      evolution["evolution-api"]
      draw["excalidraw"]
    end

    subgraph persistence["ns persistence"]
      pg[("postgres")]
      rmq[("rabbitmq")]
      minio[("minio")]
      vw["vaultwarden"]
      eredis[("evolution-redis")]
    end

    subgraph obs["ns observability"]
      graf["grafana"]
      loki["loki / tempo / prometheus"]
      alloy["alloy (OTLP)"]
    end

    subgraph support["ns support"]
      registry["registry"]
      dbmcp["db-mcp + gateway"]
      adminer["adminer"]
    end

    argocd["ns argocd<br/>ArgoCD (argo.giomartins.dev)"]
    rancher["ns cattle-system<br/>Rancher"]
    kubero["ns kubero<br/>Kubero"]

    nic -.proxy por hostname.-> dapi
    nic -.-> fapi
    nic -.-> evolution
    nic -.-> graf
    nic -.-> argocd
    nic -.-> rancher
  end

  cf --> nic
  registry -->|pull| applications
  argocd -.reconcilia.-> applications
  argocd -.-> persistence
  argocd -.-> obs
  argocd -.-> support
```

> **Frontends não são containers.** `tela-frontend`, `hub-frontend` e
> `finance-frontend` são builds estáticos espelhados em buckets do MinIO; o
> ingress serve o bucket direto.

> **`nic` é o único ingress.** Traefik e servicelb estão desabilitados no k3s
> (`--disable traefik --disable servicelb`) — dois controllers na :80 brigam.

---

## 2. Como o deploy chega ao cluster

Ninguém faz `kubectl apply` de workload. O caminho é git → imagem → digest →
ArgoCD.

```mermaid
flowchart LR
  push["push em main<br/>(muda apps/&lt;app&gt;/**)"]
  push --> discover["discover<br/>(só os apps afetados)"]
  discover --> build["build + test<br/>arm64 via QEMU"]
  build --> reg[("registry.giomartins.dev<br/>:sha-&lt;commit&gt;")]
  reg --> bump["commit do digest<br/>em k8s/apps/&lt;ns&gt;/&lt;app&gt;/"]
  bump --> argo["ArgoCD detecta o commit"]
  argo --> sync["kubectl apply (server-side)<br/>pelo sync loop"]
  sync --> verify["Synced + Healthy"]
```

O ApplicationSet (`k8s/bootstrap/appset.yaml`) varre `k8s/apps/<ns>/*` e cria
uma Application por diretório. **O basename do diretório é o nome da
Application** — renomear pasta apaga a Application e pruna os recursos,
inclusive PVC.

O manifesto fixa **digest**, não tag. Tag `latest` num manifesto GitOps
significa "o cluster deriva sozinho quando alguém publica".

---

## 3. O contexto financeiro — fluxo WhatsApp

O usuário fala por WhatsApp; o `finance-customersupport-worker` é o
**encarregado do atendimento**. A `finance-api` é a **ACL** (sem banco, sem
broker): valida e repassa. O `domain-api` é o front door do CQRS; o
`domain-worker` é o **único escritor** do banco.

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário (WhatsApp)
  participant EV as Evolution API<br/>(applications)
  participant W as finance-customersupport-worker
  participant F as finance-api (ACL)
  participant DA as domain-api
  participant RMQ as RabbitMQ<br/>(persistence)
  participant DW as domain-worker
  participant PG as Postgres<br/>(persistence)

  U->>EV: mensagem de texto
  EV->>RMQ: exchange evolution<br/>routing evolution.messages.upsert
  RMQ->>W: consome evolution.messages.upsert
  Note over W: NLU por regras → intent

  alt escrita (finance.*)
    W->>F: POST /commands {action, payload}
    F->>DA: POST /commands (envelope, 202)
    DA->>RMQ: publica em domain.commands
    RMQ->>DW: consome domain.commands.queue
    DW->>PG: aplica (idempotente) + audit_log
    DW->>RMQ: publica evento (outbox durável)
    F-->>W: 202 accepted
    W-->>EV: sendText (resposta imediata)
  else leitura (finance.query.*)
    W->>F: POST /queries {action, payload}
    F->>DA: GET /finance/*
    DA->>PG: projeção (read-only)
    F-->>W: projeção JSON
    W-->>EV: sendText ou sendMedia (card/PNG)
  end

  RMQ->>W: consome domain.events
  Note over W: confirmação do próprio comando<br/>é suprimida (dedup)
  W-->>EV: sendText (aviso proativo)
  EV-->>U: resposta no WhatsApp
```

**Regra de isolamento (§1.1):** nem a `finance-api` nem o worker têm
`DATABASE_URL`, driver de banco ou publicador de comando. Só o `domain` toca o
banco. O worker **consome** broker e **fala HTTP** com a ACL.

### Superfícies da ACL

```mermaid
flowchart LR
  W["finance-customersupport-worker"]
  subgraph ACL["finance-api (sem banco/broker)"]
    c["POST /commands<br/>→ /commands do domain-api (202)"]
    cs["POST /commands/sync<br/>→ /sync (200/422/504)"]
    q["POST /queries<br/>→ GET /finance/*"]
  end
  W -->|escrita| c
  W -->|escrita confirmada| cs
  W -->|leitura| q
```

---

## 4. CQRS — broker e persistência

O `domain-api` publica comando; o `domain-worker` é o único escritor e publica
eventos via **outbox durável** (o evento é gravado como pendente antes do
publish; um relay reenvia o que ficou, at-least-once).

```mermaid
flowchart TB
  dapi["domain-api<br/>GETs + POST /commands + POST /sync"]

  subgraph rabbit["RabbitMQ (persistence)"]
    ex_cmd{{"exchange domain.commands<br/>(direct)"}}
    q_cmd["domain.commands.queue"]
    ex_ev{{"exchange domain.events<br/>(fanout)"}}
  end

  dworker["domain-worker<br/>(único escritor)"]
  outbox[("outbox<br/>pending → published")]
  pg[("Postgres · db domain")]
  consumers["consumidores de eventos"]

  dapi -->|publish comando| ex_cmd
  ex_cmd --> q_cmd
  q_cmd --> dworker
  dworker -->|aplica| pg
  dworker -->|grava pendente| outbox
  outbox -->|relay publica| ex_ev
  ex_ev --> consumers
```

---

## 5. Observabilidade

Todo app emite traces/métricas OTLP para o **alloy** (`:4318`, público em
`otel.giomartins.dev`); o stdout dos pods vai para o **loki**. Dashboards no
**grafana** (`grafana.giomartins.dev`, atrás de Access + login). `domain-api` e
o worker usam `OTEL_SERVICE_NAME` por serviço.

Estado (`loki-data`, `prometheus-data`, `grafana-data`, `tempo-data`,
`alloy-state`) mora em PVCs no namespace `observability`.

---

## 6. Ingress — o que decide o roteamento

Todo roteamento público é `Ingress` nativo (`networking.k8s.io/v1`) com
annotations `nginx.org/*`. O padrão e as armadilhas medidas estão em
[`../k8s/README.md`](../k8s/README.md) e nos comentários de
`k8s/apps/persistence/routes-persistence/ingress.yaml`.

Três regras que custam caro:

1. **`nginx.org/websocket-services` em request sem `Upgrade` manda
   `Connection: close`.** Já quebrou o 9router (abortava body de ~480 KB).
2. **O upstream gerado inclui o nome do Ingress.** Renomear o Ingress quebra
   snippets em silêncio — o reload falha e mantém a config anterior.
3. **O NIC não emite `proxy_http_version 1.1`** em Ingress nativo; vai por
   snippet em todos.

---

## Referências

- [`../k8s/README.md`](../k8s/README.md) — operação do cluster e armadilhas
- [`../apps/README.md`](../apps/README.md) — catálogo de apps
- [`finance-system-spec.md`](finance-system-spec.md) — spec do contexto financeiro
- [`novo-app-ci-cd.md`](novo-app-ci-cd.md) — criar app nova
- [`../apps/domain-api/README.md`](../apps/domain-api/README.md) — contrato de escrita/leitura
- [`../apps/finance-api/README.md`](../apps/finance-api/README.md) — a ACL
