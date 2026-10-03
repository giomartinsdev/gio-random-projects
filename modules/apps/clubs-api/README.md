# clubs-api

Backend do **FC Clubs Hub** ([clubs.giomartins.dev](https://clubs.giomartins.dev)) —
rankings, perfis de clube/partida/jogador e **o histórico que a EA não guarda**.

## O desenho: público, com login opt-in próprio

Este é o ponto que define o serviço, e ele existe porque o produto é uma
enciclopédia **pública** com uma camada pessoal **opcional**.

**Não há Cloudflare Access na frente deste host.** O login é um "Entrar com
Google" comum, igual ao do financas:

1. o SPA carrega o Google Identity Services e renderiza o botão oficial;
2. o Google devolve um **ID token**;
3. o SPA manda o token para `POST /api/auth/google`;
4. este serviço verifica o token contra o JWKS do Google **e** contra o nosso
   client ID (`idtoken.Validate`), e recusa e-mail não verificado;
5. verificada, emite o cookie `clubs_session` (HS256, HttpOnly, Secure,
   SameSite=None);
6. toda requisição seguinte se identifica por esse cookie.

O client ID é **próprio do clubs**, não o do financas. O Google registra as
"Origens JavaScript autorizadas" por client, então um client compartilhado
entre dois produtos só funciona se cada host de cada produto estiver na mesma
lista — e foi exatamente o que faltou: `clubs.giomartins.dev` não estava no
client do financas, e o login de produção respondia `origin_mismatch`. Cada
produto com botão de login tem o seu (`TF_VAR_clubs_google_oauth_client_id`,
GitHub secret `CLUBS_GOOGLE_OAUTH_CLIENT_ID`).

O primeiro login de uma conta **é** a criação dela: não há formulário de
cadastro, porque todo dado pessoal do hub é particionado por e-mail.

| Host | Situação | Por quê |
|---|---|---|
| `clubs.giomartins.dev` | público | é o SPA público e é embutido no hub como microfrontend |
| `clubs-api.giomartins.dev` | público | um visitante sem conta lê todo o dataset |

As rotas **públicas** respondem sem identidade alguma (o dataset é aberto de
propósito); as **pessoais** exigem o cookie. A SPA sonda `/api/me` para decidir
entre visitante e conectado — um fetch simples, sem redirect de edge.

### Por que SameSite=None

O SPA vive em `clubs.giomartins.dev` e chama `clubs-api.giomartins.dev`: um
fetch cross-origin só carrega o cookie com `SameSite=None`, e `None` exige
`Secure`. O domínio do cookie fica vazio por padrão (host-only) — só este host
lê a sessão, então escopar num domínio inteiro seria privilégio a mais.

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
# a base compartilhada (RABBITMQ_PASSWORD igual ao do compose.dev.yaml)
cd ..  &&  RABBITMQ_PASSWORD=devpass docker compose -f compose.yaml -f compose.dev.yaml up -d postgres rabbitmq

# domain-worker + domain-api (o schema é aplicado pelo worker)
cd ../domain-worker && DATABASE_URL="postgresql://domain:devpass@localhost:15432/domain" \
  RABBITMQ_URL="amqp://domain:devpass@localhost:15672/" go run .
cd ../domain-api && DATABASE_URL="postgresql://domain:devpass@localhost:15432/domain" \
  RABBITMQ_URL="amqp://domain:devpass@localhost:15672/" DOMAIN_API_KEYS="devkey:dev,clubs-api-key:clubs-api" \
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
