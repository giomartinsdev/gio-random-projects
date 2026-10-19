# uhumarketing-api

Backend do uhumarketing: contas, templates da Meta, audiências com opt-in,
campanhas, fila de disparo e webhook de status. Go + Postgres, um processo só.

Ele existe para tirar o produto do `localStorage`. A pergunta que responde:
*o que precisa ser verdade no servidor para esta tela poder mandar mensagem de
verdade?* — e a resposta está nas regras, não nas telas.

**Cada conta é um workspace.** O cadastro cria usuário + workspace VAZIO numa
transação. Não há seed, não há base de demonstração e nenhuma conta enxerga o
dado de outra: o workspace vem do token de sessão em toda requisição.

## Rodar

Stack inteira (Postgres + API + SPA), um comando:

```bash
cp .env.example .env
docker compose up -d --build
open http://localhost:8080          # SPA
curl localhost:8080/healthz         # {"status":"ok",...}
```

O `web` (nginx) serve a SPA e faz proxy de `/api`, `/webhooks` e `/healthz`
para o `api`: mesma origem, sem CORS e com um único endereço público — o mesmo
que você cola no painel da Meta. O schema é aplicado na subida (embutido no
binário, idempotente). A conta nasce vazia — o primeiro passo real é o cadastro
em `POST /api/v1/auth/signup`. Sem banco, o serviço não sobe: não existe modo
"memória" que esconderia erro de SQL.

Desenvolvimento de UI (Vite com HMR, API fora do Docker):

```bash
export DATABASE_URL='postgres://uhu:uhu@localhost:5433/uhumarketing?sslmode=disable'
ALLOW_DEV_ACTIONS=true go run .          # :8195
cd ../uhumarketing-frontend && npm run dev   # :5180, proxy para a 8195
```

O Vite faz proxy de `/api` e `/webhooks`, então o frontend usa caminho relativo
nos dois ambientes. Não existe mais modo demonstração.

## Deploy

O que muda fora do localhost, e por quê:

1. **Um endereço público com HTTPS.** `PUBLIC_BASE_URL=https://uhu.seudominio.com`.
   É esse valor que a tela mostra como *callback do webhook*. Sem ele a tela
   não mostra callback em vez de oferecer `http://localhost` — um endereço que
   a Meta não alcança e que faria você achar que configurou.
2. **`META_APP_SECRET` obrigatório em live.** O webhook é público: sem
   assinatura, qualquer um marcaria envio como lido ou forjaria opt-out. Com
   `RequireSignature` ligado (live) e a chave ausente, o webhook **recusa** o
   evento com 503 em vez de aceitar sem verificar. O boot avisa no log.
3. **`CHANNEL_SECRET` obrigatório em live** (mínimo 16 caracteres). É a chave
   AES-GCM do token de cada conta. Não a perca: sem ela, os canais precisam ser
   reativados.
4. **`ALLOW_DEV_ACTIONS=false`** (default do serviço e do compose). `/dev/reset`
   apaga dados de verdade. Ligue só em ambiente de teste.
5. **`CORS_ORIGINS` vazio** quando a SPA vem do mesmo nginx. Só preencha se o
   frontend for publicado em outro domínio (aí `VITE_UHU_API_URL` também entra
   no build).
6. **Proxy TLS na frente do `web`.** A Meta exige HTTPS. Exponha apenas o
   `web`; o `api` fica em loopback (e o Postgres, sem porta pública).

Checklist de e2e depois do deploy:

```bash
# 1. o processo está em live e cada conta tem o próprio canal?
curl -s https://uhu.seudominio.com/healthz | jq
#    → { "status": "ok", "live": true, "channels": "per-workspace" }

# 2. o caminho completo funciona? (cadastro → canal → template → audiência →
#    campanha → envio de teste)
./scripts/smoke.sh https://uhu.seudominio.com
```

