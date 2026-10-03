# stacks/

O lar das stacks persistidas deste host — o lado da migração que sai do
Terraform-por-container. Cada subpasta é **um stack** do Docker Compose,
versionado aqui e gerenciado pelo Dockhand.

## Convenção

- Uma pasta por stack: `stacks/<nome>/compose.yaml`.
- O `<nome>` é o project name do Compose (`name:` no arquivo), o nome do
  stack no Dockhand, e o nome do container/serviço. Mantenha os três
  iguais — o Compose trata divergência como orphan.
- **Nada de segredo no git.** Config normal pode ficar inline ou num
  `.env` commitado; qualquer senha/chave é variável de stack no Dockhand
  (criptografada no banco dele — ver "Segredos" abaixo).
- A imagem vem do registry do repo: `registry.giomartins.dev:5000/<app>:latest`.
  O build/push continua no CI; o redeploy passa a ser o Dockhand.
- Toda stack entra na rede externa `apps` (a mesma rede que o storage e o
  ingress já usam) — não crie rede própria, senão os serviços não se
  enxergam por nome.

Exemplo mínimo:

```yaml
name: meu-app
services:
  meu-app:
    image: registry.giomartins.dev:5000/meu-app:latest
    restart: unless-stopped
    environment:
      ALGUMA_COISA: valor
      MEU_SEGREDO: ${MEU_SEGREDO:?defina MEU_SEGREDO}
    networks: [apps]
networks:
  apps:
    external: true
    name: apps
```

## Onde vive no host

O Dockhand roda com **matching paths**: `DATA_DIR=/opt/dockhand` e
`STACKS_DIR=/opt/stacks`, ambos bind mounts no mesmo caminho dentro do
container. O layout em disco é **flat**: `STACKS_DIR/<stack>/`. Então uma
stack `clubs-ingest` no Dockhand mora em `/opt/stacks/clubs-ingest/`.

## Como uma stack é gerenciada (git-backed)

No Dockhand, a stack é criada como **git stack** apontando pra este repo:

- Repository: o repo `gio-random-projects`.
- Context directory: `stacks/<nome>`.
- Compose file path: `compose.yaml`.

O Dockhand clona o repo, roda o compose a partir de `stacks/<nome>`, e só
redeploya quando **algo dentro daquele diretório** muda (commits em outras
pastas são ignorados). Deploy por webhook/API do Dockhand — ver
`docs/` do próprio Dockhand ou o README do módulo
`modules/infra/terraform/modules/compute/services/dockhand`.

## Segredos

Não vão no git. Hoje: **variáveis de ambiente do stack no Dockhand**
(ficam criptografadas no DB dele, com `.encryption_key` — as duas coisas
entram no backup). No compose, referencie com `${VAR}` e o valor é
injetado no deploy.

> O Vaultwarden **não** serve o provider "Bitwarden" do Dockhand (ele é o
> Bitwarden *Secrets Manager* via `bws`, que o Vaultwarden não implementa).
> Pra centralizar num cofre de verdade, o caminho suportado é subir um
> **Infisical** como stack e apontar o provider pra ele — fase posterior.

## Migrar um app do Terraform para uma stack

Os containers atuais foram criados pelo provider `docker` do Terraform e
**não** têm labels de compose, então o "adopt" do Dockhand não os
reconhece. O caminho por app é:

1. Escreva `stacks/<app>/compose.yaml` espelhando o container atual
   (`docker inspect`). Segredos viram variáveis no Dockhand.
2. `terraform state rm module.compute_apps_<app>` — o Terraform *esquece*
   sem destruir; o container antigo continua rodando.
3. `docker rm -f <app>` — remove o container antigo (libera o nome).
4. Crie/deploy a stack no Dockhand (ou `docker compose up -d` em
   `/opt/stacks/<app>/`, que o Dockhand passa a rastrear).
5. Apague o módulo Terraform do app (`modules/compute/apps/<app>/`) e a
   entrada em `main.tf`/`locals.tf`/`secrets.tf` conforme sobrar.

Faça um app por vez. Comece por um **worker sem porta, sem volume e sem
ingress** (ex.: `clubs-ingest`) — se recriar, ninguém sente. Só depois
mexa em serviços com porta/ingress (aí a porta loopback tem que continuar
batendo com o `locals.tf`, ou o ingress migra pra Traefik — fase 3).
