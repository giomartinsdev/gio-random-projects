# Quickstart: validando o FC Clubs Hub

Guia de validação funcional ponta a ponta, local e em produção. Não contém
código de implementação — os passos assumem que os 2 serviços novos, o
`domain-api`/`domain-worker` estendidos e o `clubs-frontend` já existem
(pós-implementação).

## Pré-requisitos

- Postgres e Redis compartilhados rodando (mesmo `compose.yaml` da raiz de
  `modules/apps`, como qualquer app do repo).
- `domain-api` e `domain-worker` rodando com os agregados novos aplicados
  (o `schema.sql` idempotente de cada um, aplicado por `Migrate()` — não há
  migrations versionadas neste repo: são as tabelas `clubs`, `clubs_matches`,
  `clubs_match_players`, `clubs_snapshots`, `clubs_preferences` e as demais de
  `data-model.md`).
- Uma chave `X-API-Key` por serviço: `clubs_api_domain_key` e
  `clubs_ingest_domain_key` (variáveis de ambiente de cada um — ver seus
  `.env.example`).
- Bypass de auth de desenvolvimento ligado no `clubs-api`
  (`CLUBS_DEV_BYPASS_AUTH=1` + `CLUBS_DEV_USER_EMAIL`), como já é padrão
  em `harness-api`, para não depender do provedor de identidade local.
- **Acesso à origem de dados** (a API pública de Pro Clubs). Não exige
  credencial, mas exige que a requisição se pareça com a de um navegador — o
  client vendorizado já cuida disso. Se a origem estiver bloqueando o seu IP,
  o Cenário 1 não passa; nesse caso valide com as fixtures (Cenário 0).

## Setup local

```sh
# worker de ingestão
cd modules/apps/clubs-ingest
pip install -e ".[dev]"
CLUBS_INGEST_DOMAIN_API_URL=http://localhost:8000 CLUBS_INGEST_DOMAIN_API_KEY=dev \
  python -m clubs_ingest.main

# API
cd modules/apps/clubs-api
CLUBS_DOMAIN_API_URL=http://localhost:8000 CLUBS_DOMAIN_API_KEY=dev \
CLUBS_DEV_BYPASS_AUTH=1 CLUBS_DEV_USER_EMAIL=dev@local \
go run .

# frontend
cd modules/apps/clubs-frontend
npm install && npm run dev
```

---

## Cenário 0 — Mapeamento da origem (sem rede, US1)

O mais rápido de validar e não depende da origem responder.

```sh
cd modules/apps/clubs-ingest && python -m pytest -q
```

**Esperado**: os testes de mapeamento passam. Especificamente:

1. Cada um dos cinco códigos de resultado (`1`, `2`, `4`, `16385`, `10`) vira
   `vitoria`/`empate`/`derrota` + a flag de desistência correta (FR-017).
2. Uma partida amistosa (sem marcação de resultado) tem o resultado derivado de
   gols pró vs gols sofridos.
3. Uma posição numérica conhecida vira o enum de posição; um código
   desconhecido **não** quebra o mapeamento (FR-017).
4. Uma fixture com campo ausente **falha aquele clube isoladamente**, e o ciclo
   segue (FR-032).

---

## Cenário 1 — Ingestão traz um clube (US1, SC-007)

1. Com o worker e a API rodando, adicione um clube que você conhece à base
   (via `POST /clubs` na `domain-api`, ou seguindo-o na SPA já logada).
2. Aguarde um ciclo (ou reduza `CLUBS_INGEST_POLL_SECONDS` para 30s em dev).
3. **Esperado**:
   - O clube sai de `acompanhado=false` para `true` em no máximo um ciclo
     (SC-007).
   - `GET /api/clubes/{club_id}` devolve campanha, divisão atual e melhor,
     nível e sequências (FR-003).
   - `GET /api/clubes/{club_id}/elenco` devolve os jogadores com jogos, gols,
     assistências, nota média e overall (FR-004).
   - `GET /api/clubes/{club_id}/partidas` devolve as partidas com placar,
     adversário, tipo e a marcação de desistência quando houver (FR-005).
   - `GET /api/partidas/{match_id}` devolve a súmula com os **dois** times
     (FR-005, FR-018).
