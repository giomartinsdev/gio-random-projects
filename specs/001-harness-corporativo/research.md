# Research — Harness Corporativo (specs/001-harness-corporativo)

Fonte: varredura do repo (cch-api, bet-api, hub-frontend, terraform, workflows, `docs/novo-app-ci-cd.md`). Cada decisão no formato Decision/Rationale/Alternatives. Decisões de produto (sessão = handoff, Go+React, deploy no VPS) foram fechadas com o dono em 2026-09-11 e não são repetidas aqui.

## D1 — Roteador HTTP: stdlib `net/http` ServeMux

**Decision**: mux padrão do Go 1.25 com patterns `METHOD /path/{id}` (como `cch-api/internal/httpapi/server.go`), handlers como métodos de um `Server`, helpers `writeJSON`/`decodeJSON`/`writeError`, CORS como único middleware.

**Rationale**: convenção do repo — cch-api e tela-api usam exatamente isso; zero dependência; Go 1.22+ cobre wildcard e método sem lib.

**Alternatives**: `go-chi/chi` (mais ergonômico, mas desvia da convenção sem ganho real para ~8 rotas).

## D2 — Driver SQLite: `modernc.org/sqlite` (pure Go)

**Decision**: usar `modernc.org/sqlite` (transpile de C para Go, sem CGO).

**Rationale**: os Dockerfiles do repo compilam com `CGO_ENABLED=0` sobre `gcr.io/distroless/static` (cch-api/Dockerfile) — `mattn/go-sqlite3` exige CGO e quebraria esse padrão. Pure-Go mantém o build estático idêntico ao dos apps existentes. Volume docker (shape `cch-state`) persiste o arquivo do banco em `/data`.

**Alternatives**: `mattn/go-sqlite3` (CGO — rejeitado); trocar para Postgres+container extra (overkill para time interno; reavaliar se houver concorrência de escrita real).

## D3 — Autenticação: padrão bet-api (JWT do Cloudflare Access validado na API + hop `/api/sso`)

**Decision** (espelha `bet-api/src/lib/accessAuth.ts` + `bet-api/src/routes/auth.ts`):

- Terraform: hostname bare `harness-api.giomartins.dev` em `excluded_hostnames`; entrada `harness-api.giomartins.dev/api` em `path_protected_hostnames` (locals.tf) — um único Access app cobre o hop de login e o probe, porque o cookie `CF_Authorization` é por domínio e o `aud` do JWT é por Access app (constraint documentada em `locals.tf:257-264`).
- API (Go): ler header `Cf-Access-Jwt-Assertion`, buscar JWKS em `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, verificar assinatura + issuer `https://<team>.cloudflareaccess.com` + `aud` (env `HARNESS_ACCESS_AUD`, vindo de `module.cloud_cloudflare.access_app_auds["harness-api.giomartins.dev/api"]`, como em `compute/apps/bet_api/main.tf:281`). Claims usados: `email`, `name`. Allowlist de e-mails como defesa extra (env, igual ao bet).
- Login hop: `GET /api/sso` → 302 de volta para origem allowlistada (`HARNESS_FRONTEND_ORIGINS`) — a navegação top-level pelo `/api/sso` é interceptada pelo Access (Google one-click). Frontend: probe `fetch("/api/me", {redirect:"manual"})`; 200 = logado; caso contrário `window.top.location.href = "<api>/api/sso?return=..."`.
- Dev local: bypass via env (`HARNESS_DEV_BYPASS_AUTH=1` + `HARNESS_DEV_USER_EMAIL/NOME`), mesmo espírito do `BET_DEV_AUTH_EMAIL`.

**Rationale**: é o padrão já operando em produção no repo para o caso exato "SPA estática + API atrás do Access com sessão compartilhada".

**Alternatives**: hostname inteiro atrás do Access (bloqueia o hop do frontend e CORS preflight sem cookie); revalidar só o cookie `CF_Authorization` (criptografado, sem claims úteis — precisa do JWT).

**Lib Go para JWT/JWKS**: `github.com/MicahParks/keyfunc/v3` + `github.com/golang-jwt/jwt/v5` — replica o fluxo `jose.createRemoteJWKSet`/`jwtVerify` do bet-api. **Alternatives**: `coreos/go-oidc/v3` (assume discovery OIDC; aqui o contrato é JWKS direto + issuer/aud, então keyfunc é mais fiel e com menos suposições).

## D4 — Frontend: SPA estática em bucket MinIO (sem container), `react-markdown` para sanitização

**Decision**: `harness-frontend` é SPA estática como os outros 5 frontends do repo — build Vite espelhado por `ts-frontend-ci-cd` (`mc mirror`) para bucket `harness-frontend`; nginx ingress serve assets e fallback `index.html` (`compute/services/ingress/README.md`). Sem Dockerfile.

