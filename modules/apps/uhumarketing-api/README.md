# uhumarketing-api

Backend da POC do uhumarketing: templates da Meta, audiências com opt-in,
campanhas, fila de disparo e webhook de status. Go + Postgres, um processo só.

Ele existe para tirar o produto do `localStorage`. A pergunta que responde:
*o que precisa ser verdade no servidor para esta tela poder mandar mensagem de
verdade?* — e a resposta está nas regras, não nas telas.

## Rodar

```bash
cp .env.example .env
docker compose up -d --build
curl localhost:8195/healthz        # {"ok":true}
```

O schema é aplicado na subida (embutido no binário, idempotente) e o seed do
Café Aurora roda uma vez: 8 templates, 57 contatos, 6 audiências, 3 campanhas,
3 fluxos e o histórico de envios. Sem banco, o serviço não sobe — não existe
modo "memória" que esconderia erro de SQL.

Sem Docker (com um Postgres já na mão):

```bash
export DATABASE_URL='postgres://uhu:uhu@localhost:5433/uhumarketing?sslmode=disable'
go run .
```

O frontend (`../uhumarketing-frontend`) roda no host, na 5180, e escolhe
"Backend real" em Configurações → Origem dos dados.

## Modos de provedor

Toda a conversa com a Meta passa por `meta.Provider`. Há duas implementações:

| `META_MODE` | O que faz | Quando usar |
| --- | --- | --- |
| `dry-run` (default) | Aprova templates na hora, gera `wamid.dry.*`, drena a fila e **não toca a rede** | Desenvolver, testar, demonstrar |
| `live` | Cloud API real: `POST /{waba}/message_templates` e `POST /{phone_id}/messages` | Só com conta Meta pronta |

`live` exige `META_WABA_ID`, `META_PHONE_NUMBER_ID` e `META_TOKEN`; o boot
falha se faltar algum. Isso é intencional: subir em `live` pela metade e
descobrir no primeiro disparo é pior do que não subir.

O que o dry-run **não** faz: simular latência, recusa de conteúdo ou
qualidade do número. Ele aprova. É um provedor de desenvolvimento, não uma
previsão da Meta.

## As regras que moram aqui

Estas são as razões de existir um backend, e cada uma tem teste:

1. **Template precisa estar aprovado.** Rascunho, pendente ou rejeitado não
   vira mensagem. O status nunca vem do cliente — `POST /templates?submit=false`
   grava rascunho; `POST /templates/{id}/submit` é a única porta para a Meta.
2. **O workspace precisa de telefone.** Sem `whatsapp_number` não há remetente.
3. **O contato precisa de opt-in.** Consentimento é histórico
   (`contact_consents`), com `revoked_at` — não um booleano que some. "PARAR"
   no WhatsApp revoga e o contato sai das próximas audiências.
4. **Um envio por contato por campanha.** `UNIQUE (campaign_id, contact_id)`.
   Disparar duas vezes é o erro mais caro de marketing; o banco é quem impede,
   não a tela.
5. **Janela e vazão.** O worker não manda fora da janela da campanha nem acima
   do throttle. Se a fila está parada por isso, o bootstrap diz por quê
   (`queue[].blockedBy = "window"` + `nextOpenAt`) — fila parada sem explicação
   parece defeito.

Métricas (`sent`, `delivered`, `read`, `failed`, `queued`) são **derivadas** de
`sends` por agregação, a cada leitura. Não há contador para desincronizar.
`converted` e `revenue` ficam em zero até existir sinal real de conversão: a POC
não inventa receita.

## Contrato HTTP

Tudo em `/api/v1`, autenticado por `X-API-Key` (ou `Authorization: Bearer`).
Públicos: `/healthz` e `/webhooks/whatsapp`.

| Método | Rota | Para quê |
| --- | --- | --- |
| GET | `/bootstrap` | Estado inteiro da tela: workspace, templates, audiências, campanhas, envios, fluxos, atividade, provedor e estado da fila |
| PUT | `/state` | Documento editorial (workspace, templates, audiências, campanhas, fluxos). Ver abaixo |
| POST | `/templates` | Cria e submete à Meta (`?submit=false` só grava rascunho) |
| PATCH | `/templates/{id}` | Edita conteúdo; volta para rascunho se o corpo mudou |
| POST | `/templates/{id}/submit` | Envia o rascunho para a Meta |
| POST | `/segments`, `/contacts` | Audiências e contatos com opt-in |
| POST | `/campaigns` | Cria campanha |
| POST | `/campaigns/{id}/launch` | Enfileira a audiência elegível; devolve `queued`, `skipped`, `duplicate` |
| POST | `/campaigns/{id}/test` | Enfileira **uma** mensagem, passando pelas mesmas regras |
| POST | `/campaigns/{id}/pause`, `/resume` | Pausa/retoma |
| POST | `/contacts/{id}/opt-out` | Revoga consentimento explicitamente |
| GET/POST | `/webhooks/whatsapp` | Handshake (`hub.challenge`) e eventos da Meta |

