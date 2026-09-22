# Data Model: FC Clubs Hub

Todos os agregados abaixo são **novos agregados do `domain-worker`/`domain-api`
compartilhados** (tabelas no Postgres compartilhado, uma por agregado), seguindo
o padrão de `cch_rooms`/`cch_custom_decks`/`contas`/`transacoes`. Nenhum serviço
novo guarda estado durável próprio — o `clubs-api` apenas lê e orquestra, e o
`clubs-ingest` apenas escreve via `domain-api`.

## Identidade

Não é um agregado novo — é a identidade resolvida pelo provedor de acesso
(e-mail do token), reaproveitada como o campo `usuario_email` de particionamento
nas tabelas que guardam preferência (watchlist, pro reivindicado, avisos). Toda
leitura dessas tabelas é escopada por esse campo — é o mecanismo que garante
FR-025 (isolamento entre pessoas).

As tabelas de **dado público** (`clube`, `partida`, `linha_partida`,
`clube_snapshot`) **não** carregam `usuario_email` — são de todos, e é o que
permite a leitura anônima de FR-001.

## Clube

Um clube de Pro Clubs, acompanhado ou apenas conhecido.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | interno |
| `club_id` | text (unique) | o id da origem; a origem manda como texto e alguns parâmetros são singulares/plurais — normalizar aqui é o que FR-017 exige |
| `nome` | text | |
| `sigla` | text | 3 letras, usada nos escudos e nas listas densas |
| `estadio` | text, nullable | |
| `regiao_id`, `time_id` | text, nullable | identificadores da origem |
| `escudo_asset_id` | text, nullable | sem tabela publicada — guardado cru, a forma visual é escolhida por inferência |
| `cor_1`..`cor_4` | int, nullable | RGB decimal, como a origem envia; a conversão para hex é da camada de apresentação |
| `acompanhado` | boolean | false = só temos os totais gerais (FR-008) |
| `atualizado_em` | timestamp | última leitura bem-sucedida |

**Regras**: `acompanhado=false` é o estado inicial de qualquer clube descoberto
por busca. Vira `true` quando o ciclo de ingestão consegue trazer elenco e
partidas. Nunca é apagado — um clube que sai da watchlist apenas deixa de ser
atualizado.

**Relacionamentos**: 1 clube → N partidas; 1 clube → N snapshots; 1 clube → N
linhas de partida (via partida); N clubes ↔ N clubes via `rivalidade` (derivada
de partidas, não tabela própria).

## ClubeTotais

Os totais gerais que a origem devolve mesmo para clube não acompanhado (a busca
já os traz). Separado de `Clube` porque sua forma muda com menos frequência e
porque existe para clubes que nunca serão acompanhados.

| Campo | Tipo | Notas |
|---|---|---|
| `club_id` | text (FK lógica) | |
| `jogos`, `vitorias`, `empates`, `derrotas` | int | |
| `gols`, `gols_sofridos` | int | |
| `jogos_sem_sofrer` | int | |
| `pontos` | int | |
| `divisao_atual`, `melhor_divisao` | int | |
| `nivel` | int | o `skillRating` da origem |
| `promocoes`, `rebaixamentos` | int | contadores da origem |
| `lido_em` | timestamp | |

## Partida

Uma partida, **vista uma única vez** mesmo quando dois clubes acompanhados
jogaram entre si (FR-018).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | interno |
| `match_id` | text (unique) | o id da origem — a chave que garante FR-018 |
| `timestamp` | timestamptz | UTC; a origem manda em segundos desde a época |
| `tipo` | enum `liga`\|`amistoso`\|`playoff` | |
| `rodada_playoff` | text, nullable | |
| `clube_casa_id`, `clube_fora_id` | text | FKs lógicas para `Clube` |
| `gols_casa`, `gols_fora` | int | |
| `houve_desistencia` | boolean | DNF — FR-005 |
| `vencedor_por_desistencia_id` | text, nullable | |
| `resultado_casa` | enum `vitoria`\|`empate`\|`derrota` | normalizado de códigos numéricos sem tabela (FR-017) |
| `lances` | jsonb | a linha do tempo, extraída dos agregados de evento sem documentação |
| `criado_em` | timestamp | |

**Regras**: `resultado_casa` nunca é calculado na leitura — é gravado
normalizado no ingest, porque a origem usa cinco códigos numéricos diferentes
para três resultados e amistosos não trazem marcação alguma. Essa é a razão pela
qual FR-017 existe como requisito separado.

**Unicidade**: `match_id` unique é o que garante SC-018 — a segunda vez que a
mesma partida for vista, é atualização, não inserção.

## LinhaPartida

A atuação de um jogador numa partida. Uma linha por jogador por partida, **dos
dois times** (é daqui que sai o índice cross-club que a origem não oferece).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `partida_id` | uuid (FK para `Partida`) | |
| `club_id` | text | qual dos dois times |
| `player_id` | text | o id do jogador na origem |
| `gamertag` | text | |
| `posicao` | enum `goleiro`\|`defensor`\|`meio`\|`atacante` | traduzida do código numérico (FR-017) |
| `nota` | numeric(4,2) | |
| `gols`, `assistencias`, `chutes` | int | |
| `passes_certos`, `passes_tentados` | int | |
| `desarmes_certos`, `desarmes_tentados` | int | |
| `defesas` | int | goleiro |
| `defesas_por_tipo` | jsonb, nullable | os seis tipos separados — FR-006 |
| `segundos_jogados` | int | é o denominador para gols por 90 |
| `melhor_em_campo` | boolean | |
| `cartao_vermelho` | boolean | |
| `jogo_sem_sofrer_gol` | boolean | |

