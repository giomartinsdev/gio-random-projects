# Colocando um app novo no ar

Como levar um projeto novo de zero até um domínio próprio rodando em
produção, neste repositório. O caminho todo é: **descoberta automática →
build da imagem → push no registry → `terraform apply`**.

Se você quiser um exemplo completo para copiar, `modules/apps/tela-api` é o
mais recente e o mais autocontido (um container, um domínio, sem banco).

---

## 1. Onde o app mora

Tudo vive em `modules/apps/<nome>/`. O `<nome>` da pasta vira o nome da
imagem (`registry.giomartins.dev/<nome>`) e do container — escolha com
carinho, porque ele aparece em vários lugares.

## 2. Como o pipeline descobre seu app

Três workflows, um por linguagem+camada — **Go se descobre sozinho pelo
arquivo, TypeScript precisa ser adicionado numa lista explícita**:

| Linguagem/camada | Workflow | Como decide quais apps buildar |
| --- | --- | --- |
| Go | `.github/workflows/go-ci-cd.yml` | qualquer pasta com `go.mod` em `modules/apps/<nome>/go.mod` |
| TypeScript frontend | `.github/workflows/ts-frontend-ci-cd.yml` | nome do app no `ALLOWED_APPS` do job `discover` |
| TypeScript backend | `.github/workflows/ts-backend-ci-cd.yml` | idem, no seu próprio `ALLOWED_APPS` |

Um `package.json` sozinho não basta para o TypeScript pegar seu app —
`buteco-class-frontend` também tem um, e não é isso que separa frontend de backend. Ao
criar um app TS novo, adicione o nome no array `ALLOWED_APPS` do
workflow certo (`ts-frontend-ci-cd.yml` se ele bate `VITE_*` no bundle
em build time; `ts-backend-ci-cd.yml` se recebe config em runtime via
Terraform).

Go continua auto-descoberto por `find modules/apps -mindepth 2
-maxdepth 2 -name go.mod`, **um nível abaixo de `modules/apps/`**:

> Um app Go com frontend React põe o `package.json` em
> `modules/apps/<nome>/client/package.json` (profundidade 3) — os
> workflows TypeScript não enxergam essa profundidade, e o app builda só
> pelo pipeline Go, um container, um build. É o que `tela-api` faz.

## 3. Dockerfile

O build roda com `context: modules/apps/<nome>`, então tudo que você
`COPY` é relativo à pasta do app. Multi-stage, terminando em distroless:

```dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot:nonroot
ENTRYPOINT ["/app"]
```

Não esqueça o `.dockerignore` (`node_modules`, artefatos de build).

## 4. Módulo Terraform

Crie `modules/infra/terraform/modules/compute/apps/<nome>/` com
`main.tf`, `variables.tf`, `versions.tf` e `outputs.tf`. O mínimo:

```hcl
resource "docker_container" "<nome>" {
  name    = "<nome>"
  image   = "${var.registry_host}/<nome>:latest"
  restart = "unless-stopped"

  env   = ["PORT=8000"]
  ports {
    internal = 8000
    external = var.external_port   # escolha uma porta livre
  }
  networks_advanced { name = var.network_name }
}
```

**Telemetria**: inclua desde já o env que toda app nova recebe hoje —
`OTEL_EXPORTER_OTLP_ENDPOINT = module.compute_services_observability.otlp_endpoint`
(e `OTEL_SERVICE_NAME = "<nome>"`). Logs já fluem para o Grafana sem
nenhum trabalho extra (o alloy faz scrape do stdout de todo container);
com esse env, traces e métricas também entram — copie o pacote
`internal/telemetry` de um app Go ou `src/telemetry.ts` de um backend
TS. A receita completa está no README do módulo observability.

Portas já usadas hoje: 8004 (bookclub-api), 8005 (classroom-api), 8007
(tela-api). Pegue a próxima.

> Isso vale para um app que roda como container. `buteco-class-frontend`
> e `tela-frontend` não seguem mais essa receita: são builds estáticos
> espelhados direto num bucket do MinIO, sem container nenhum rodando —
> veja `modules/infra/terraform/static_sites.tf` e o README de
> `compute/services/ingress`. Se o app novo for só uma SPA estática sem
> nenhuma parte de backend, esse é o caminho mais simples, não o daqui.

Depois registre o módulo em `modules/infra/terraform/main.tf`:

```hcl
module "compute_apps_<nome>" {
  source    = "./modules/compute/apps/<nome>"
  providers = { docker = docker }

  network_name  = module.network_docker_apps.network_name
  registry_host = var.registry_host
}
```

## 5. Domínio

Duas edições, e as duas importam:

**`modules/infra/terraform/locals.tf`** — a regra de ingress do túnel.
A porta tem que bater com o `external_port` do módulo:

