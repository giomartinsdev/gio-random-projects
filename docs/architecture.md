# Arquitetura

Visão da arquitetura **de hoje** neste repositório: apps, comunicação e
deploy. Cada diagrama abaixo foi conferido contra o código e os arquivos
`stacks/*.yml` — quando divergir, o código manda.

- **Stacks** (o que roda no host): `stacks/*.yml`, gerenciadas pelo Docker
  Compose via **Dockhand** (git-backed).
- **Apps** (o que é construído): `modules/apps/*`.
- **Contrato compartilhado**: `packages/finance-contracts` (envelope + eventos
  do contexto financeiro; importado por `finance-api` e pelo worker, nunca
  copiado).

---

## 1. Visão geral do host

Uma VPS (arm64) roda tudo em Docker Compose, na rede externa **`apps`**. O
**ingress** (nginx, no stack `core`) é a única porta 80/443; ele roteia por
hostname para cada serviço. Cloudflare fica na frente (DNS + Access).

```mermaid
flowchart TB
  net((Internet))
  cf[["Cloudflare<br/>DNS + Access + Tunnel"]]
  net --> cf

  subgraph VPS["VPS (arm64) · rede docker externa: apps"]
    direction TB
    ingress["ingress (nginx:80)<br/>stack core"]

    subgraph core["stack core (boot, protegida)"]
      registry["registry:5000"]
      dockhand["dockhand<br/>deploy de stacks git"]
      ingress
    end

    subgraph persistence["stack persistence"]
      pg[("postgres:17<br/>db domain")]
      rmq[("rabbitmq:4")]
      minio[("minio<br/>buckets de frontend")]
    end

    subgraph compute["stack compute"]
      vault["vaultwarden"]
      evolution["evolution-api<br/>(gateway WhatsApp)"]
    end

    subgraph observability["stack observability"]
      graf["grafana"]
      loki["loki / tempo / prometheus"]
      alloy["alloy (OTLP)"]
    end

    subgraph domain["stack domain"]
      dapi["domain-api"]
      dworker["domain-worker"]
    end

    subgraph finance["stack finance"]
      fapi["finance-api"]
      fwk["finance-customersupport-worker"]
    end

    subgraph clubs["stack clubs"]
      clubsapi["clubs-api"]
      clubsing["clubs-ingest"]
    end

    subgraph tela["stack tela"]
      telaapi["tela-api"]
    end

    ingress -.proxy por hostname.-> dapi
    ingress -.-> fapi
    ingress -.-> evolution
    ingress -.-> clubsapi
    ingress -.-> telaapi
    ingress -.-> graf
  end

  cf --> ingress
  registry -->|pull :latest| finance
  dockhand -.webhook de deploy.-> finance
```

> **Frontends não são containers.** `tela-frontend`, `clubs-frontend`,
> `hub-frontend` e `finance-frontend` são builds estáticos espelhados em
> buckets do MinIO; o ingress serve o bucket direto.

---

## 2. O contexto financeiro — fluxo WhatsApp (o coração)

