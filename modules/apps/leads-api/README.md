# leads-api

Captura de e-mail da landing page pública de `financas-frontend`
(`financas.giomartins.dev/`). É o único backend do produto financeiro
que **não** fica atrás do Cloudflare Access — quem preenche o
formulário ainda não é uma pessoa usuária autenticada, então não há
sessão de Access para exigir. A única porta de entrada é
`POST /api/leads`; sem banco de dados próprio, sem JWT, sem cookie.

## Como funciona

Cada submissão vira um comando `lead.create` publicado via
`POST /sync` na `domain-api` compartilhada (mesmo pipeline de
persistência que `contas-api`/`transacional-api`/etc. usam, só que sem
nenhuma leitura — este serviço nunca lista os leads capturados,
somente escreve). O agregado `lead` vive no `domain-worker`
(`internal/domain/lead`), validando o formato do e-mail antes de
gravar; um e-mail repetido não vira um segundo registro (`ON CONFLICT
(email) DO NOTHING`).

Proteção contra abuso: como a rota é pública por design, um rate
limiter simples em memória (`internal/httpapi`'s `ipRateLimiter`, 5
tentativas por IP por minuto) evita que um bot esgote o pipeline de
comandos. CORS responde só para os origins em
`LEADS_FRONTEND_ORIGINS` — sem `Access-Control-Allow-Credentials`,
porque não existe cookie de sessão para atravessar a origem cruzada
aqui.

## API REST

| Rota | O que faz |
| --- | --- |
| `GET /api/health` | saúde, sem auth |
| `POST /api/leads` `{email}` | captura um e-mail; `201` capturado, `202` publicado mas ainda confirmando, `422` e-mail inválido, `429` rate limit, `502` domain-api indisponível |

## Configuração

| Env | Padrão | O que é |
| --- | --- | --- |
| `PORT` | `8015` | porta de escuta |
| `BIND_HOST` | vazio (todas) | em produção `127.0.0.1` (nginx na frente) |
| `LEADS_FRONTEND_ORIGINS` | vazio | origens do financas-frontend — CORS |
| `LEADS_DOMAIN_API_URL` | vazio | base da domain-api (produção `http://domain-api:8000`, container-to-container na rede `apps`) |
| `LEADS_DOMAIN_API_KEY` | vazio | `X-API-Key` própria deste serviço |

## Desenvolvimento

```sh
go build ./... && go vet ./... && go test ./...
LEADS_DOMAIN_API_URL=http://localhost:8000 LEADS_DOMAIN_API_KEY=dev \
LEADS_FRONTEND_ORIGINS=http://localhost:5173 PORT=8015 go run .
```