- `vite.config.ts` no formato cch/bet: alias `@`→`src`, dev proxy `/api` → `http://localhost:8010`, `VITE_HARNESS_API_URL` em produção (vazio local = relativo).
- Markdown do contexto renderizado com `react-markdown` (renderiza elementos React, **sem** `dangerouslySetInnerHTML` — XSS impossível por construção; FR-011). Links externos com `rel="noopener noreferrer" target="_blank"`.
- Chamadas com `credentials: "include"` (cookie do Access cross-origin), probe/hop conforme D3.

**Rationale**: é como todos os frontends do repo são servidos; a API é cross-origin no bet e funciona em produção.

**Alternatives**: container nginx servindo a SPA (desvia do padrão; sem ganho); `marked`+`DOMPurify` (sanitização por blacklist de HTML — react-markdown é segura por construção).

## D5 — Infra Terraform: onde cada peça entra

**Decision** (seguindo `docs/novo-app-ci-cd.md` §3–§4):

| Peça | Arquivo | O quê |
|---|---|---|
| DNS/ingress | `locals.tf` → `services` | `harness-api.giomartins.dev → 8010` |
| Site estático | `locals.tf` → `static_sites` | `harness-frontend` (bucket = nome da pasta) |
| Access por path | `locals.tf` → `path_protected_hostnames` | `harness-api.giomartins.dev/api` |
| Hostname público do SPA | `variables.tf` → `excluded_hostnames` | `harness-api.giomartins.dev` (bare) + `harness-frontend.giomartins.dev` |
| Container + volume | `compute/apps/harness-api/{main,variables,versions,outputs}.tf` | shape bet_api (portas publicadas + rede `apps`) + `docker_volume` para `/data` (SQLite), port **8010** (próxima livre), env `HARNESS_ACCESS_AUD`, `HARNESS_FRONTEND_ORIGINS`, `HARNESS_ALLOWED_EMAILS`, label watchtower |
| Registro do módulo | `main.tf` raiz | `module "compute_apps_harness_api"` |

**Rationale**: `locals.tf` é a fonte de verdade de DNS/Access/static sites; o shape "published port + rede apps" é o usado pelo bet_api que também valida Access JWT e fala com SPA estática.

**Alternatives**: host network (shape tela/cch — sem rede compartilhada, desnecessário aqui).

**Race do primeiro deploy** (`docs/novo-app-ci-cd.md` §8 + `static_sites.tf`): o bucket `harness-frontend` só existe depois do `terraform apply` (`null_resource` com `mc mb`), mas o workflow do frontend espelha com `mc mirror` — na primeira vez pode espelhar antes do bucket existir. Mitigação: merge do Terraform (cria bucket + container) **antes** de tocar em `modules/apps/harness-frontend/`, ou reexecutar o job de deploy do frontend após o apply. O `-replace` do container do harness-api precisa da entrada no `case` do `go-ci-cd.yml` (~linha 313), senão o container nunca é recriado.

## D6 — CI/CD: o que exatamente muda nos workflows

**Decision**:

- `go-ci-cd.yml`: sem lista de apps (auto-descobre `go.mod` em `modules/apps/*/`); **adicionar** `harness-api` no `case` do `-replace` (~linha 313).
- `ts-frontend-ci-cd.yml`: **adicionar** `harness-frontend` em `ALLOWED_APPS` (linha 56), em `push.paths` (linhas 33–37) e `VITE_HARNESS_API_URL` no passo de Build (linhas ~123–133).
- `ts-backend-ci-cd.yml`: não se aplica (harness-api é Go).

**Rationale**: verificação direta nos arquivos; apps TS só rodam pipeline se estiverem em `ALLOWED_APPS` e nos paths.

## D7 — Identidade de usuário: cache `usuarios` derivado do JWT

**Decision**: sem cadastro; a API faz upsert de `email`/`name` na tabela `usuarios` a cada request autenticado (cache para exibir nomes de *outros* autores em timeline/listas).

**Rationale**: o JWT só traz a identidade do próprio chamador; sem cache, a UI não saberia o nome de quem retomou a sessão de outra pessoa.

**Alternatives**: guardar só e-mail e "embelezar" a parte local (perde nomes reais do Google); tabela de usuários com convite (YAGNI para time atrás do Access).

## D8 — Integração com o hub (opcional, fora do MVP core)

**Decision**: deixar o SPA iframe-friendly (sem redirect automático no hostname do frontend — o probe/hop cuida do login), registrando o app em `hub-frontend/src/lib/apps.ts` (`MICROFRONTENDS`) + `lib/hubTheme.ts` como fase opcional pós-MVP.

**Rationale**: barato de fazer depois (duas edições no hub) e o MVP já é útil standalone em `harness-frontend.giomartins.dev`.

## Pendências resolvidas do Technical Context

- ~~Roteador~~ → D1 · ~~Driver SQLite~~ → D2 · ~~Mecanismo de auth~~ → D3 · ~~Servir frontend~~ → D4 · ~~Wiring de infra/CI~~ → D5/D6
- Porta da API: **8010** (próxima livre; 8000–8009 em uso).
- Nomes de domínio: `harness-api.giomartins.dev` (API) e `harness-frontend.giomartins.dev` (SPA) — espelham o par bet-api/bet-frontend.