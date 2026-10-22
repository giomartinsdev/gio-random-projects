# stacks/

O lar das stacks persistidas — o lado da migração que sai do
Terraform-por-container. Cada arquivo é **um stack** do Docker Compose,
versionado aqui e gerenciado pelo Dockhand.

Desde 2026-10-18 os stacks por domínio foram **agregados em 3 grupos** +
minecraft, todos orquestrados pelo Dockhand (ids 7/20/21/22):

| Stack no Dockhand | id | Arquivo raiz | O que sobe |
| --- | --- | --- | --- |
| `core` | 7 | `core.yml` | registry, htpasswd-init, registry-docker-config, dockhand, **ingress** (boot-only; **protegida**: sem webhook, `force_redeploy=0`, `repull_images=0`) |
| `project-infra` | 21 | `project-infra.yml` | inclui `persistence.yml`, `observability.yml`, `db-mcp.yml`, `compute.yml` (postgres, rabbitmq, minio, minio-buckets, loki/prometheus/tempo/alloy/grafana, db-mcp + gateway, vaultwarden, adminer, evolution, 9router) |
| `project-apps` | 22 | `project-apps.yml` | inclui `domain.yml`, `finance.yml`, `tela.yml`, `maus.yml`, `excalidraw.yml` |
| `minecraft` | 20 | `minecraft.yml` | servidor **All the Mods 11** (NeoForge, 293 mods, MC 26.1.2) + backup diário. Deployado pelo Dockhand desde 2026-10-19; `repull_images=0` porque as tags (`java25`, `mc-backup:latest`) são móveis |

**`bootstrap.yml`** (rede externa `apps`) não é stack do Dockhand: suba
manualmente só numa VPS nova.

## Agregação por `include:`

`project-infra.yml` e `project-apps.yml` são só `include:` dos arquivos por
domínio — **um arquivo legível por domínio**, um deploy por grupo. O Dockhand
sincroniza o repo inteiro em `/opt/stacks/<stack>/` e roda
`docker compose -p <stack> -f <arquivo-raiz> --env-file .env.dockhand up -d`.
Os `name:` dos arquivos incluídos são ignorados; os `container_name`, redes e
volumes externos continuam exatamente os mesmos de antes.

Duas convenções que o deploy agregado exige (o standalone não pedia):

- **Binds relativos são pela RAIZ do repo** (`./maus/Caddyfile:...`,
  `./maus/Caddyfile:...`) — no agregado o *project dir* é
  `/opt/stacks/project-*`, então um caminho relativo errado montaria
  um diretório vazio no lugar do arquivo.
- **Segredos continuam no Dockhand**: o `.env.dockhand` é gerado por deploy
  a partir das variáveis de stack (valores `enc:v1:` descriptografados na
  hora). O webhook autentica pelo header `x-gitlab-token` (os workflows de CI
  já usam esse formato).

`ai.yml` **não é incluído de propósito**: as imagens `9router`/`decision` do
registry local nunca foram buildadas e o usuário optou por preservar o
9router atual (`ghcr.io/decolua/9router:latest`, que agora vive no
`compute.yml` — ele já rodava no antigo stack `compute`). O `ai.yml` fica
versionado como referência para quando o `decision` for implantado.

**FC Clubs e Prospecta saíram do repositório** (2026-10): apps, `stacks/*.yml`,
rotas do ingress, entradas de DNS/Access no Terraform e as tabelas nos schemas
do domain. Os dados que já existiam no postgres continuam lá — nada foi
dropado; apenas não são mais criados nem lidos.

**`core.yml` é de boot, isolada de propósito.** O Dockhand deploya as
stacks; se ele estiver dentro de uma stack que ele mesmo recria, o deploy
mata o processo que o está servindo (já aconteceu). Por isso registry +
Dockhand vivem aqui, separados, e ficam **protegidos** no Dockhand. O
**ingress** também mora aqui: é a frente de TODOS os hostnames do host —
subir/derrubar plataforma não deve derrubar a porta 80.