O smoke cria uma conta descartável na instância e percorre as mesmas rotas que
a tela usa. Em `live` ele **não** ativa canal (isso exige as credenciais do
dono) e o envio só sai se a conta já tiver canal — o que é justamente o teste
manual: entre na conta, ative o WhatsApp em Configurações, crie o template,
cadastre seu número com opt-in e use **Enviar teste**.

Depois, no painel da Meta (WhatsApp → Configuration → Webhook): cole o callback
mostrado na tela, o mesmo `META_WEBHOOK_VERIFY_TOKEN` do servidor e assine o
campo `messages`. Sem esse passo a mensagem chega, mas `entregue`/`lido` não
voltam (o envio fica em `sent`).


## Modos de provedor

Toda a conversa com a Meta passa por `meta.Provider`. Há duas implementações:

| `META_MODE` | O que faz | Quando usar |
| --- | --- | --- |
| `dry-run` (default) | Aprova templates na hora, gera `wamid.dry.*`, drena a fila e **não toca a rede** | Desenvolver, testar, demonstrar |
| `live` | Cloud API real: `POST /{waba}/message_templates` e `POST /{phone_id}/messages` | Quando cada conta já ativou o próprio número |

**Não existe WABA global.** O token de WhatsApp pertence à CONTA, não ao
processo: em `live`, cada workspace ativa o próprio número em **Configurações →
WhatsApp** (WABA ID, Phone Number ID e token). Um token global faria a conta de
um cliente enviar pelo número de outro — cobrança, opt-out e banimento cairiam
no dono errado.

O token é gravado **cifrado** (AES-GCM, chave em `CHANNEL_SECRET`) e nunca volta
para o navegador. `CHANNEL_SECRET` é obrigatório em `live`; sem ele o boot
recusa, porque gravar token de terceiro em claro é acesso total à conta dele.

Conta sem canal ativado em `live`: monta audiência, template e campanha, mas o
disparo é recusado com o caminho de ativação. Nada é simulado em silêncio.

Antes de subir, `./scripts/live-check.sh` confere modo e chave. Se você passar
`WABA_ID`, `PHONE_ID` e `WA_TOKEN`, ele também testa a conta contra a Graph sem
gravar nada e sem imprimir o token.

### Modo live, passo a passo

O código está pronto; estas etapas são humanas e fora do repo:

1. **App e produto.** developers.facebook.com → criar app → adicionar WhatsApp.
2. **Número.** O número de teste grátis serve para o primeiro envio (até 5
   destinatários, que você cadastra no painel). Um número próprio exige
   verificação de negócio.
3. **Credenciais.** System User com `whatsapp_business_messaging` e
   `whatsapp_business_management`; anote `WABA ID` e `Phone Number ID`.
4. **Chave de cifra.** Gere `CHANNEL_SECRET` (`openssl rand -base64 32`) e
   coloque no `.env`. Guarde-a: sem ela, os canais precisam ser reativados.
5. **Subir em live.** `META_MODE=live` e `CHANNEL_SECRET`. `GET /healthz` deve
   responder `"live":true` e `"channels":"per-workspace"`.
6. **Ativar a conta.** Configurações → WhatsApp → **Ativar WhatsApp**: cole as
   três credenciais. A API chama a Graph, confirma número e nome verificado e
   só então grava. Se a Meta recusar, o canal não é ativado e o motivo aparece.
7. **Destinatário.** No número de teste, o seu WhatsApp entra na lista de
   destinatários permitidos — senão a Meta recusa com `recipient not in
   allowed list`.
8. **Template.** Criar e enviar para a Meta. A revisão leva de minutos a horas;
   enquanto não volta, o template fica "em análise" e o disparo é recusado.
9. **Teste.** Cadastre o seu número como contato com opt-in, crie a campanha e
   use **Enviar teste** — ele vai para o opt-in mais recente e sai na hora,
   **sem esperar a janela** (a janela continua valendo para o disparo real).

