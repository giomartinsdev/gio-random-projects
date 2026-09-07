# cch-api

Backend de [cch.giomartins.dev](https://cch.giomartins.dev) — um "cartas contra a humanidade" de festas: um código de sala, uma senha e quem estiver conectado. Sem contas, sem banco.

## Como funciona

- **`internal/decks`** — os baralhos temáticos (Clássico, Pesadão, Brasil, Dev & TI, Treta & Amor), cartas brancas, cartas pretas e cartas em branco (`__` para escrever sua própria). `Shuffle` genérico com `crypto/rand`.
- **`internal/game`** — a máquina de estados do jogo, sem conhecimento de transporte (sem WebSocket, sem sala): fases `lobby → playing → judging → roundEnd → gameOver`, czar rotativo por ordem de entrada, mão de 10 cartas, troca de 1 carta por rodada, cartas pretas com `__` para completar, pontuação até o placar-alvo.
- **`internal/rooms`** — salas: código tipo `abacate98suco`, senha com scrypt, token de resume (HMAC) para reconectar após um deploy sem perder identidade/pontuação, knock para entrar sem senha, persistência em JSON (write-then-rename).
- **`internal/httpapi`** — a API REST (criar/ver/apagar sala, checar senha, knock, listar decks) e o WebSocket que carrega o jogo. Estado é enviado **por destinatário**: mãos e autoria de jogadas nunca saem do servidor para a pessoa errada.

## API REST

| Rota | O que faz |
| --- | --- |
| `GET /healthz` | saúde + contagem de salas |
| `POST /api/rooms` | cria sala `{password}` → `{roomId}` |
| `GET /api/rooms` | salas ativas ("salas rolando") |
| `GET /api/rooms/{id}` | pessoas conectadas + se está jogando |
| `DELETE /api/rooms/{id}` | apaga a sala `{password}` (quem criou) |
| `POST /api/rooms/{id}/check` | valida a senha antes de abrir WS |
| `POST /api/rooms/{id}/knock` | pede para entrar `{name}` → `{requestId}` |
| `GET /api/rooms/{id}/knock/{requestId}` | status do pedido (token de entrada quando aprovado) |
| `GET /api/decks` | decks disponíveis (metadados, nunca as cartas) |
| `GET /ws?room=&password=&peerId=&name=&resume=&admitToken=` | o jogo |

## WebSocket (o jogo)

Servidor → cliente: `welcome` (identidade + estado + pedidos de knock pendentes), `state` (snapshot por destinatário), `hand` (suas cartas), `peer:join`, `peer:leave`, `error`, `pong`.

Cliente → servidor:

- `game:start` `{decks, winningScore}` — ≥3 pessoas conectadas
- `card:submit` `{plays: [{cardId, text}]}` — cartas em branco trazem o texto
- `card:discard` `{cardId}` — troca 1 carta por rodada
- `card:pick` `{submissionId}` — escolha do czar
- `round:next` / `round:skip` — conduz o czar
- `game:reset` — volta ao lobby após o fim
- `knock:approve` / `knock:deny` `{requestId}` — qualquer pessoa na sala pode responder

## Configuração

| Env | Padrão | O que é |
| --- | --- | --- |
| `PORT` | `8008` | porta de escuta |
| `BIND_HOST` | vazio (todas) | em produção `127.0.0.1` (host networking; nginx na frente) |
| `FRONTEND_ORIGINS` | vazio | origens do cch-frontend para CORS/WS |
| `STATE_FILE` | vazio (memória) | arquivo JSON de persistência das salas |

## Desenvolvimento

```sh
go build ./... && go vet ./... && go test ./...
PORT=8008 go run .
```