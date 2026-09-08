# bet-api

BFF do sistema de apostas automatizadas (`bet-frontend` + `bet-runner`,
veja os READMEs de cada um). Cola um link de bet, o sistema enfileira a
aposta e o `bet-runner` executa num Chrome headless na mesma VPS.

## Auth

O hostname `bet-api.giomartins.dev` está atrás de uma aplicação
**Cloudflare Access** (Google SSO, `allowed_emails`, sessão 24h — o
mesmo modelo do `/sso` do hub). O edge carimba `Cf-Access-Jwt-Assertion`
em todo request que passa; `src/lib/accessAuth.ts` valida a assinatura
contra os certs públicos do team, o `aud` tag da app e o email. O email
do JWT É a conta (`bet_users.email`) — não existe cadastro separado, e é
por isso que a sessão é "única com o hub": mesma sessão Access, mesmo
usuário.

`BET_DEV_AUTH_EMAIL` é um atalho de dev/teste (identidade fixa sem
JWT) e **não pode ficar setado em produção**.

## Vendors (sem lock-in)

A única coisa que este BFF sabe sobre uma casa é o hostname dela
(`src/lib/vendors.ts`). Adicionar bet365/bet338 depois = uma entrada na
lista + um driver no `bet-runner`. Nada aqui é específico de Betano
além da string "betano".

## Fluxo da aposta

1. `POST /api/bets` `{url, units}` — resolve o vendor pelo hostname do
   link, exige credenciais salvas (`bet_credentials`, senha cifrada
   AES-256-GCM com `BET_CREDENTIALS_KEY`), cria a aposta com
   `stake_cents = units × valor-da-unidade` **congelado no momento da
   criação** (mudar o valor da unidade depois não reescreve história).
2. `POST /internal/jobs/claim` (header `X-Runner-Key`) — pega a aposta
   mais antiga em fila com `FOR UPDATE SKIP LOCKED`, devolve o bet com
   credenciais **decifradas**.
3. Runner executa e faz `POST /internal/jobs/:id/result` com
   `succeeded|failed` + receipt (passos, screenshot jpeg em base64,
   betRef/saldo quando o site mostrar).

## Env

| Var | Pra que |
| --- | --- |
| `DATABASE_URL` | Postgres compartilhado (tabelas `bet_*`) |
| `BET_ACCESS_TEAM_DOMAIN` | domínio do team Access (`...cloudflareaccess.com`) |
| `BET_ACCESS_AUD` | `aud` tag da Access app (output do módulo cloudflare) |
| `BET_ALLOWED_EMAILS` | emails permitidos (check redundante ao Access) |
| `BET_CREDENTIALS_KEY` | 32 bytes hex, cifra as senhas das casas |
| `RUNNER_API_KEY` | segredo compartilhado com o container `bet-runner` |
| `FRONTEND_ORIGINS` | origins de CORS e do redirect do `/auth/sso` |
| `BET_DEV_AUTH_EMAIL` | (só dev) identidade sem JWT |

Em prod o Terraform gera/injeta tudo (veja
`modules/compute/apps/bet_api`); local, copie `.env.example`.

## Dev

```bash
npm install
npx drizzle-kit generate   # após mexer em src/db/schema.ts
npm run dev                # precisa de DATABASE_URL apontando p/ um postgres local
npm test                   # testcontainers (docker necessário)
```

A migração roda como container one-shot `bet-api-migrate` declarado no
Terraform antes do container principal (mesmo padrão do post-api) —
migração nova só aplica com `-replace` no workflow (ver
`docs/novo-app-ci-cd.md` §6).