# Contrato: clubs-api

BFF do FC Clubs Hub. Sem banco próprio — lê da `domain-api` (ver
[`domain-api-extensions.md`](./domain-api-extensions.md)).

**Modelo de acesso** (ver `research.md` §5): as rotas **públicas** respondem sem
identidade alguma — é o que permite FR-001. As rotas **pessoais** exigem o token
do provedor de identidade e são publicadas atrás de um escopo de caminho
(`clubs-api.giomartins.dev/api`), no mesmo desenho de `bet-api`.

Sem lib de autenticação compartilhada: o middleware é copiado do padrão
`bet-api`/`harness-api`, como é a convenção do repositório. Bypass de
desenvolvimento por variável de ambiente (`CLUBS_DEV_BYPASS_AUTH=1` +
`CLUBS_DEV_USER_EMAIL`), mesmo padrão de `harness-api`, para não depender do
provedor de identidade local.

## Públicas (sem identidade)

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /healthz` | saúde + contadores de base | — |
| `GET /api/clubes?q=` | busca por nome, tolerante a acento e caixa | FR-002 |
| `GET /api/clubes/{club_id}` | clube + totais + campanha + sequências | FR-003 |
| `GET /api/clubes/{club_id}/elenco` | elenco agregado | FR-004 |
| `GET /api/clubes/{club_id}/partidas?tipo=&limite=` | partidas do clube | FR-003 |
| `GET /api/partidas/{match_id}` | súmula dos dois lados | FR-005 |
| `GET /api/clubes/{club_id}/evolucao` | série de nível e divisão | FR-009 |
| `GET /api/clubes/{club_id}/divisoes` | mudanças de divisão datadas | FR-010 |
| `GET /api/clubes/{club_id}/recordes` | recordes computados | FR-011 |
| `GET /api/clubes/{club_id}/confrontos/{rival_id}` | retrospecto direto | FR-012 |
| `GET /api/rankings/clubes?metrica=` | ranking global de clubes | FR-007 |
| `GET /api/rankings/jogadores?metrica=&posicao=` | ranking global de jogadores | FR-007 |
| `GET /api/jogadores?q=` | índice cross-club | FR-002 |
| `GET /api/jogadores/{player_id}` | perfil do jogador | FR-006, FR-013 |
| `GET /api/anuncios` | feed da home | FR-001 |

**Métricas aceitas**: clubes — `nivel`, `pontos`, `aproveitamento`, `gols`,
`jogos_sem_sofrer`; jogadores — `nota`, `gols`, `assistencias`, `overall`,
`gols_por_jogo`. Métrica desconhecida cai no default (`nivel` / `nota`) em vez
de erro — ranking é leitura pública, não vale quebrar a home por query string.

**Degradação**: com a base vazia (primeiro dia), as rotas devolvem listas vazias
e um objeto de estado, nunca `500` — é o que sustenta o cenário 4 da US1.

## Pessoais (exigem identidade)

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /api/me` | identidade do chamador (probe de login da SPA) | FR-020 |
| `GET /api/sso` | hop de login (302 para `?return=` se a origem é allowlistada) | FR-020 |
| `GET /api/minha-area` | pro reivindicado + resumo | FR-024 |
| `GET /api/preferencias` | watchlist + avisos | FR-023, FR-027 |
| `POST /api/preferencias/watchlist` | segue/deixa de seguir `{club_id, seguindo}` | FR-023 |
| `POST /api/preferencias/notificacoes` | liga/desliga avisos individualmente | FR-027 |
| `POST /api/minha-area/pro` | reivindica `{club_id, player_id}` | FR-024 |
| `GET /api/sync/status` | progresso da sincronização (polling da SPA) | FR-022 |
| `POST /api/sync` | dispara a sincronização sob demanda | FR-021 |

**Contrato de `/api/me`**: `200` com a identidade quando autenticado, `401` ou
redirecionamento opaco quando não. A SPA usa exatamente isso para decidir se
mostra o estado de visitante ou de conectado — mesmo truque do probe `/sso` do
hub e do `/api/me` do bet-api.

**Contrato de `/api/sync/status`** (o que a SPA desenha como indicador):

```json
{
  "rodando": true,
  "nivel": 2,
  "niveis": { "1": "seus clubes", "2": "rivais", "3": "clubes de clubes" },
  "total": 16, "concluidos": 9,
  "atual": "Porto Rival",
  "novos": ["Botafogo Jr", "Cruzeiro do Vale"],
  "concluido_em": null
}
```

## Restrições

- **Nada de termo técnico na resposta pública.** A API devolve dado; a SPA
  decide como nomear (FR-034). Nenhum campo chamado `snapshot`, `ingest` ou
  `cache` vaza para o payload de leitura.
- **Sem escrita pública.** As rotas de escrita de dado de clube existem só no
  `domain-api`, acessível por chave de serviço — a `clubs-api` não as expõe.
- **Nível de exposição**: o `clubs-api` é o único host novo com ingress. O
  worker de ingestão não tem host.
