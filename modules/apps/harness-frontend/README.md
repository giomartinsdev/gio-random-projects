# harness-frontend

A página em `harness-frontend.giomartins.dev` — sessões de handoff de
implementação do time. SPA React estática, mesmo modelo do
[`tela-frontend`](../tela-frontend/README.md): não roda como container — o
build (`dist/`) é espelhado direto num bucket do MinIO, e
`compute/services/ingress` serve esse bucket pela API S3 do MinIO (veja
`modules/infra/terraform/static_sites.tf`). Toda a lógica (sessões, baton,
timeline) mora em [`harness-api`](../harness-api/README.md), um app separado
que esta fala por CORS com `credentials:"include"` (`VITE_HARNESS_API_URL`,
ver `src/lib/api.ts`).

As 4 rotas (`/` lista, `/sessoes/nova` form — com `?origem=ID` para extensão,
`/sessoes/{id}` detalhe) são resolvidas por `window.location.pathname`, sem
lib de router: cada navegação é um `<a>` comum e o ingress cai no
`index.html` em qualquer rota (fallback SPA).

## Login (hop SSO)

Login não é rota da SPA — o Access protege a API, não o frontend. O fluxo
(`src/lib/auth.ts`, padrão bet-frontend):

1. No load, o probe `GET {API}/api/me` com `redirect:"manual"` pergunta quem
   é o chamador: um `200` limpo = logado.
2. Sem sessão, o login é **navegação top-level** (nunca `fetch`, o login do
   Google não roda dentro de fetch/iframe) para
   `GET {API}/api/sso?return=<origem>` — o Access intercepta, faz o Google
   one-click e devolve o cookie do domínio da API; a rota `/api/sso` faz 302
   de volta. Dentro de iframe (hub) o hop quebra para a janela de topo.
3. `return` é **`window.location.origin`**, não a URL atual: depois do login
   a pessoa cai na raiz da SPA (a lista de sessões) — **sem deep link
   pós-login**. A origem inteira é o que a API aceita no allowlist do
   redirect.
4. Se o hop aconteceu e o probe **ainda** assim falha (cookie existe, mas a
   API recusa o JWT — aud/issuer mal configurados), `sessionStorage` marca
   "voltamos do hop" e o app mostra estado de erro com retry em vez de
   entrar em loop de redirects. "Tentar de novo" limpa a marca e hopa de
   novo.

## Rodando local

```bash
npm install
npm run dev
```

`vite.config.ts` proxia `/api` para `http://localhost:8010` — suba a
`harness-api` com o bypass de auth (`go run .` na pasta dela, ver o README
dela) nessa porta e não precisa setar `VITE_HARNESS_API_URL` nenhuma pra
desenvolver local.

## Build

```bash
npm run build   # tsc -b && vite build -- gera dist/
```

Em produção, `VITE_HARNESS_API_URL` (`https://harness-api.giomartins.dev`) é
passado como variável de ambiente do próprio `npm run build` — veja
`.github/workflows/ts-frontend-ci-cd.yml`. É baked no bundle em build time:
trocar a URL da API = novo build.

## Deploy

O `ts-frontend-ci-cd.yml` tem este app em `ALLOWED_APPS` e no filtro de
paths; o job de deploy espelha `dist/` para o bucket `harness-frontend` com
`mc mirror` e `VITE_HARNESS_API_URL` apontando para a API. Detalhe do
**primeiro deploy**: o bucket só passa a existir no `terraform apply`
(`null_resource` com `mc mb`), então aplique o Terraform **antes** de tocar
no `modules/apps/harness-frontend/` — ou reexecute o job de deploy do
frontend depois do apply (corrida bucket vs `mc mirror`, ver
`docs/novo-app-ci-cd.md` §8).