Sem webhook público a mensagem chega, mas o app não recebe `entregue`/`lido`:
o envio fica em `sent`. O template, esse, você resolve com **Consultar status
na Meta** no drawer do template — é uma consulta ativa à Graph, não depende de
callback.

### Se a WABA estiver restrita ou banida

Sintoma: `Testar conexão` mostra "a conta do WhatsApp (WABA) está restrita ou
banida pela Meta", o envio falha e os IDs somem do painel. Não é bug do
produto — a Meta bloqueou a conta.

O que **não** resolve: token novo, outro `META_MODE`, reinstalar, trocar o
Phone Number ID. Todos falham com `131031` enquanto a restrição existir.

O caminho é humano e fora do código:

1. Abrir **Meta Business Suite → Account Quality**
   (`business.facebook.com/latest/accountquality`) e pedir revisão.
2. Acompanhar o recurso na mesma página — a Meta não avisa por outro canal.
3. Quando liberar, os IDs voltam a aparecer em **API Setup** do app.

Se o recurso não for aceito, a alternativa é criar uma WABA nova com outro
número (CNPJ/telefone diferentes). O produto não guarda estado preso à WABA
antiga: ative o canal de novo em Configurações → WhatsApp com as credenciais
novas. O canal é por conta, então uma WABA bloqueada não derruba as outras.

`./scripts/live-check.sh` reconhece esse caso e imprime essa orientação em vez
do JSON da Meta.

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
   parece defeito. A janela é editável no detalhe da campanha e o worker passa a
   respeitá-la no tick seguinte.
6. **Campanha em execução sempre tem fila.** Quando a fila drena, o worker
   fecha a campanha (`finished`) e registra atividade. "Em execução" sem nada
   pendente seria um status que só existe na tela.
7. **Isolamento por conta.** Toda query é escopada por `workspace_id`, que vem
   da sessão — nunca do corpo da requisição. O worker é global: ele percorre as
   contas com campanha em execução e aplica a janela de cada uma.

Métricas (`sent`, `delivered`, `read`, `failed`, `queued`) são **derivadas** de
`sends` por agregação, a cada leitura. Não há contador para desincronizar.
`converted` e `revenue` ficam em zero até existir sinal real de conversão: a POC
não inventa receita.

## Contas e sessão

Cadastro e login devolvem um token opaco; o banco guarda só o SHA-256 dele
(`sessions`), com validade de 30 dias. Logout revoga o token na hora.

| Método | Rota | Para quê |
| --- | --- | --- |
| POST | `/auth/signup` | Cria usuário + workspace vazio; devolve `token` e `workspaceId` |
| POST | `/auth/login` | Troca e-mail/senha por token |
| POST | `/auth/logout` | Revoga o token da requisição |
| GET | `/auth/me` | Quem é o dono do token e qual o workspace |

## Contrato HTTP

Tudo em `/api/v1`, autenticado por `Authorization: Bearer <token de sessão>`.
Públicos: `/healthz`, `/api/v1/auth/{signup,login}` e `/webhooks/whatsapp`
(este último se autentica por assinatura HMAC).

| Método | Rota | Para quê |
| --- | --- | --- |
| GET | `/bootstrap` | Estado inteiro da tela: workspace, templates, audiências, campanhas, envios, fluxos, atividade, provedor e estado da fila |
| PUT | `/state` | Documento editorial (workspace, templates, audiências, campanhas, fluxos). Ver abaixo |
| POST | `/templates` | Cria e submete à Meta (`?submit=false` só grava rascunho) |
| PATCH | `/templates/{id}` | Edita conteúdo; volta para rascunho se o corpo mudou |
| POST | `/templates/{id}/submit` | Envia o rascunho para a Meta |
| POST | `/templates/{id}/sync` | Consulta o status do template na Graph (sem esperar webhook) |
| GET | `/channel` | Verificação real do canal da conta (pergunta à Graph) |
| PUT | `/channel` | Ativa o WhatsApp da conta: `{wabaId, phoneId, token, mode?}`. Confere na Graph antes de gravar; o token nunca volta |
| DELETE | `/channel` | Desativa o canal e apaga as credenciais |
| POST | `/segments`, `/contacts` | Audiências e contatos com opt-in |
| POST | `/campaigns` | Cria campanha |
| POST | `/campaigns/{id}/launch` | Enfileira a audiência elegível; devolve `queued`, `skipped`, `duplicate` |
| POST | `/campaigns/{id}/test` | Enfileira **uma** mensagem para o opt-in mais recente, fora da janela, com as demais regras |
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