Os **frontends** (`tela-frontend`, `hub-frontend`, `finance-frontend`) são
builds estáticos espelhados em
bucket do MinIO — não são container, não entram aqui. Os buckets (e a policy
de leitura anônima) vêm do one-shot idempotente `minio-buckets`, que hoje usa
**`amazon/aws-cli`** pela API S3: o `minio/mc` saiu do Docker Hub e o
`itzg/mc-backup` que tinha entrado no lugar **não traz o binário `mc`** (o
one-shot saía 127 / "mc: not found" num deploy verde, com os buckets
sobrevivendo só porque já existiam). Pelo mesmo motivo o passo de mirror do
`ts-frontend-ci-cd.yml` trocou o `mc` pelo aws-cli: aquele `docker run` roda
no daemon da VPS sem credencial de registry, então o pull só passa sendo
anônimo. É também por isso que `minecraft` e `project-infra` rodam com
`repull_images=0` — as tags móveis (`java25`, `mc-backup:latest`,
`minio/minio:latest`) não são mais puxáveis.

O `ingress/default.conf` é o nginx renderizado (o TF gerava do
`local.services`; agora é arquivo versionado), montado pelo `core.yml`. Se
um app migrar e mudar a porta loopback, edite aqui e recrie o `ingress`.

## Convenções

- **`name:` = nome do stack raiz no Dockhand** (`project-infra`,
  `project-apps`), e o serviço/`container_name` mantém o nome que já era
  usado na rede (`postgres`, `rabbitmq`, `minio`, `domain-api`, …) — é por
  esse nome que os outros se enxergam.
- **Rede externa `apps`**: todas entram nela (`external: true`). Não crie
  rede própria.
- **Volumes externos reusando o nome do TF**: as stacks apontam pros
  named volumes que o Terraform já criou (`apps_postgres_data`, `obs_*`,
  `registry_*`, …) com `external: true`. Isso preserva os dados atuais.
- **Imagem do registry**: `registry.giomartins.dev:5000/<app>:latest`. O
  build/push continua no CI. O `project-apps` (22) tem `repull_images=1`
  para o webhook do CI puxar a `:latest` nova; o `project-infra` (21) tem
  `repull_images=0` (ver nota do minio acima).
- **Webhook do Dockhand**: `POST /api/git/stacks/<id>/webhook` com o header
  `x-gitlab-token: <webhook secret>`. Os workflows
  `go-ci-cd.yml`/`python-ci-cd.yml`/`*-image.yml` mapeiam app → **id 22**
  (exceto `ai-image.yml` → 21). Os ids antigos (domain=4, clubs=5, tela=6,
  finance=14, prospecta=17, maus=11, excalidraw=19) foram aposentados junto
  com os stacks individuais.
- **Renomear um serviço**: o `up -d --remove-orphans` do Dockhand remove o
  container antigo (mesmo projeto compose), mas um órfão sobrevivente é uma
  falha **silenciosa** — dois consumidores da mesma fila (ex.: os dois workers
  do financeiro) dividem as mensagens. O deploy do CI tem um guard que remove,
  por nome, os legados já aposentados e falha se sobrar. Ao renomear um serviço,
  acrescente o nome ANTIGO à lista `legacy` no `deploy` do workflow da
  linguagem (`python-ci-cd.yml`, `go-ci-cd.yml`, …).
- **Label `giomartins.dev/project`** em todo serviço: identifica o projeto
  (módulo/domínio do repo) dono do container — `storage`, `observability`,
  `db-mcp`, `compute`, `ai`, `domain`, `finance`, `tela`, `maus`,
  `excalidraw`, `minecraft`, `core`. Filtre por aí:
  `docker ps --filter label=giomartins.dev/project=finance`.
- **Segredo nunca no git**: no compose só `${VAR}`. O valor vira variável
  de stack no Dockhand (criptografada no DB dele).

## Segredos por arquivo

`persistence.yml` → **project-infra**: `POSTGRES_PASSWORD`,
`RABBITMQ_PASSWORD`, `MINIO_ROOT_PASSWORD` (+ opcionais `POSTGRES_USER`,
`POSTGRES_DB`, `RABBITMQ_USER`).

