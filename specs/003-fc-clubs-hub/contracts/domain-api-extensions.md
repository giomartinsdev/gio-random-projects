# Contrato: domain-api — extensões para o FC Clubs Hub

Cinco agregados novos no `domain-api`/`domain-worker` compartilhados, seguindo
o padrão de `cch_rooms`/`contas`/`transacoes`: o `clubs-api` e o `clubs-ingest`
não têm driver de banco — falam HTTP com `X-API-Key` própria.

**Chave nova**: `clubs_api_domain_key` em `secrets.tf`, uma por serviço
(`clubs-api` e `clubs-ingest` ganham cada um a sua, o mesmo raciocínio de
`contas_api_domain_key`), para que o log de auditoria distinga quem escreveu.

**Sincronismo por operação** (mesma regra de `contas-api`): operações onde a
pessoa espera o resultado imediato (criar/salvar) usam `POST /sync`, que só
responde depois da gravação. Alto volume sem expectativa de retorno imediato
(snapshot a cada ciclo) usa o caminho assíncrono padrão (`202`).

| Agregado | Tabela | Escrita | Por quê esse modo |
|---|---|---|---|
| `clube` | `clubs` | `/sync` | o ciclo precisa saber que o clube existe antes de gravar partida dele |
| `partida` | `clubs_matches` | `/sync` | idempotente por `match_id`; o ciclo precisa saber se inseriu ou atualizou |
| `linha_partida` | `clubs_match_players` | `/sync` | vai no mesmo lote da partida; separar deixaria partida sem súmula |
| `clube_snapshot` | `clubs_snapshots` | **`202` assíncrono** | alto volume, append-only, ninguém espera a resposta |
| `preferencia` | `clubs_preferences` | `/sync` | a pessoa clica "seguir" e espera ver mudado |

---

## Rotas de escrita (consumidas por `clubs-ingest` e `clubs-api`)

| Rota | O que faz | Modo |
|---|---|---|
| `POST /clubs` | cria/atualiza um clube (chave `club_id`) — FR-015 | `/sync` |
| `POST /clubs/{club_id}/totais` | grava os totais gerais — FR-008, FR-015 | `/sync` |
| `POST /clubs/{club_id}/matches` | grava um lote de partidas **com as linhas de jogador dos dois lados** — FR-005, FR-018 | `/sync` |
| `POST /clubs/{club_id}/matches/{match_id}/lances` | grava a linha do tempo da partida — FR-005 | `/sync` |
| `POST /clubs/{club_id}/snapshots` | grava uma leitura de nível/divisão e computa o diff — FR-009, FR-010 | `202` |
| `POST /clubs/{club_id}/anuncios` | grava um anúncio derivado — FR-001 | `202` |

**Contrato do lote de partidas** (a rota mais importante — é o que garante
FR-018 e a atomicidade da súmula):

```json
{
  "match_id": "1000000000001",
  "timestamp": "2026-09-21T21:30:00Z",
  "tipo": "liga",
  "rodada_playoff": null,
  "casa": { "club_id": "1001", "gols": 4, "resultado": "vitoria" },
  "fora":  { "club_id": "2001", "gols": 0, "resultado": "derrota" },
  "houve_desistencia": true,
  "vencedor_por_desistencia_id": "1001",
  "jogadores": [
    {
      "club_id": "1001", "player_id": "9000003", "gamertag": "Player1",
      "posicao": "defensor", "nota": 6.00, "gols": 0, "assistencias": 0,
      "chutes": 0, "passes_certos": 3, "passes_tentados": 3,
      "desarmes_certos": 2, "desarmes_tentados": 2,
      "defesas": 0, "defesas_por_tipo": null, "segundos_jogados": 655,
      "melhor_em_campo": false, "cartao_vermelho": false,
      "jogo_sem_sofrer_gol": true
    }
  ]
}
```

**Erros**: `422` para `resultado`/`tipo`/`posicao` fora do enum; `409` em
`match_id` já existente com conteúdo divergente (a origem não deveria reescrever
uma partida, e se reescrever queremos saber); `404` em rota cujo `club_id` não
existe.

---

## Rotas de leitura (consumidas por `clubs-api`)

Todas filtram por clube ou por `usuario_email` — nunca devolvem dado de outra
pessoa (FR-025).

| Rota | O que devolve |
|---|---|
| `GET /clubs` | lista de clubes acompanhados + totais |
| `GET /clubs/{club_id}` | um clube com totais, campanha e sequências |
| `GET /clubs/{club_id}/squad` | elenco agregado das linhas de partida — FR-004 |
| `GET /clubs/{club_id}/matches?tipo=&limite=` | partidas com placar e resultado — FR-003 |
| `GET /clubs/{club_id}/matches/{match_id}` | súmula completa, dois lados — FR-005 |
| `GET /clubs/{club_id}/snapshots?desde=` | série de nível e divisão — FR-009 |
| `GET /clubs/{club_id}/divisoes` | mudanças de divisão datadas — FR-010 |
| `GET /clubs/{club_id}/recordes` | recordes computados — FR-011 |
| `GET /clubs/{club_id}/h2h/{rival_id}` | retrospecto direto — FR-012 |
| `GET /clubes/rankings?metrica=` | ranking global de clubes — FR-007 |
| `GET /jogadores/rankings?metrica=&posicao=` | ranking global de jogadores — FR-007 |
| `GET /jogadores/{player_id}` | perfil, forma, por-temporada, defesas por tipo — FR-006, FR-013 |
| `GET /jogadores?q=` | busca no índice cross-club — FR-002 |
| `GET /anuncios` | feed da home — FR-001 |
| `GET /preferencias` | watchlist e avisos da pessoa autenticada — FR-023, FR-027 |
| `GET /sync/status` | estado da última sincronização da pessoa — FR-022 |

**Erros**: `404` em clube/jogador/partida inexistente; `403` quando a rota exige
identidade e ela não veio; `412`/`400` para parâmetros inválidos.

---

## Índices que o contrato pressupõe

| Consulta | Índice |
|---|---|
| Série de evolução | `clubs_snapshots (club_id, lido_em desc)` |
| Partidas de um clube | `clubs_matches (clube_casa_id, timestamp desc)` e `(clube_fora_id, timestamp desc)` |
| Súmula | `clubs_match_players (partida_id, club_id)` |
| Índice cross-club | `clubs_match_players (player_id)` |
| Watchlist | `clubs_preferences (usuario_email)` |
| Recordes (maior goleada) | `clubs_matches (clube_casa_id, gols_casa)` — a consulta varre por clube, não global |