Concorrência hoje é last-write-wins dentro do workspace. Isso é um limite
conhecido, não uma decisão de arquitetura: quando houver dois operadores na
mesma conta, o caminho é versionar o documento (`If-Match`/`revision`) em vez de
inventar CRDT para um canvas que ninguém edita em conjunto ainda.

## Webhook

Handshake: `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`.

Eventos: `entry[0].changes[0].value.statuses[]` com `sent`, `delivered`, `read`,
`failed`. Status fora de ordem não regride ("lido" antes de "entregue" continua
"lido"); a resposta diz `applied: false`.

Assinatura: em `META_MODE=live`, `X-Hub-Signature-256` é **obrigatória** — sem
assinatura, 401; sem `META_APP_SECRET`, o webhook falha fechado com 503 (aceitar
payload não verificado num endpoint público deixaria qualquer um marcar envio
como lido ou forjar opt-out). Em dry-run a verificação só vale se o segredo
estiver definido, o que mantém os testes locais simples.

Eventos são gravados em `webhook_events` antes de aplicar, então um payload novo
da Meta não se perde no meio de um erro. O callback a colar no painel da Meta
aparece em Configurações → WhatsApp quando `PUBLIC_BASE_URL` está definido.

## Dev-only

Com `ALLOW_DEV_ACTIONS=true`:

- `POST /dev/reset` — apaga os dados DA CONTA da sessão (não a conta, não o
  login). Não repõe exemplo: recomeçar significa ficar vazio;
- `POST /dev/simulate-status` — injeta entrega/leitura sem credencial;
- `POST /dev/worker-tick` — força um ciclo da fila.

Em qualquer ambiente com dado real, `ALLOW_DEV_ACTIONS=false` — que é o
default do serviço e do compose. As rotas devolvem 404, não 403: não vale
anunciar que existem.

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
main.go                     composição: config → pool → migrate → worker → router
internal/
  config/                   env → Config; recusa subir sem DATABASE_URL
  auth/                     cadastro, login, token de sessão (SHA-256)
  domain/                   modelo + regras (template, opt-in, audiência, status)
  store/                    Postgres: schema.sql, contas/sessões, fila, métricas, PUT /state
  meta/                     Provider: DryRun e Cloud (Graph API) + custo por mensagem
  dispatch/                 worker, janela/throttle, explicação da fila
  httpapi/                  borda: rotas, handlers, sessão, tradução de erro, webhook
tests/                      features Gherkin + steps (Postgres real)
```

## O que só quem tem a conta Meta pode fazer

Login, 2FA, criação do app e aceite de termos no painel da Meta são passos
humanos — nenhum agente faz isso no seu lugar. O passo a passo está em
**Modo live, passo a passo**, acima. Resumo dos limites:

- Número de teste: 5 destinatários, cada um precisa estar na lista permitida.
- Sem verificação de negócio: 250 clientes únicos/24h, 250 templates, 2 números.
- Com verificação, os limites sobem.

Template é obrigatório para **iniciar** conversa; responder dentro da janela de
24h é livre. Cada mensagem entregue é cobrada (marketing, utilidade e
autenticação têm preços diferentes — ver `meta.CostPerMessage`).