### Por que `PUT /state` e não um PATCH por campo

O editor de fluxo salva o grafo inteiro. As telas também fazem mutações em
sequência (criar campanha → criar fluxo → apontar a campanha para o fluxo). Um
PATCH por nó durante um arrasto geraria dezenas de requisições e estados
intermediários que ninguém quer persistir. O cliente manda o documento
editorial, com ids gerados por ele, num PUT debounced.

O merge é assimétrico de propósito:

- **template cujo conteúdo mudou** volta para rascunho (a aprovação antiga não
  cobre um corpo novo) e mantém o id externo para auditoria;
- **template cujo conteúdo não mudou** mantém status, id externo e qualidade —
  senão salvar uma tela apagaria a aprovação da Meta;
- **campanha** mantém métricas e última execução, que vêm de `sends`;
- **fluxo** mantém contadores de execução;
- **sends nunca são tocados** pelo cliente.

Concorrência hoje é last-write-wins num workspace único. Isso é um limite
conhecido da POC, não uma decisão de arquitetura: quando houver dois operadores
de verdade, o caminho é versionar o documento (`If-Match`/`revision`) em vez de
inventar CRDT para um canvas que ninguém edita em conjunto ainda.

## Webhook

Handshake: `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`.

Eventos: `entry[0].changes[0].value.statuses[]` com `sent`, `delivered`, `read`,
`failed`. Status fora de ordem não regride ("lido" antes de "entregue" continua
"lido"); a resposta diz `applied: false`. Com `META_APP_SECRET` definido, a
assinatura `X-Hub-Signature-256` é obrigatória (HMAC SHA256 do corpo cru) — sem
ela, 401. Eventos são gravados em `webhook_events` antes de aplicar, então um
payload novo da Meta não se perde no meio de um erro.

## Dev-only

Com `ALLOW_DEV_ACTIONS=true`:

- `POST /dev/reset` — reaplica o seed (idempotente);
- `POST /dev/simulate-status` — injeta entrega/leitura sem credencial;
- `POST /dev/worker-tick` — força um ciclo da fila.

Em qualquer ambiente com dado real, `ALLOW_DEV_ACTIONS=false`. As rotas
devolvem 404, não 403: não vale anunciar que existem.

## Testes

```bash
go test ./...     # precisa de Docker (testcontainers sobe Postgres real)
go vet ./...
```

A suíte de features (`tests/features/*.feature`, godog + testcontainers) roda
contra Postgres real e o router real. Um repositório fake esconderia
exatamente o que precisa ser provado: o `UNIQUE` que impede reenvio, o claim
com `SKIP LOCKED` e as métricas derivadas. Sem Docker, a suíte é pulada e o
resto de `go test` continua.

Cobertura das features: ciclo de template (aprovação, rejeição, edição que
invalida aprovação, assinatura de webhook), disparo (template não aprovado,
sem telefone, opt-in, idempotência, entrega/leitura fora de ordem) e opt-in
(validação de telefone, duplicidade, contagem de audiência, revogação).

## Estrutura

```
main.go                     composição: config → pool → migrate → seed → worker → router
internal/
  config/                   env → Config; recusa subir sem DATABASE_URL/chaves
  domain/                   modelo + regras (template, opt-in, audiência, status)
  store/                    Postgres: schema.sql, fila, métricas derivadas, PUT /state
  meta/                     Provider: DryRun e Cloud (Graph API) + custo por mensagem
  dispatch/                 worker, janela/throttle, explicação da fila
  httpapi/                  borda: rotas, handlers, tradução de erro, webhook
  seed/                     dataset Café Aurora
tests/                      features Gherkin + steps (Postgres real)
```

## O que só quem tem a conta Meta pode fazer

O código está pronto para `live`, mas estas etapas são humanas e fora do repo:

1. Criar o app no Meta for Developers e adicionar o produto WhatsApp.
2. Ativar o número de teste (5 destinatários, aprovação de template imediata)
   ou registrar um número próprio com verificação de negócio.
3. Gerar um token permanente de System User com `whatsapp_business_messaging` e
   `whatsapp_business_management`, e anotar WABA ID + Phone Number ID.
4. Configurar o webhook apontando para `PUBLIC_BASE_URL/webhooks/whatsapp`,
   com o verify token e o app secret (a Meta exige HTTPS público — localhost
   não serve; use um túnel).
5. Sem verificação de negócio: 250 clientes únicos/24h, 250 templates, 2
   números. Com verificação, os limites sobem.

Template é obrigatório para **iniciar** conversa; responder dentro da janela de
24h é livre. Cada mensagem entregue é cobrada (marketing, utilidade e
autenticação têm preços diferentes — ver `meta.CostPerMessage`).
