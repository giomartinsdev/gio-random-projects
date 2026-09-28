# clubs-ingest

Worker que traz os dados públicos de Pro Clubs (EA FC 27) e os grava via
`domain-api`. **Sem banco próprio, sem porta, sem hostname** — um serviço
puramente de saída, como `pld-scraper`.

## Por que Python

A API da EA fica atrás de um CDN que bloqueia requisições que não se pareçam com
as de um navegador: `curl` é recusado mesmo com os cabeçalhos certos, enquanto
Python passa. Isso é o que decidiu a linguagem deste worker — e é por isso que
`src/clubs_ingest/fc27_api.py` é **vendorizado**, não reescrito.

## O cliente vendorizado (terceiro)

`src/clubs_ingest/fc27_api.py` vem de
[1erkandogan/fc27-clubs-api](https://github.com/1erkandogan/fc27-clubs-api)
(MIT). A licença original está em `src/clubs_ingest/LICENSE.fc27`, verbatim, e o
cabeçalho do arquivo credita o autor.

**Não edite esse arquivo para adicionar comportamento de produto.** Toda a
tradução específica deste hub vive em `normalize.py`, para que uma atualização
do cliente continue sendo uma substituição limpa.

## O ciclo

```
boot → valida env → conecta domain-api → loop:
  1. lê os clubes acompanhados da domain-api
  2. para cada clube, checa o TTL por tipo de consulta
  3. consulta a fonte só para o que venceu; normaliza
  4. grava via domain-api (partida e elenco por /sync, nível por 202)
  5. deriva anúncios dos fatos novos
  6. dorme até o próximo ciclo
```

Cada clube roda **dentro do seu próprio bloco de falha**: um clube cujo payload
mudou de forma falha sozinho e é registrado com o seu id; o ciclo continua. Uma
falha de rede inteira encerra o ciclo, mas o cliente da fonte sobrevive — o token
de desafio do CDN precisa atravessar os ciclos, e é exatamente por isso que isto
é um loop em um processo e não um job disparado por cron.

TTLs padrão: partidas 5 min, elenco e totais 60 min, com o ciclo a cada 15 min.

## A camada de tradução (`normalize.py`)

**Toda** irregularidade da fonte é resolvida aqui, e em nenhum outro lugar:

| O que a fonte manda | Tratamento |
|---|---|
| Números como texto (`"25"`, `"7.4"`) | conversão na leitura |
| `clubId` vs `clubIds` | decidido por endpoint, em `client.py` |
| **Cinco** códigos de resultado (`1`, `2`, `4`, `16385`, `10`) | traduzidos para três resultados + flag de desistência |
| Amistoso sem marcação de resultado | derivado de gols pró vs sofridos |
| A mesma partida nos dois clubes | gravada uma vez, idempotente por `match_id` |
| Posição, estilo, nacionalidade, escudo, ids de evento | tabelas de-para próprias, com fallback explícito |

Os rótulos da linha do tempo (correlação dos `match_event_aggregate_*`) saem
marcados com `"inferido": true` — um rótulo errado é pior que uma timeline
menor, então nada é inventado.

## Testes

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/python -m pytest -q
```

Os testes exercitam o **mapeamento** contra as fixtures reais (anonimizadas) da
fonte, offline — o mesmo modelo de `pld-scraper/tests/test_pld_mapping.py`.
Cobrem os cinco códigos de resultado, o amistoso derivado, o código de posição
desconhecido que não quebra, a orientação da partida para o clube requisitante,
e a idempotência por `match_id`.

### BDD e integração com container

Duas camadas a mais:

- **BDD (pytest-bdd)**: os cenários de integração vivem em
  `tests/features/*.feature` (Gherkin em português) com os passos em
  `tests/steps/`. O primeiro é `source_down.feature` — o que o worker faz quando
  a fonte começa a devolver 403.
- **Container real (testcontainers)**: os cenários de integração sobem um
  container com um domain-api de mentira (`tests/fixtures/domain_stub.py`) e
  apontam o `DomainClient` de verdade para ele. A travessia de rede e o contrato
  de payload passam a ser testados de fato — foi um rename de payload que passou
  batido por testes de mock (o `json.Unmarshal` ignora chave desconhecida, e o
  campo vira zero em silêncio).

```sh
.venv/bin/python -m pytest -q          # tudo
.venv/bin/python -m pytest tests/steps # só os cenários BDD (usam Docker)
```

Sem Docker, os cenários que precisam de container se pulam e o resto roda.


## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `CLUBS_INGEST_DOMAIN_API_URL` | sim | base da `domain-api` — o worker **recusa bootar** sem ela |
| `CLUBS_INGEST_DOMAIN_API_KEY` | sim | a chave própria do worker (separada da `clubs-api`, para a auditoria distinguir) |
| `CLUBS_INGEST_POLL_SECONDS` | não (900) | intervalo base do ciclo |
| `CLUBS_INGEST_TTL_MATCHES` | não (300) | TTL das partidas |
| `CLUBS_INGEST_TTL_SQUAD` | não (3600) | TTL de elenco e totais |
| `CLUBS_INGEST_MAX_MATCHES` | não (10) | quantas partidas pedir por consulta |
| `CLUBS_INGEST_PLATFORM` | não (`common-gen5`) | plataforma que a fonte exige |
| `CLUBS_INGEST_DISCORD_WEBHOOK` | não | canal dos avisos; vazio = coleta silenciosa |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | não | telemetria |

Um worker sem persistência acumula nada, e isso é pior que um deploy vermelho —
por isso as duas chaves são obrigatórias e o boot falha.

## Deploy

Container, sem porta publicada e sem regra de ingress. Entra no
`python-ci-cd.yml` automaticamente (descoberto por `pyproject.toml`), mas
**exige a linha no `case` do `-replace`** — sem ela o deploy fica verde sem
recriar o container (ver `docs/novo-app-ci-cd.md` §6).