`observability.yml` → **project-infra**: `GRAFANA_ADMIN_PASSWORD`.

`db-mcp.yml` → **project-infra**: `MCP_DB_TOKEN` (bearer do gateway nginx) e
`MCP_DB_PASSWORD` (senha do usuário `mcp_ro`, só-SELECT nas tabelas
`finance_*`).

`compute.yml` → **project-infra**: `VAULTWARDEN_ADMIN_TOKEN`,
`VAULTWARDEN_ACCOUNT_EMAIL`, `VAULTWARDEN_ACCOUNT_MASTER_PASSWORD`,
`VAULTWARDEN_API_CLIENT_ID`, `VAULTWARDEN_API_CLIENT_SECRET`,
`VAULTWARDEN_BRIDGE_API_KEY`, `POSTGRES_PASSWORD` (a MESMA do persistence —
Evolution API), `RABBITMQ_PASSWORD` (a MESMA do persistence — Evolution
API), `EVOLUTION_API_KEY` (apikey global da Evolution API),
`NINEROUTER_JWT_SECRET` e `NINEROUTER_INITIAL_PASSWORD` (o 9router reusa o
volume `ninerouter_data`, então nada se perde). Opcionais do `ai.yml`
(decision, fora do deploy): `JEV_STYLE_API_KEY`, `DECISION_RELEASE`.

`domain.yml` → **project-apps**: `POSTGRES_PASSWORD` (a MESMA do persistence),
`RABBITMQ_PASSWORD` (a MESMA do persistence), `DOMAIN_API_KEYS`.

`finance.yml` → **project-apps**: `FINANCE_API_KEYS`, `FINANCE_WORKER_API_KEY`,
`FINANCE_DOMAIN_API_KEY` (a MESMA em `DOMAIN_API_KEYS` do `domain`),
`RABBITMQ_PASSWORD`, `EVOLUTION_API_KEY`. Open Finance (opcional):
`POLP_OF_CLIENT_ID`, `POLP_OF_CLIENT_SECRET`, `FINANCE_OF_API_KEY` (uma key
própria do conector em `FINANCE_API_KEYS`, rótulo `openfinance`), `OF_*`,
`OF_TICK_*`, `SECRETS_BRIDGE_URL`, `FINANCE_CORS_ORIGINS`. Opcionais
também: `FINANCE_GOOGLE_CLIENT_ID` e
`FINANCE_SESSION_SECRET` (derivado do `FINANCE_DOMAIN_API_KEY` se ausente).

`maus.yml` → **project-apps**: **nenhum segredo obrigatório**. O OpenMausBot
não tem `OWNER_TOKEN`; o gate é o *pairing* do próprio app (um código de uso
único por dispositivo). O provider de modelo é configuração **in-app**
(App Settings → Model providers → OpenAI-compatible), não variável de
ambiente: aponte para `http://9router:20128/v1` (o 9router roda no stack
`project-infra`, na rede `apps`). Sem CLI baked (`ENGINES=""`), então nenhum
`claude`/`codex`/`grok` loga no container. Opcional (bridge do Slack):
`SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_ALLOWED_USERS`. Não-segredo
opcional: `OMB_SIGNIN_EMAILS`/`OMB_SIGNIN_MEMBER_EMAILS` (login por código
no e-mail em vez de só pairing), `OMB_DEFAULT_BOT_ID` e
`OMB_UPSTREAM_SCHEME` (quase nunca — o Caddy já força https pro harness).

`excalidraw.yml` → **project-apps**: **nenhum segredo**. É um SPA estático
(imagem própria, sem config), público em `draw.giomartins.dev` — sem
Cloudflare Access (qualquer pessoa entra, como o tela).

`tela.yml` → **project-apps**: `TELA_TURN_SECRET`.

`core.yml`: `REGISTRY_PASSWORD` (e opcional `REGISTRY_USER`, default `admin`).

`minecraft.yml` → **minecraft**: `MINECRAFT_RCON_PASSWORD` (o mesmo no server
e no backup; o RCON só existe no loopback do container, não é publicado). A
whitelist não é segredo: é gerenciada in-game por um OP e vive em
`/data/minecraft/config/cwhitelist_entries.json` no host. O OP **não** é
configurado por env: `ops.json` precisa do UUID *offline* do nick (ver
`docs/servidor-minecraft.md`).