4. Rode um segundo ciclo.
   - **Esperado**: o número de partidas **não dobra** — a mesma partida vista de
     novo é atualização, não inserção (FR-018).
   - **Esperado**: um novo registro aparece em `clubs_snapshots` (FR-009).

---

## Cenário 2 — Home pública, sem login (US1, SC-001, SC-002)

1. Abra a home **numa janela anônima**, sem autenticar nada.
2. **Esperado**: anúncios e o ranking global de clubes carregam (FR-001).
3. Cronometre: home abaixo de 2s; troca de métrica abaixo de 1s (SC-002).
4. Alterne o ranking para jogadores — **esperado**: lista com clube, posição e
   nota média, ordenada por nota (FR-007).
5. Troque a métrica de clubes para "pontos" — **esperado**: reordena sem
   recarregar a página (FR-007).
6. Conte as interações até chegar ao perfil de um clube específico a partir da
   home — **esperado**: no máximo 3 (SC-001).

**Cenário de base vazia**: com a base recém-criada (nenhuma partida ainda),
recarregue a home — **esperado**: estados vazios explicativos, nunca erro nem
número inventado (cenário 4 da US1).

---

## Cenário 3 — Navegação pública completa (US2, SC-010)

1. Na área de clubes, digite `uniao` (sem acento).
   - **Esperado**: encontra "União da Serra" (SC-008, FR-002).
2. Abra o perfil do clube, percorra as quatro abas (Resumo, Elenco, Partidas,
   Números) — **esperado**: todas carregam, e os dados batem entre elas.
3. Do elenco, clique num jogador.
   - **Esperado**: perfil com forma recente, gols por jogo, acerto de passe e
     desarme; se for goleiro, o detalhamento de defesas por tipo (FR-006).
4. Volte e abra uma partida — **esperado**: súmula dos dois lados, linha do
   tempo e comparativo de estatísticas (FR-005).
5. Copie a URL da partida, abra em outra aba e recarregue; depois use o botão
   voltar do navegador.
   - **Esperado**: a mesma tela em todos os casos (FR-037, SC-010).
6. Abra um clube que **não** foi acompanhado (só apareceu numa busca).
   - **Esperado**: apenas os totais gerais, com explicação explícita de que
     elenco e partidas ainda não foram trazidos — nunca tela vazia (FR-008).
7. Reduza a janela para largura de celular.
   - **Esperado**: navegação vira compacta e não há rolagem horizontal (FR-036).

---

## Cenário 4 — Histórico, recordes e confrontos (US3)

Este cenário exige que o worker já tenha rodado algumas vezes. Uma alternativa
rápida em dev é inserir snapshots manualmente via `POST
/clubs/{club_id}/snapshots` para simular dias de histórico.

1. Abra a aba de números de um clube.
2. **Esperado**: o gráfico de evolução mostra o nível ao longo do tempo, com
   pico, fundo e variação recente (FR-009).
3. Confira a lista de mudanças de divisão — **esperado**: subidas e quedas
   aparecem como eventos datados, com promoção distinguida de rebaixamento
   (FR-010).
4. Confira os recordes — **esperado**: maior goleada, pior derrota, jogo com
   mais gols, melhor nota individual e maior sequência, cada um com adversário e
   data (FR-011).
5. Escolha um rival no comparador — **esperado**: retrospecto direto (V/E/D,
   gols) e comparação de estatísticas entre os dois (FR-012).
6. Abra a evolução de um jogador — **esperado**: gols por temporada (FR-013).
7. **Caso de borda**: com apenas **um** snapshot de um clube, abra a evolução —
   **esperado**: mostra o valor atual e explica que o histórico cresce a cada
   atualização, em vez de desenhar um gráfico degenerado (cenário 5 da US3).

---

## Cenário 5 — Login e sincronização em segundo plano (US4, SC-004)

1. Como visitante, acione "Entrar com Google".
   - **Esperado**: volta ao hub autenticada, **na mesma tela onde estava**
     (cenário 1 da US4, FR-020).
2. **Esperado**: o indicador de sincronização aparece e progride pelos três
   níveis — seus clubes, rivais diretos, rivais dos rivais (FR-021, FR-022).
   - Você consegue continuar navegando o tempo todo; o indicador não bloqueia
     nada.