O usuário fala por WhatsApp; o `finance-customersupport-worker` é o
**encarregado do atendimento** (conversa e avisos proativos). A
`finance-api` é a **ACL** (sem banco, sem broker): valida e repassa. O
`domain-api` é o front door do CQRS; o `domain-worker` é o **único
escritor** do banco. `packages/finance-contracts` é o contrato único.

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuário (WhatsApp)
  participant EV as Evolution API<br/>(stack compute)
  participant W as finance-customersupport-worker<br/>(stack finance)
  participant F as finance-api (ACL)<br/>(stack finance)
  participant DA as domain-api<br/>(stack domain)
  participant RMQ as RabbitMQ<br/>(persistence)
  participant DW as domain-worker<br/>(stack domain)
  participant PG as Postgres<br/>(persistence)

  U->>EV: mensagem de texto
  EV->>RMQ: exchange evolution<br/>routing evolution.messages.upsert
  RMQ->>W: consome evolution.messages.upsert

  Note over W: NLU por regras → intent<br/>(despesa/receita/orçamento/leitura)

  alt escrita (finance.*)
    W->>F: POST /commands {action, payload}
    F->>DA: POST /commands (envelope, 202)
    DA->>RMQ: publica em domain.commands
    RMQ->>DW: consome domain.commands.queue
    DW->>PG: aplica (idempotente) + audit_log
    DW->>RMQ: publica evento (outbox durável)<br/>exchange domain.events
    F-->>W: 202 accepted
    W-->>EV: sendText (resposta imediata)
  else leitura (finance.query.*)
    W->>F: POST /queries {action, payload}
    F->>DA: GET /finance/*
    DA->>PG: projeção (read-only)
    DA-->>F: projeção JSON
    F-->>W: projeção
    W-->>EV: sendText ou sendMedia (card/PNG)
  end

  RMQ->>W: consome domain.events<br/>(fila finance.customersupport.events)
  Note over W: confirmação do próprio comando<br/>é suprimida (dedup), alerta de<br/>orçamento é sempre enviado
  W-->>EV: sendText (aviso proativo)
  EV-->>U: resposta no WhatsApp
```

**Regra de isolamento (§1.1):** nem a `finance-api` nem o worker têm
`DATABASE_URL`, driver de banco ou publicador de comando. Só o stack
`domain` toca o banco. O worker **consome** broker (Evolution + eventos de
domínio) e **fala HTTP** com a ACL.

### Superfícies da ACL

```mermaid
flowchart LR
  W["finance-customersupport-worker"]
  subgraph ACL["finance-api (sem banco/broker)"]
    c["POST /commands<br/>→ /commands do domain-api (202)"]
    cs["POST /commands/sync<br/>→ /sync (200/422/504)"]
    q["POST /queries<br/>→ GET /finance/* (§4.2)"]
  end
  W -->|escrita| c
  W -->|escrita confirmada| cs
  W -->|leitura| q
```

---

## 3. CQRS — broker e persistência (stack domain)

O `domain-api` publica comando; o `domain-worker` é o único escritor e
publica eventos via **outbox durável** (o evento é gravado como pendente
antes do publish; um relay reenvia o que ficou, at-least-once).

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
  consumers["consumidores de eventos<br/>(finance-customersupport-worker, ...)"]

  dapi -->|publish comando| ex_cmd
  ex_cmd --> q_cmd
  q_cmd --> dworker
  dworker -->|aplica| pg
  dworker -->|grava pendente| outbox
  outbox -->|relay publica| ex_ev
  ex_ev --> consumers
```

---

## 4. Deploy / CI-CD

Um pipeline por linguagem, auto-descoberto por arquivo (`go.mod`,
`pyproject.toml`) ou lista explícita (frontends). Cada um builda, testa,
publica `registry.giomartins.dev:5000/<app>:latest` + `:<sha>`, e chama o
**webhook do stack no Dockhand** (via SSH loopback no host).

```mermaid
flowchart LR
  push["push em main<br/>(muda modules/apps/&lt;app&gt;/**)"]
  push --> discover["discover<br/>(só os apps afetados)"]
  discover --> build["build + test<br/>arm64 via QEMU"]
  build --> reg[("registry:5000<br/>:latest + :sha")]
  reg --> webhook["webhook do stack<br/>no Dockhand (id 4/5/14...)"]
  webhook --> up["docker compose up -d<br/>--remove-orphans"]
  up --> verify["prova: container rodando<br/>+ guard de órfão de rename"]
```

- **Go** (`go-ci-cd.yml`): `domain-api`, `domain-worker`, `clubs-api`, `tela-api`.
- **Python** (`python-ci-cd.yml`): `clubs-ingest`, `finance-api`,
  `finance-customersupport-worker`.
- **TypeScript** (`ts-frontend-ci-cd.yml`): builds estáticos → buckets do MinIO.
- **Terraform** (`tf-ci-cd.yml`): Cloudflare DNS/Access + `host_baseline`.

---

## 5. Observabilidade

Todo app emite traces/métricas OTLP para o **alloy** (`:4318` e público em
`otel.giomartins.dev`); o stdout de todo container vai para o **loki**.
Dashboards no **grafana** (`grafana.giomartins.dev`, atrás de Access +
login). O `domain-api` e o worker usam `OTEL_SERVICE_NAME` por serviço.

---

## Referências

- `stacks/README.md` — os stacks, ordem de subida, segredos.
- `modules/apps/README.md` — cada app.
- `docs/finance-system-spec.md` — a spec do contexto financeiro (CQRS,
  invariantes, plano de teste).
- `modules/apps/domain-api/README.md` — contrato de escrita/leitura.
- `modules/apps/finance-api/README.md` — a ACL (endpoints, relays).
