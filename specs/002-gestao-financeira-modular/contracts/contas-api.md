# Contrato: contas-api

BFF do módulo Contas (US1). Sem banco próprio — repassa tudo para a
domain-api (ver [`domain-api-extensions.md`](./domain-api-extensions.md)).
Autenticação Cloudflare Access na mesma linha de `bet-api`/`harness-api`
(JWT validado no próprio serviço a partir de `Cf-Access-Jwt-Assertion`).

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /api/health` | saúde, sem auth | — |
| `GET /api/me` | identidade do chamador (probe de login do frontend) | FR-001 |
| `GET /api/sso` | hop de login (302 para `?return=` se a origem é allowlistada) | FR-001 |
| `GET /api/contas` | lista as contas da pessoa usuária logada (`?status=ativa\|arquivada`) | FR-010, FR-011 |
| `POST /api/contas` | cria conta `{nome, tipo}` | FR-010 |
| `PATCH /api/contas/{id}` | edita `nome` | FR-011 |
| `POST /api/contas/{id}/arquivar` | arquiva em vez de excluir | FR-012 |
| `GET /api/contas/{id}/saldo` | saldo/valor consolidado (agrega transações e/ou posições via os outros módulos, ou via leitura direta na domain-api) | FR-013 |

**Erros**: `422` para `tipo` inválido; `409` ao tentar arquivar uma conta
já arquivada; `423`/`409` ao tentar excluir definitivamente uma conta com
vínculos (a API não expõe DELETE físico — só `arquivar`, por design,
FR-012).
