# stacks/

O lar das stacks persistidas — o lado da migração que sai do
Terraform-por-container. Cada arquivo é **um stack** do Docker Compose,
versionado aqui e gerenciado pelo Dockhand.

## Arquivos

Cada arquivo é um stack **independente** (sem agregado na raiz). Não há
`depends_on` entre arquivos — a ordem de subida é operacional.

| Arquivo | O que migra | Serviços |
| --- | --- | --- |
| `bootstrap.yml` | infra compartilhada | `network-init` (cria a rede `apps`; suba ESTE primeiro numa VPS nova) |
| `core.yml` | base da VPS | registry, htpasswd-init, registry-docker-config, dockhand (boot-only; **protegida**) |
| `persistence.yml` | `modules/storage/*` | postgres, redis, minio, minio-buckets (+ volumes) |
| `compute.yml` | `modules/compute/services/*` (menos observability e core) | vaultwarden, vaultwarden-api, adminer, 9router, ingress |
| `observability.yml` | `modules/compute/services/observability` | loki, prometheus, tempo, alloy, grafana (+ configs em `observability/`) |
| `domain.yml` | `modules/compute/apps/domain_api` | domain-api, domain-worker |
| `tela.yml` | `modules/compute/apps/tela_api` | tela-mediamtx, tela-coturn, tela-api (os 3 em host network) |
| `clubs.yml` | `modules/compute/apps/clubs_api` + `clubs_ingest` | clubs-api, clubs-ingest |
| `dots.yml` | OpenDots completo (CopilotKit): app + Intelligence self-hosted + computer service | intelligence-postgres, intelligence-redis, intelligence (`ghcr.io/copilotkit/intelligence/composite`), computer-image-base (build-only), computer-image (base upstream + git/ssh + deploy key), computer-supervisor (OpenBot, segura o socket do Docker), opendots (build do upstream PINADO) |

**`core.yml` é de boot, isolada de propósito.** O Dockhand deploya as
stacks; se ele estiver dentro de uma stack que ele mesmo recria, o deploy
mata o processo que o está servindo (já aconteceu — derrubou o 9router e
o resto do `compute`). Por isso registry + Dockhand vivem aqui, separados,
e ficam **protegidos** no Dockhand (`force_redeploy=0`, `repull_images=0`,
sem webhook). Numa VPS nova: `bootstrap → persistence → core →
compute → observability → apps → dots`, e não se
atualiza o `core` pelo Dockhand.

Os **frontends** (`tela-frontend`, `clubs-frontend`, `hub-frontend`) são
builds estáticos espelhados em bucket do MinIO — não são container, não
entram aqui.

O `ingress/default.conf` é o nginx renderizado (o TF gerava do
`local.services`; agora é arquivo versionado). Se um app migrar e mudar a
porta loopback, edite aqui.

> **Detalhe do git-backed:** com todos os arquivos na mesma pasta `stacks/`,
> se você apontar o Dockhand pro mesmo *context directory* pra todos, um
> commit em qualquer arquivo pode redeployar todos (a detecção de mudança
> é por diretório). Se quiser detecção por stack, ponha cada arquivo na
> própria subpasta.

## Convenções

- **`name:` = nome do stack no Dockhand**, e o serviço/`container_name`
  mantém o nome que já era usado na rede (`postgres`, `redis`, `minio`,
  `domain-api`, …) — é por esse nome que os outros se enxergam.
- **Rede externa `apps`**: todas entram nela (`external: true`). Não crie
  rede própria.
- **Volumes externos reusando o nome do TF**: as stacks apontam pros
  named volumes que o Terraform já criou (`apps_postgres_data`, `obs_*`,
  `registry_*`, …) com `external: true`. Isso preserva os dados atuais.
- **Imagem do registry**: `registry.giomartins.dev:5000/<app>:latest`. O
  build/push continua no CI.
- **Segredo nunca no git**: no compose só `${VAR}`. O valor vira variável
  de stack no Dockhand (criptografada no DB dele).

## Segredos por arquivo

`persistence.yml`: `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`.

`core.yml`: `REGISTRY_PASSWORD` (e opcional `REGISTRY_USER`, default `admin`).

`compute.yml`: `VAULTWARDEN_ADMIN_TOKEN`, `VAULTWARDEN_ACCOUNT_EMAIL`,
`VAULTWARDEN_ACCOUNT_MASTER_PASSWORD`, `VAULTWARDEN_API_CLIENT_ID`,
`VAULTWARDEN_API_CLIENT_SECRET`, `VAULTWARDEN_BRIDGE_API_KEY`,
`NINEROUTER_JWT_SECRET`, `NINEROUTER_INITIAL_PASSWORD`.