```hcl
{
  hostname = "<nome>.giomartins.dev"
  service  = "http://localhost:8006"
},
```

**`modules/infra/terraform/variables.tf`** — se o app tem autenticação
própria (ou é público de propósito), adicione o hostname em
`excluded_hostnames`, senão o Cloudflare Access põe um login Google na
frente e só a sua conta entra. Comente o porquê na mesma linha; toda
entrada dessa lista tem uma justificativa.

## 6. ⚠️ O passo que é fácil esquecer: o `-replace`

**Este é o único ponto do processo em que um erro te dá um deploy verde
que não mudou nada.** Vale ler com atenção.

A tag da imagem no state é sempre `:latest`, que nunca muda. Então, do
ponto de vista do Terraform, um deploy comum **não tem diff nenhum** — o
container velho continua rodando e o job termina com sucesso.

O que força a recriação é um `-replace` explícito, num `case` no fim de
cada workflow:

```bash
case "$app" in
  domain-api)    REPLACE_ARGS+=("-replace=module.compute_apps_domain_api.docker_container.domain_api") ;;
  tela-api)      REPLACE_ARGS+=("-replace=module.compute_apps_tela_api.docker_container.tela_api") ;;
  <nome>)        REPLACE_ARGS+=("-replace=module.compute_apps_<nome>.docker_container.<nome>") ;;
  *) echo "::warning::no -replace mapping for '$app'; its container will NOT be recreated" ;;
esac
```

O mapeamento é explícito porque não dá para derivar do nome:
`domain-worker`, por exemplo, mora dentro do módulo do `domain-api`.

> Aconteceu de verdade com o `tela-api`: dois deploys "com sucesso" seguidos,
> e o site continuou servindo o primeiro bundle. O `*)` com warning
> existe agora justamente para essa falha aparecer.

Um segundo detalhe da mesma família: `-replace` sozinho também não
garante imagem nova, porque o dockerd só puxa do registry se a tag não
estiver no cache local dele. Por isso os workflows fazem um
`docker pull` explícito contra o daemon remoto **antes** do apply. Isso
já está pronto e vale para qualquer app novo — não precisa mexer.

## 7. Variáveis de build do frontend (só se tiver Vite)

O Vite grava as `VITE_*` **no bundle, em tempo de build** — não são lidas
em runtime. Então elas vão como `build-args` no workflow e como
`ARG`/`ENV` no Dockerfile. Se o app precisa saber a própria URL pública,
passe explicitamente: `window.location.origin` mente em contextos
embutidos (dentro de uma Activity do Discord, por exemplo, ele é o
domínio de proxy do Discord).

## 8. Primeiro deploy

```bash
git add . && git commit -m "feat(<nome>): ..." && git push
```

O push em `modules/apps/**` dispara o workflow certo sozinho. Só que na
primeira vez existe uma corrida: o workflow `tf-ci-cd` (que roda em
mudanças de infra) pode tentar criar o container **antes** de a imagem
existir no registry, e falha com `not found`. É esperado — o pipeline do
app builda, empurra e aplica logo depois. Se quiser rodar de novo à mão:

```bash
gh workflow run go-ci-cd.yml -f app=<nome>
# ou, se for TypeScript:
gh workflow run ts-frontend-ci-cd.yml -f app=<nome>
gh workflow run ts-backend-ci-cd.yml -f app=<nome>
```

Note que mudanças **só** em `.github/workflows/**` não disparam nada (o
filtro de path é `modules/apps/**`) — nesses casos o `workflow_dispatch`
acima é obrigatório.

## 9. Conferindo que subiu de verdade

Não confie no check verde. Confira o que está servindo:

```bash
curl -s https://<nome>.giomartins.dev/healthz
# e, se for SPA, que o hash do bundle bate com o build local:
curl -s https://<nome>.giomartins.dev/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

## Checklist

- [ ] `modules/apps/<nome>/` com `go.mod` **ou** `package.json` na raiz (não os dois)
- [ ] se for TypeScript: nome adicionado ao `ALLOWED_APPS` de `ts-frontend-ci-cd.yml` ou `ts-backend-ci-cd.yml` (um `package.json` sozinho não é suficiente)
- [ ] `Dockerfile` + `.dockerignore`
- [ ] módulo Terraform em `modules/compute/apps/<nome>/`
- [ ] `module "compute_apps_<nome>"` no `main.tf`
- [ ] regra de ingress no `locals.tf`, com a porta batendo
- [ ] hostname em `excluded_hostnames` se não for para ter SSO na frente
- [ ] **entrada no `case` do `-replace`** ← a que quebra silenciosamente
- [ ] deploy conferido com `curl`, não só pelo check verde