**Regras**: `defesas_por_tipo` só existe para goleiro — é um caso onde a origem
manda campos que só fazem sentido por posição. Guardar como jsonb evita seis
colunas vazias para todo mundo.

**Unicidade**: (`partida_id`, `player_id`) — a mesma pessoa vista de dois lados
não gera duas linhas.

## ClubeSnapshot

A leitura de nível e divisão de um clube num instante. **É o único dado que
torna a evolução possível** — a origem não guarda histórico (ADR #1).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `club_id` | text | |
| `lido_em` | timestamptz | |
| `nivel` | int | |
| `divisao` | int | |
| `jogos`, `vitorias`, `empates`, `derrotas` | int | congelados junto, para o histórico bater com o nível daquele momento |
| `gols`, `gols_sofridos` | int | |
| `tamanho_elenco` | int | permite detectar contratação/saída por diff |

**Regras**: append-only, nunca atualiza linha existente. A leitura nova é
comparada com a anterior do mesmo clube e, se `divisao` mudou, gera um
`MudancaDivisao`.

**Índice**: (`club_id`, `lido_em` desc) — é a consulta que alimenta o gráfico de
evolução.

## MudancaDivisao

Evento datado de subida ou queda, derivado do diff de snapshots (FR-010).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `club_id` | text | |
| `detectado_em` | timestamptz | |
| `de` , `para` | int | divisões |
| `tipo` | enum `promocao`\|`rebaixamento` | `para < de` = promoção |

## PreferenciaClube (watchlist)

| Campo | Tipo | Notas |
|---|---|---|
| `usuario_email` | text | dono — FR-025 |
| `club_id` | text | |
| `seguindo_desde` | timestamptz | |
| `origem` | enum `proprio`\|`rival`\|`rival_de_rival`\|`manual` | de qual nível do sync veio — alimenta a tela de Minha Área |

**Chave**: (`usuario_email`, `club_id`).

## ProReivindicado

| Campo | Tipo | Notas |
|---|---|---|
| `usuario_email` | text | |
| `club_id` | text | |
| `player_id` | text | |
| `verificado` | boolean | FR-024 — a marca só aparece para quem reivindicou |
| `verificado_em` | timestamptz, nullable | |

**Chave**: (`usuario_email`) — uma pessoa reivindica um pro, não vários.

## PreferenciaNotificacao

| Campo | Tipo | Notas |
|---|---|---|
| `usuario_email` | text | |
| `canal` | text, nullable | o canal externo; null = desligado (FR-029) |
| `resumo_periodico` | boolean | |
| `recordes_e_divisoes` | boolean | |
| `resultado_partidas` | boolean | |
| `atualizado_em` | timestamptz | |

## Anuncio

O feed da home (FR-001/FR-002).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | |
| `tipo` | enum `resultado`\|`ranking`\|`jogador`\|`novidade` | |
| `titulo`, `texto` | text | |
| `referencia_id` | text, nullable | clube, partida ou jogador a que se refere |
| `gerado_em` | timestamptz | |
| `expira_em` | timestamptz, nullable | |

**Regras**: gerado pelo próprio ingest a partir dos fatos que ele acabou de
gravar (um resultado novo, um recorde batido, uma mudança de divisão). Não é
curado a mão — é derivado, e por isso não tem endpoint de escrita pública.

---

## Diagrama de relacionamentos

```
Clube ──1:N──> Partida ──1:N──> LinhaPartida
  │                                  │
  │                                  └── player_id (índice cross-club)
  ├──1:N──> ClubeSnapshot ──diff──> MudancaDivisao
  └──1:N──> ClubeTotais

usuario_email ──N:M──> Clube         (PreferenciaClube / watchlist)
              ──1:1──> LinhaPartida   (ProReivindicado, via player_id)
              ──1:1──> PreferenciaNotificacao
```

## Estados e transições

**Clube**
```
desconhecido ──busca──> conhecido (acompanhado=false, só ClubeTotais)
                             │
                             └──ciclo de ingestão OK──> acompanhado=true
                                                          (elenco + partidas + snapshots)
```
Nunca volta para `desconhecido`. Sair da watchlist não muda `acompanhado` — só
para de atualizar.

**Partida**
```
vista (1º lado) ──> gravada
vista (2º lado) ──> atualizada (match_id unique, FR-018)
```

**Ciclo de ingestão (por clube, por tipo de consulta)**
```
válido (TTL não venceu) ──> reutiliza o que já está na base
vencido ──> consulta origem ──ok──> grava + snapshot + diff
                             └──falha──> registra, mantém último dado (FR-019/FR-032)
```

## O que o modelo deliberadamente NÃO tem

- **Tabela de jogador.** Um jogador não é agregado próprio: ele existe através
  das suas linhas de partida. É uma consequência direta de a origem não ter
  busca por jogador — o índice cross-club (F13 do protótipo) é derivado por
  agregação, não cadastrado.
- **Tabela de ranking.** Rankings são consultas sobre `Clube`/`LinhaPartida`, não
  dado materializado. Materializar exigiria uma política de invalidação para
  algo que a base responde em milissegundos nesta escala.
- **Tabela de rivalidade.** O histórico de confronto é agregação de `Partida` por
  par de clubes.
