# contas-api

BFF do módulo **Contas** da feature de gestão financeira pessoal
(`specs/002-gestao-financeira-modular/`, US1). Sem banco próprio — toda
persistência passa por HTTP para a `domain-api` compartilhada, que o
`domain-worker` aplica contra o agregado `conta`.

## Como funciona

- **`internal/domainapi`** — cliente HTTP para a `domain-api`
  (`X-API-Key` do env). Escritas (`conta.create`/`conta.update`) usam
  `POST /sync` — a UI precisa de feedback imediato e confirmado, não do
  `202` assíncrono padrão (mesma exceção documentada no README da
  `domain-api`, hoje também usada pelo `cch-api`). `Sync` classifica os
  três desfechos do worker: `written` (sucesso), `queued` (`504`, ainda
  não confirmado) e `failed` (`422`, rejeitado). Leituras
  (`GET /api/contas`, `GET /api/contas/{id}`) são `GET`s simples contra
  `/contas`.
- **`internal/httpapi/auth.go`** — identidade pelo **Cloudflare
  Access**, mesmo modelo do `harness-api`/`bet-api`: o edge carimba
  `Cf-Access-Jwt-Assertion` em todo request; o middleware valida a
  assinatura contra o JWKS do team (`keyfunc`), o issuer
  (`CONTAS_ACCESS_ISSUER`), o `aud` desta app (`CONTAS_ACCESS_AUD`) e o
  e-mail contra `CONTAS_ALLOWED_EMAILS` (defesa extra). `email`+`name`
  viram a `Identity` do request context. `CONTAS_DEV_BYPASS_AUTH=1` é o
  atalho de dev (identidade fixa sem JWT) e **não pode ficar setado em
  produção**.
- **`internal/httpapi/server.go`** — mux stdlib com patterns, CORS único
  middleware (com credentials — o cookie do Access atravessa a origem
  cruzada), corpo de erro padrão `{"erro":{"codigo","mensagem"}}`.
- **`internal/httpapi/contahandlers.go`** — as rotas de `/api/contas`.

## Login (hop SSO)

Mesmo padrão do `harness-api`: a SPA navega top-level para
`GET /api/sso?return=<origem>`; o Access intercepta e, depois de
passado, esta rota faz 302 de volta para a origem — só se ela estiver em
`CONTAS_FRONTEND_ORIGINS` (origem estranha → `422`, sem fallback
silencioso).

## API REST

| Rota | O que faz |
| --- | --- |
| `GET /api/health` | saúde (sem auth) |
| `GET /api/me` | identidade do chamador (probe de login da SPA) |
| `GET /api/sso` | hop de login — 302 para `?return=` se a origem é allowlistada |
| `GET /api/contas` | lista as contas da pessoa usuária logada (`?status=ativa\|arquivada`) |
| `POST /api/contas` | cria conta `{nome, tipo}` — `tipo` só `corrente`/`investimento` (`422` senão) |
| `PATCH /api/contas/{id}` | edita `nome` |
| `POST /api/contas/{id}/arquivar` | arquiva (seta `status=arquivada`) — não há exclusão física |
| `GET /api/contas/{id}/saldo` | placeholder — saldo consolidado real depende de `transacional-api`/`asset-manager-api`, ainda não integrados |

Contrato completo:
[`specs/002-gestao-financeira-modular/contracts/contas-api.md`](../../../specs/002-gestao-financeira-modular/contracts/contas-api.md).

**Erros de escrita**: comando rejeitado pelo `domain-worker` (ex.: `tipo`
inválido que passou da validação local, id inexistente) →
`422 rejeitado_pelo_worker`; comando ainda não confirmado em 10s →
`202 escrita_em_confirmacao`; qualquer outro erro de transporte com a
`domain-api` → `502 domain_indisponivel`.

## Configuração

| Env | Padrão | O que é |
| --- | --- | --- |
| `PORT` | `8020` | porta de escuta |
| `BIND_HOST` | vazio (todas) | em produção `127.0.0.1` (nginx na frente) |
| `CONTAS_FRONTEND_ORIGINS` | vazio | origens do frontend — CORS (com credentials) e allowlist do redirect do `/api/sso` |
| `CONTAS_ACCESS_ISSUER` | vazio | issuer do JWT do Access (`https://<team>.cloudflareaccess.com`); daí sai o JWKS (`/cdn-cgi/access/certs`) |
| `CONTAS_ACCESS_AUD` | vazio | `aud` tag da Access app desta API (output do módulo cloudflare) |
| `CONTAS_ALLOWED_EMAILS` | vazio | e-mails permitidos, csv (check redundante ao Access) |
| `CONTAS_DEV_BYPASS_AUTH` | vazio | **só dev**: `1` roda sem JWT como o usuário abaixo |
| `CONTAS_DEV_USER_EMAIL` | `dev@local` | e-mail do usuário dev |
| `CONTAS_DEV_USER_NOME` | parte local do e-mail | nome exibido do usuário dev |
| `CONTAS_DOMAIN_API_URL` | vazio | base da `domain-api` (ex.: `http://127.0.0.1:8000`) |
| `CONTAS_DOMAIN_API_KEY` | vazio | `X-API-Key` desta app na `domain-api` |

Sem `CONTAS_DOMAIN_API_URL`/`CONTAS_DOMAIN_API_KEY`, o cliente fica
`nil` (mesmo padrão do `cch-api`): a API sobe, mas toda rota de contas
falha (não há para onde ler/escrever).

## Desenvolvimento

```sh
go build ./... && go vet ./... && go test ./...
CONTAS_DEV_BYPASS_AUTH=1 CONTAS_DEV_USER_EMAIL=gio@corp CONTAS_DEV_USER_NOME=Gio \
CONTAS_DOMAIN_API_URL=http://127.0.0.1:8000 CONTAS_DOMAIN_API_KEY=dev \
go run .
```

Os testes (`httptest`) injetam a `Identity` direto no context — não
passam pelo middleware — e sobem um `httptest.Server` fake no lugar da
`domain-api` para os handlers de escrita/leitura.

## Deploy

O `go-ci-cd.yml` descobre este app pelo `go.mod` e builda a imagem
distroless. Ver `docs/novo-app-ci-cd.md` para o restante do checklist
(módulo Terraform, ingress, Access app por path, o `-replace` do
deploy).