`observability.yml`: `GRAFANA_ADMIN_PASSWORD`.

`domain.yml`: `POSTGRES_PASSWORD` (a MESMA do persistence), `DOMAIN_API_KEYS`.

`clubs.yml`: `CLUBS_SESSION_SECRET`, `CLUBS_API_DOMAIN_KEY`,
`CLUBS_INGEST_DOMAIN_KEY`.

`tela.yml`: `TELA_TURN_SECRET`.

`dots.yml` junta os três blocos, então tem os três conjuntos de segredos:

- **Intelligence**: `INTELLIGENCE_DB_PASSWORD`, `INTELLIGENCE_AUTH_SECRET`
  (32+ chars), `INTELLIGENCE_SECRET_KEY_BASE` (64+ bytes) e, opcional,
  `INTELLIGENCE_LICENSE_TOKEN` (o `COPILOTKIT_LICENSE_TOKEN` do dashboard
  CopilotKit; sem ele o app funciona, só os entitlements ficam `none`).
  Não-segredo com default: `INTELLIGENCE_RUNNER_AUTH_SECRET` (gerado se
  faltar). postgres/redis são dedicados e internos (não usam os do
  `persistence.yml`).
- **OpenDots**: `OPENDOTS_OWNER_TOKEN` (24+ chars, login local) e
  `OPENDOTS_OPENAI_API_KEY` (provider OpenAI-compatível, ex. o 9router).
  Não-segredo com default: `OPENDOTS_OWNER_ID`, `OPENDOTS_OPENAI_BASE_URL`
  (`http://9router:20128/v1`), `OPENDOTS_OPENAI_MODEL`,
  `OPENDOTS_INTELLIGENCE_API_KEY` (a chave pré-semeada do composite) e
  `OPENDOTS_INTELLIGENCE_API_URL`/`_WS_URL` (`http://intelligence:4201` /
  `wss://dots.giomartins.dev`). O `_WS_URL` também é o endpoint do browser,
  então tem que ser WSS público (o ingress faz `/client/` e `/runner/` ->
  `127.0.0.1:4401`); `ws://intelligence:4401` quebra por mixed content.
- **Computer (OpenBot)**: `COMPUTER_SUPERVISOR_TOKEN` e `COMPUTER_TOKEN`
  (segredos, 24+ chars; o supervisor deriva a credencial de cada Dot com
  HMAC-SHA256 do `COMPUTER_TOKEN`) e `COMPUTER_DEPLOY_KEY` (a **chave
  privada** ed25519 usada pra clonar/empurrar o repo; a pública entra como
  *deploy key* no GitHub). Não-segredo com default: `COMPUTER_NAMESPACE`
  (`opendots`) e `COMPUTER_MEMORY_BYTES` (`2147483648`). O
  `computer-supervisor` segura o socket do Docker e cria um container
  `${COMPUTER_NAMESPACE}-computer-<dotId>` sob demanda.

> **Vaultwarden não serve o provider "Bitwarden" do Dockhand.** O provider
> é o Bitwarden *Secrets Manager* (`bws` + Machine Account + Project UUID),
> que o Vaultwarden não implementa. Hoje os segredos ficam como variáveis
> de stack no Dockhand; pra centralizar num cofre suportado, suba um
> **Infisical** e ligue o provider nele.

## Migração (concluída)

Estes stacks já foram migrados do Terraform: os containers antigos
foram renomeados/parados e recriados pelas stacks (mesmo `container_name`,
mesmos volumes), e os recursos correspondentes saíram do state com
`terraform state rm` (sem destruir). O Terraform agora só cuida de
Cloudflare + host_baseline (a rede `apps` virou o `bootstrap.yml`) — ver
`modules/infra/terraform/README.md`.

Ordem de subida numa VPS limpa: **bootstrap → persistence → core →
compute → observability → domain → clubs → tela → dots**.

Para adicionar um stack novo depois: escreva `stacks/<nome>.yml`, crie a
stack no Dockhand (git-backed, context `stacks`, compose `<nome>.yml`) e
suba. Os segredos são variáveis de stack no Dockhand (criptografadas no
DB dele; o `/opt/dockhand` + `.encryption_key` entram no backup).

## O que NÃO vira stack

- **Cloudflare** (DNS, Access, service tokens, mTLS do registry, email
  routing) e o **firewall/MTU do host** (`host_baseline`) não são
  containers. Ficam pra uma fase própria (dashboard/Tunnel + script).
- **Buckets do MinIO** (`tela-frontend`, `hub-frontend`, `clubs-frontend`)
  eram criados por um `null_resource`. Depois de migrar o MinIO, recrie
  com `mc mb`/`mc anonymous set download` (ou pelo Dockhand).