3. Cronometre: clubes próprios e rivais diretos navegáveis em menos de 5 min;
   terceiro nível em até 15 min (SC-004).
4. Abra um clube que só apareceu por causa da sincronização.
   - **Esperado**: elenco, partidas e números completos, como qualquer clube já
     conhecido (cenário 3 da US4).
5. Siga um clube e recarregue a página.
   - **Esperado**: continua seguido e aparece na sua lista (FR-023).
6. Reivindique o seu pro e abra a página daquele jogador.
   - **Esperado**: aparece a marca de verificado (FR-024).
7. Abra a mesma página numa janela anônima.
   - **Esperado**: **sem** a marca de verificado — ela é da conta, não do
     jogador (FR-024, FR-025).
8. Saia e confira que o hub volta ao estado de visitante sem quebrar a tela
   (FR-026).

> **Não é bug**: sem login, sincronização e "meus clubes" não existem. É o
> desenho — o hub é uma enciclopédia pública; o login o torna pessoal.

---

## Cenário 6 — Notificações (US5)

1. Autenticada, abra as notificações e ligue o resumo semanal.
2. **Esperado**: a preferência persiste ao recarregar (FR-027).
3. **Caso de borda**: deixe o canal de notificação **em branco** e force um
   evento (uma partida nova).
   - **Esperado**: o hub opera normalmente, sem erro na tela nem no log de
     ingestão (FR-029).
4. Configure um canal de teste e force um evento.
   - **Esperado**: a mensagem chega no canal, com o fato que a originou
     (FR-028).

---

## Cenário 7 — Administração (US5, FR-030)

1. Autenticada como pessoa **autorizada**, abra a área de administração.
2. **Esperado**: painel com clubes acompanhados, pendentes, volume de partidas
   e o estado do cache por tipo de consulta (FR-031).
3. Abra as abas de integração, histórico, experimentos e decisões.
   - **Esperado**: cada uma explica a decisão correspondente — nada de tela
     vazia (FR-035).
4. Repita o passo 1 numa conta **não** autorizada.
   - **Esperado**: mensagem de acesso restrito e **nenhum dado técnico** —
     confira pelo menos que as rotas de leitura técnica respondem `403`
     (FR-030).

---

## Cenário 8 — Tema claro e escuro (FR-033, SC-009)

1. Alterne o tema.
2. **Esperado**: nenhum texto ilegível — todos os pares de contraste atendem ao
   mínimo de acessibilidade (SC-009).
3. **Esperado**: a preferência de tema sobrevive a um recarregar.

---

## Cenário 9 — Origem indisponível (SC-006, FR-019)

1. Com dados já carregados, bloqueie o acesso à origem (ex.: variável apontando
   para um host inválido, ou desconecte a rede) e rode um ciclo.
2. **Esperado**: o ciclo registra a falha e **não** apaga nem corrompe o que já
   está na base (FR-019, FR-032).
3. Recarregue todas as telas do hub.
   - **Esperado**: tudo continua servindo, com a marcação de desatualizado
     visível (SC-006).
4. Restaure o acesso e rode outro ciclo.
   - **Esperado**: a atualização volta sozinha, sem intervenção.

---

## Cenário 10 — Verificação de deploy (o passo que engana)

Não confie no check verde do pipeline. Confira o que está servindo de verdade:

```sh
curl -s https://clubs-api.giomartins.dev/healthz
curl -s https://clubs.giomartins.dev/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

O segundo comando precisa devolver um hash **diferente** do build anterior. Se
devolver o mesmo, o container/SPA não foi recriado — é o sintoma clássico de
`-replace` faltando no `case` do workflow (já aconteceu com o `tela-api`).

Se o primeiro deploy falhar por corrida (o `tf-ci-cd` tentando criar o
container antes da imagem existir), é esperado. Rode à mão:

```sh
gh workflow run go-ci-cd.yml -f app=clubs-api
gh workflow run python-ci-cd.yml -f app=clubs-ingest
gh workflow run ts-frontend-ci-cd.yml -f app=clubs-frontend
```
