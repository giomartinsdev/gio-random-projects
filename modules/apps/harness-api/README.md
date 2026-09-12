# harness-api

Backend do harness corporativo (`harness-frontend.giomartins.dev`) — sessões
de handoff de implementação: alguém inicia uma sessão (objetivo + contexto em
markdown), outra pessoa retoma a baton, o time acompanha pela timeline e a
sessão pode ser estendida (ramificada). Spec completa em
[`specs/001-harness-corporativo/`](../../../specs/001-harness-corporativo/).

## Como funciona

- **`internal/store`** — SQLite (`modernc.org/sqlite`, pure Go, sem CGO — o
  build é estático igual aos outros apps, distroless). Três tabelas:
  `sessoes` (título/objetivo/contexto, status do ciclo de vida, `criador_email`
  e `dono_atual_email` — a baton), `eventos` (timeline append-only: criacao,
  retomada, atualizacao_contexto, extensao_criada, status_mudou) e `usuarios`
  (cache de e-mail→nome, derivado do JWT, para exibir nomes de outras pessoas).
  Migrations embutidas em `store/migrations/001_init.sql`. O arquivo do banco
  vive no volume docker `/data`.
- **`internal/httpapi/auth.go`** — identidade pelo **Cloudflare Access**,
  mesmo modelo do bet-api: o edge carimba `Cf-Access-Jwt-Assertion` em todo
  request; o middleware valida a assinatura contra o JWKS do team
  (`keyfunc`), o issuer (`HARNESS_ACCESS_ISSUER`), o `aud` desta app
  (`HARNESS_ACCESS_AUD`) e o e-mail contra `HARNESS_ALLOWED_EMAILS` (defesa
  extra — a decisão de quem entra é do Access). `email`+`name` viram a
  `Identity` do request context e fazem upsert no cache `usuarios`.
  `HARNESS_DEV_BYPASS_AUTH=1` é o atalho de dev (identidade fixa sem JWT) e
  **não pode ficar setado em produção**.
- **`internal/httpapi/server.go`** — mux stdlib com patterns, CORS único
  middleware (com credentials — o cookie do Access atravessa a origem
  cruzada), corpo de erro padrão `{"erro":{"codigo","mensagem"}}`.

## Login (hop SSO)

O Access protege `harness-api.giomartins.dev/api` (app por path — o hostname
bare fica fora do Access para o hop de login do frontend passar; ver
`locals.tf`). A SPA navega top-level para `GET /api/sso?return=<origem>`; o
Access intercepta (Google one-click) e, depois de passado, esta rota faz 302
de volta para a origem — só se ela estiver em `HARNESS_FRONTEND_ORIGINS`
(origem estranha → `422`, sem fallback silencioso).

## API REST

| Rota | O que faz |
| --- | --- |
| `GET /api/health` | saúde (sem auth, usado pelo watchtower/compose) |
| `GET /api/me` | identidade do chamador (probe de login da SPA) |
| `GET /api/sso` | hop de login — 302 para `?return=` se a origem é allowlistada |
| `POST /api/sessoes` | cria sessão (`origem_id` presente → extensão, copia contexto) |
| `GET /api/sessoes` | lista do time (`?status=` repetível, `?dono=`, `?origem=`); ativas primeiro, depois `atualizado_em` desc |
| `GET /api/sessoes/{id}` | detalhe completo + `origem`/`extensoes` resumidos |
| `PATCH /api/sessoes/{id}` | edita contexto/próximos passos — concorrência otimista: desatualizado → `409` com o estado vigente, `force:true` sobrescreve |
| `POST /api/sessoes/{id}/retomar` | assume a baton (idempotente para quem já é o dono) |
| `POST /api/sessoes/{id}/status` | `{"acao":"entregar\|arquivar\|reabrir","pr_link":...}` — só transições válidas, senão `422 transicao_invalida` |
| `GET /api/sessoes/{id}/eventos` | timeline ascendente |

Contrato completo: `specs/001-harness-corporativo/contracts/api.md`.

## Configuração

| Env | Padrão | O que é |
| --- | --- | --- |
| `PORT` | `8010` | porta de escuta |
| `BIND_HOST` | vazio (todas) | em produção `127.0.0.1` (nginx na frente) |
| `HARNESS_DB_PATH` | `/data/harness.db` | arquivo SQLite — o default é o caminho do **container**; local, aponte para algo gravável |
| `HARNESS_FRONTEND_ORIGINS` | vazio | origens do harness-frontend — CORS (com credentials) e allowlist do redirect do `/api/sso` |
| `HARNESS_ACCESS_ISSUER` | vazio | issuer do JWT do Access (`https://<team>.cloudflareaccess.com`); daí sai o JWKS (`/cdn-cgi/access/certs`) |
| `HARNESS_ACCESS_AUD` | vazio | `aud` tag da Access app `harness-api.giomartins.dev/api` (output do módulo cloudflare) |
| `HARNESS_ALLOWED_EMAILS` | vazio | e-mails permitidos, csv (check redundante ao Access, como no bet-api) |
| `HARNESS_DEV_BYPASS_AUTH` | vazio | **só dev**: `1` roda sem JWT como o usuário abaixo |
| `HARNESS_DEV_USER_EMAIL` | `dev@local` | e-mail do usuário dev |
| `HARNESS_DEV_USER_NOME` | parte local do e-mail | nome exibido do usuário dev |

Em prod o Terraform injeta tudo (módulo `compute_apps_harness_api` — o `aud`
vem de `module.cloud_cloudflare.access_app_auds["harness-api.giomartins.dev/api"]`,
como no bet_api). O JWKS é carregado no boot: sem ele (e sem bypass dev) a
API nem sobe.

## Desenvolvimento

```sh
go build ./... && go vet ./... && go test ./...
# local (macOS): o default /data/harness.db não existe no laptop — aponte
# o banco para ./harness.db (já está no .gitignore):
HARNESS_DEV_BYPASS_AUTH=1 HARNESS_DB_PATH=./harness.db \
HARNESS_DEV_USER_EMAIL=gio@corp HARNESS_DEV_USER_NOME=Gio go run .
# (sem HARNESS_ACCESS_ISSUER o bypass dispensa JWKS; com bypass on, a
# falta dele não derruba o boot)
```

Os testes (`httptest` + SQLite temporário) injetam a `Identity` direto no
context — não passam pelo middleware. Depois disso, `npm run dev` no
`../harness-frontend` (o proxy `/api` já aponta para `:8010`).

## Deploy

O `go-ci-cd.yml` descobre este app pelo `go.mod` e builda a imagem distroless
(`CGO_ENABLED=0` — obrigatório com `modernc.org/sqlite`). O container é
recriado pelo `-replace` mapeado no `case` do workflow (sem isso o deploy
fica verde sem trocar nada — ver `docs/novo-app-ci-cd.md` §6). No Terraform:
regra de ingress `harness-api.giomartins.dev → 8010`, Access app por path
(`/api`), volume docker em `/data` para o SQLite sobreviver a recriação e
hostname bare fora do Access (`variables.tf` → `excluded_hostnames`).