# Contrato: clubs-ingest

Worker Python que traz os dados da origem (API pública de Pro Clubs da EA) e os
grava via `domain-api`. Sem banco próprio, sem host, sem ingress — container
puramente de saída, como `pld-scraper`.

**Por que Python** (ver `research.md` §2): a origem fica atrás de um CDN que
bloqueia requisições não-navegador; o client não oficial já existente resolve
isso e é incorporado ao repositório como vendor (MIT, com atribuição).

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `CLUBS_INGEST_DOMAIN_API_URL` | sim | base da `domain-api` — o worker recusa bootar sem ela |
| `CLUBS_INGEST_DOMAIN_API_KEY` | sim | a chave do worker (gerada pela infra) |
| `CLUBS_INGEST_POLL_SECONDS` | não (default 900) | intervalo base do ciclo |
| `CLUBS_INGEST_PLATFORM` | não (default `common-gen5`) | plataforma que a origem exige em toda consulta |
| `CLUBS_INGEST_TTL_MATCHES` | não (default 300) | TTL das partidas, em segundos |
| `CLUBS_INGEST_TTL_SQUAD` | não (default 3600) | TTL de elenco e totais |
| `CLUBS_INGEST_IGNORE_CDN` | não | desliga o disfarce de navegador — só para debug local |
| `FLARESOLVERR_URL` | não | mesmo uso de `pld-scraper`, se o CDN endurecer |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | não | telemetria, o padrão de todo app do repo |

**Segredo**: nenhum token da origem existe hoje (a API é aberta). Se um dia
existir, entra por Vaultwarden como `CLUBS_EA_*`, nunca no repositório.

## Ciclo

```
boot → valida env → conecta domain-api → loop:
  1. GET /clubs (acompanhados) da domain-api
  2. para cada clube:
       se TTL(partidas) venceu → consulta origem → normaliza → POST partidas+lances
       se TTL(elenco)  venceu → consulta origem → normaliza → POST elenco/totais
       se TTL(nível)   venceu → consulta origem → POST snapshot (assíncrono)
  3. deriva anúncios dos fatos novos → POST anuncios
  4. dorme até o próximo ciclo
```

**Isolamento de falha** (FR-032): cada clube é processado dentro de um bloco que
captura exceção, registra com o `club_id` e segue para o próximo. Um clube que
quebrou não impede os outros, e uma falha de rede inteira apenas encerra o ciclo
— o estado em memória (o token de desafio do CDN) sobrevive, que é a razão de o
ciclo ser um loop em processo e não um job disparado por cron.

## Normalização (a camada que existe por causa de FR-017)

Tudo abaixo acontece **aqui**, uma única vez, e nunca na aplicação:

| Irregularidade da origem | Tratamento |
|---|---|
| Números vêm como texto (`"25"`, `"7.4"`) | conversão numérica na leitura do payload |
| Parâmetro ora singular (`clubId`) ora plural (`clubIds`) | o client decide por endpoint, documentado numa tabela única |
| Cinco códigos de resultado (`1`, `2`, `4`, `16385`, `10`) | traduzidos para `vitoria`/`empate`/`derrota` + flag de desistência |
| Amistoso sem marcação de resultado | derivado de gols pró vs gols sofridos |
| Partida aparece nos dois clubes | gravada uma vez, com as duas linhas de clube |
| Identificadores sem tabela publicada (posição, estilo, nacionalidade, escudo) | tabelas de-para próprias, marcadas como inferidas, com fallback visível quando desconhecido |
| Agregados de evento sem documentação | correlação com gols/chutes/passes para montar a linha do tempo, marcada como inferida |

**Regra de ouro**: se um campo novo aparecer, ou um campo sumir, a consulta
daquele clube falha isolada e é registrada — nunca entra dado parcial nem
inventado na base.

## Testes

Precedente direto de `pld-scraper` (`tests/test_pld_mapping.py`): o worker testa
**o mapeamento**, com respostas reais salvas em fixtures. As fixtures já existem
no repositório do client original (`tests/fixtures/*.json`, estrutura real com
nomes e ids anonimizados) e são incorporadas junto com o código.

O que os testes precisam cobrir, no mínimo:

- cada um dos cinco códigos de resultado vira o valor normalizado certo;
- amistoso sem marcação deriva o resultado de gols;
- partida vista dos dois lados produz uma única partida com duas linhas de clube;
- posição numérica vira o enum de posição, e um código desconhecido não quebra;
- payload com campo ausente falha aquele clube sem derrubar o ciclo.

## Observabilidade

`OTEL_SERVICE_NAME=clubs-ingest`, mesmo pacote de telemetria dos outros workers.
Logs já fluem para o Grafana sem trabalho extra (scrape de stdout). O que a área
de administração lê (FR-031) vem de contadores que o worker publica na
`domain-api`: clubes processados, falhas por clube, tamanho do cache por tipo.

## Deploy

Container, sem porta publicada, sem regra de ingress. Build context é a raiz do
repositório (o pipeline Python monta assim), o `Dockerfile` instala o app — e,
se o client vendorizado virar pacote local, a mesma receita de `pld-scraper`
para a lib compartilhada.

Entra no `python-ci-cd.yml` automaticamente (o pipeline descobre por
`pyproject.toml`), mas **exige a linha no `case` do `-replace`** — sem ela o
deploy fica verde sem recriar o container. Ver `tasks.md` T-setup.

## Não-objetivos deste serviço

- Não serve HTTP. Nenhuma rota, nenhum host.
- Não fala com o `clubs-api`. A comunicação é só com a `domain-api`.
- Não formata nada para apresentação. A regra "nada de termo técnico na tela"
  (FR-034) é responsabilidade da `clubs-api`/SPA; o worker guarda o fato cru
  normalizado.
