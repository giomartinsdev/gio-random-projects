# stacks/

O lar das stacks persistidas — o lado da migração que sai do
Terraform-por-container. Cada arquivo é **um stack** do Docker Compose,
versionado aqui e gerenciado pelo Dockhand.

## Arquivos (infra)

| Arquivo | O que migra | Serviços |
| --- | --- | --- |
| `persistence.yml` | `modules/storage/*` | postgres, redis, minio (+ volumes) |
| `compute.yml` | `modules/compute/services/*` (menos observability) | registry, htpasswd-init, registry-docker-config, watchtower, beszel-hub, beszel-agent, vaultwarden, vaultwarden-api, adminer, 9router, ingress, dockhand |
| `observability.yml` | `modules/compute/services/observability` | loki, prometheus, tempo, alloy, grafana (+ configs em `observability/`) |

Os stacks de **app** (`domain`, `tela`, `clubs`, …) vêm numa fase
posterior — o repo ainda não os tem aqui.

O `ingress/default.conf` é o nginx renderizado (o TF gerava do
`local.services`; agora é arquivo versionado). Se um app migrar e mudar a
porta loopback, edite aqui.

> **Detalhe do git-backed:** com os três arquivos na mesma pasta `stacks/`,
> se você apontar o Dockhand pro mesmo *context directory* pra todos, um
> commit em qualquer arquivo pode redeployar os três (a detecção de mudança
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

`compute.yml`: `REGISTRY_PASSWORD`, `BESZEL_AGENT_KEY` (se vazio, remova o
`beszel-agent`), `VAULTWARDEN_ADMIN_TOKEN`, `VAULTWARDEN_ACCOUNT_EMAIL`,
`VAULTWARDEN_ACCOUNT_MASTER_PASSWORD`, `VAULTWARDEN_API_CLIENT_ID`,
`VAULTWARDEN_API_CLIENT_SECRET`, `VAULTWARDEN_BRIDGE_API_KEY`,
`NINEROUTER_JWT_SECRET`, `NINEROUTER_INITIAL_PASSWORD`.

`observability.yml`: `GRAFANA_ADMIN_PASSWORD`.

> **Vaultwarden não serve o provider "Bitwarden" do Dockhand.** O provider
> é o Bitwarden *Secrets Manager* (`bws` + Machine Account + Project UUID),
> que o Vaultwarden não implementa. Hoje os segredos ficam como variáveis
> de stack no Dockhand; pra centralizar num cofre suportado, suba um
> **Infisical** e ligue o provider nele.

## Como migrar um arquivo (ordem recomendada)

Os containers atuais do TF não têm labels de compose, então o "adopt" do
Dockhand não os pega. O caminho é **parar+remover o antigo e subir a
stack** (mesmo nome, mesmos volumes):

1. `terraform state rm` nos recursos do módulo — **containers E volumes**.
   Sem isso, um apply futuro destrói o volume e você perde os dados.
   Ex.: `terraform state rm module.storage_postgres` e os
   `docker_volume` correspondentes.
2. `docker rm -f <container>` (libera o nome; o volume fica).
3. Suba a stack: `docker compose -f stacks/<arquivo>.yml up -d` (com as
   variáveis de segredo no ambiente) **ou** crie/importe no Dockhand
   (git-backed, context `stacks`, compose `<arquivo>.yml`).
4. Valide que voltou.
5. Apague o módulo TF e as entradas em `main.tf`/`locals.tf`/`secrets.tf`.

Ordem pra reduzir dor: **observability** (ninguém depende) → **compute**
(registry/adminer/beszel/9router/ingress) → **persistence**
(postgres/redis/minio: janela de downtime, os apps reconectam) → **apps**.

O `ingress` é `network_mode: host` e sobe por último no arquivo; ele já
fala com tudo por `127.0.0.1:<porta>`.

## O que NÃO vira stack

- **Cloudflare** (DNS, Access, service tokens, mTLS do registry, email
  routing) e o **firewall/MTU do host** (`host_baseline`) não são
  containers. Ficam pra uma fase própria (dashboard/Tunnel + script).
- **Buckets do MinIO** (`tela-frontend`, `hub-frontend`, `clubs-frontend`)
  eram criados por um `null_resource`. Depois de migrar o MinIO, recrie
  com `mc mb`/`mc anonymous set download` (ou pelo Dockhand).