> **Vaultwarden não serve o provider "Bitwarden" do Dockhand.** O provider
> é o Bitwarden *Secrets Manager* (`bws` + Machine Account + Project UUID),
> que o Vaultwarden não implementa. Hoje os segredos ficam como variáveis
> de stack no Dockhand; pra centralizar num cofre suportado, suba um
> **Infisical** e ligue o provider nele.

> **SSO do financeiro usa um client público compartilhado.** O *client ID* do
> Google é público (vai no bundle). Um client OAuth aceita várias *authorized
> JavaScript origins*, então `https://finance.giomartins.dev` precisa estar na
> lista desse client no Google Cloud Console — foi o `origin_mismatch` que o
> comentário do workflow registra. Para um client próprio, defina
> `FINANCE_GOOGLE_CLIENT_ID` (stack).

## Migração (concluída)

Três cortes já foram concluídos:

1. **Terraform → Dockhand**: os containers antigos foram
   renomeados/parados e recriados pelas stacks (mesmo `container_name`,
   mesmos volumes), e os recursos saíram do state com `terraform state rm`
   (sem destruir). O Terraform agora só cuida de Cloudflare + host_baseline
   (a rede `apps` virou o `bootstrap.yml`) — ver
   `modules/infra/terraform/README.md`.
2. **12 stacks → 3 agregados + minecraft** (2026-10-18): os stacks
   `observability`, `persistence`, `compute`, `domain`, `tela`,
   `maus`, `finance`, `excalidraw`, `db-mcp` e `ai` foram
   removidos do Dockhand; as variáveis de stack migraram byte-a-byte para
   `project-infra`/`project-apps` (verificado contra os valores em execução)
   e os ids de webhook dos workflows de CI apontam para 22/21. Rollback:
   arquivos antigos no git + `dockhand.db.bak-*` em `/opt/dockhand/db/`.
3. **minecraft → Dockhand** (2026-10-19): o stack 20 já existia no DB mas os
   containers vinham de `/home/ubuntu/stacks/minecraft.yml`, à mão. Alinhado o
   webhook (mesmo secret dos outros) e deployado: agora o comando é
   `docker compose -p minecraft -f /opt/stacks/minecraft/minecraft.yml up -d
   --remove-orphans --force-recreate`. O arquivo antigo segue em
   `/home/ubuntu/stacks/` (com `.bak-pre-labels`) e não é mais usado.

Nota de deploy: o **`core` (7) não tem webhook** e segue saindo de
`/opt/giomartins/stacks`. Um deploy dele recria ingress + registry + dockhand
ao mesmo tempo — é o que derruba o acesso, então mexa com a mão e só de
propósito.

Ordem de subida numa VPS limpa: **bootstrap → core → project-infra →
project-apps** (→ minecraft, quando quiser).

Para adicionar um stack novo depois: se for domínio de app, adicione o
`stacks/<nome>.yml` ao `include:` do `project-apps.yml` (ou
`project-infra.yml` para infra) e dê webhook — o Dockhand sincroniza o repo
e sobe tudo. Pra um grupo totalmente novo, escreva `stacks/<agregador>.yml`
com `include:`, crie a stack no Dockhand (git-backed, compose
`stacks/<agregador>.yml`, branch `main`) e copie os segredos como variáveis
de stack (criptografadas no DB dele; o `/opt/dockhand` + `.encryption_key`
entram no backup).

## O que NÃO vira stack

- **Cloudflare** (DNS, Access, service tokens, mTLS do registry, email
  routing) e o **firewall/MTU do host** (`host_baseline`) não são
  containers. Ficam pra uma fase própria (dashboard/Tunnel + script).
- **Buckets do MinIO** (`tela-frontend`, `hub-frontend`, `finance-frontend`)
  eram criados por um
  `null_resource`; hoje o one-shot `minio-buckets` (idempotente, roda a cada
  deploy do `project-infra`) cria e expõe os buckets.
