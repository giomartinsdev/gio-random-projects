# clubs-api

Backend do **FC Clubs Hub** ([clubs.giomartins.dev](https://clubs.giomartins.dev)) —
rankings, perfis de clube/partida/jogador e **o histórico que a EA não guarda**.

## O desenho: público com login opt-in

Este é o ponto que define o serviço, e ele existe porque o produto é uma
enciclopédia **pública** com uma camada pessoal **opcional**:

| Host | Situação | Por quê |
|---|---|---|
| `clubs.giomartins.dev` | público, fora do SSO | é o SPA público e é embutido no hub como microfrontend |
| `clubs-api.giomartins.dev` | público, fora do SSO | um visitante sem conta lê todo o dataset |
| `clubs-api.giomartins.dev/api` | atrás do Access | só aqui o login é exigido |

O hostname bare serve as leituras públicas (rankings, clubes, jogadores,
partidas). O caminho `/api` é que tem aplicação de Access (ver
`path_protected_hostnames` no `locals.tf`), e a SPA sonda `/api/me` para decidir
entre visitante e conectado — a mesma forma do probe `/sso` do hub.

**Consequência importante**: "sincronizar meus clubes" só existe autenticado.
Isso é o desenho, não um defeito — sem login o hub é uma enciclopédia pública;
com login ele vira "meu hub".

## Sem banco próprio

Como `cch-api` e os módulos de finanças: nenhum driver de banco aqui, e nunca
deve haver um. Toda leitura e escrita passa pela `domain-api` por HTTP com a
chave própria deste serviço (`X-API-Key`), o que faz o log de auditoria
distinguir quem escreveu.

Duas formas de escrita, deliberadamente separadas:

- **`/sync`** — publica o comando e segura a requisição até a linha de auditoria
  do worker provar que a gravação caiu. Usado nas escritas estruturais, onde
  "o clube está seguido" precisa sobreviver a um reload segundos depois.
- **`202` assíncrono** — o caminho normal, usado pelo worker de ingestão para as
  escritas append-only de alto volume (leitura de nível, anúncio), onde ninguém
  espera a resposta.

## Rotas

### Públicas (sem identidade)

| Rota | O que faz |
|---|---|
| `GET /healthz` | saúde + se a persistência e a verificação de acesso estão ligadas |
| `GET /api/clubes?q=` | busca por nome, **tolerante a acento e caixa** |
| `GET /api/clubes/{club_id}` | clube + totais + campanha + sequências + forma |
| `GET /api/clubes/{club_id}/elenco` | elenco agregado das partidas |
| `GET /api/clubes/{club_id}/partidas?tipo=&limite=` | partidas do clube |
| `GET /api/partidas/{match_id}` | súmula com os dois lados |
| `GET /api/clubes/{club_id}/evolucao` | série de nível e divisão |
| `GET /api/clubes/{club_id}/divisoes` | mudanças de divisão datadas |
| `GET /api/clubes/{club_id}/recordes` | recordes computados do histórico |
| `GET /api/clubes/{club_id}/confrontos/{rival_id}` | retrospecto direto |
| `GET /api/rankings/clubes?metrica=` | ranking global de clubes |
| `GET /api/rankings/jogadores?metrica=&posicao=` | ranking global de jogadores |
| `GET /api/jogadores?q=` | índice cross-club |
| `GET /api/jogadores/{player_id}` | perfil do jogador |
| `GET /api/anuncios` | feed da home |

### Pessoais (exigem identidade)

| Rota | O que faz |
|---|---|
| `GET /api/me` | probe de login da SPA |
| `GET /api/watchlist` · `POST /api/watchlist` | clubes seguidos |
| `GET /api/notifications` · `POST /api/notifications` | avisos |
| `GET /api/claimed-pro` · `POST /api/claimed-pro` | pro reivindicado |
| `GET /api/sync/status` · `POST /api/sync` | progresso da sincronização |
| `GET /api/admin/status` | estado técnico (uso interno) |

## Rodando local

```sh
# a base compartilhada
cd ..  &&  docker compose -f compose.yaml -f compose.dev.yaml up -d postgres redis

# domain-worker + domain-api (o schema é aplicado pelo worker)
cd ../domain-worker && DATABASE_URL="postgresql://domain:devpass@localhost:15432/domain" \
  REDIS_ADDR="localhost:16379" go run .
cd ../domain-api && DATABASE_URL="postgresql://domain:devpass@localhost:15432/domain" \
  REDIS_ADDR="localhost:16379" DOMAIN_API_KEYS="devkey:dev,clubs-api-key:clubs-api" \
  HTTP_ADDR=":8000" go run .

# dados de exemplo, pelo caminho de escrita real
python3 scripts/seed.py

# e este serviço
CLUBS_DOMAIN_API_URL=http://localhost:8000 CLUBS_DOMAIN_API_KEY=clubs-api-key \
CLUBS_DEV_BYPASS_AUTH=1 CLUBS_DEV_USER_EMAIL=dev@local \
CLUBS_FRONTEND_ORIGINS="http://localhost:5173" PORT=8017 go run .
```

`CLUBS_DEV_BYPASS_AUTH=1` + `CLUBS_DEV_USER_EMAIL` é a escotilha explícita de
desenvolvimento — com nenhum JWT presente, as requisições rodam como esse
e-mail. **Nunca deve ficar ligada em produção.**

## Variáveis de ambiente

| Variável | Obrigatória | O que é |
|---|---|---|
| `CLUBS_DOMAIN_API_URL` | sim | base da `domain-api` (em produção: `http://domain-api:8000`) |
| `CLUBS_DOMAIN_API_KEY` | sim | a chave própria deste serviço na `domain-api` |
| `CLUBS_ACCESS_TEAM_DOMAIN` | não | domínio do time do Cloudflare Access (vazio = só o bypass de dev autentica) |
| `CLUBS_ACCESS_AUD` | não | audience da aplicação de Access em `/api` |
| `CLUBS_ALLOWED_EMAILS` | não | restrição opcional, checada após o JWT verificar |
| `CLUBS_FRONTEND_ORIGINS` | não | origens permitidas em CORS |
| `CLUBS_DEV_BYPASS_AUTH` / `CLUBS_DEV_USER_EMAIL` | não | escotilha de dev (ver acima) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | não | telemetria |

## Verificando um deploy

Não confie no check verde do pipeline:

```sh
curl -s https://clubs-api.giomartins.dev/healthz
# {"persistencia":true,"status":"ok","verificacao_acesso":true}
```

`persistencia:false` significa que o container subiu sem a chave da `domain-api`
— ele responde, mas serve estados vazios.
