# tela

Compartilhamento de tela em `tela.giomartins.dev`. Alguém cria uma sala com
uma senha, passa o código e a senha, e quem recebe assiste. Sem cadastro,
sem banco de dados.

Não tem relação com os outros apps deste repositório: não usa Postgres,
não usa o Better Auth do post-api, não fala com o domain-api. Um container,
um domínio.

## Como funciona

O vídeo **não passa por este servidor**. Os navegadores se conectam
diretamente por WebRTC; o servidor só apresenta os dois, repassando
offer/answer/ICE entre eles pelo WebSocket. Isso significa que a
qualidade depende da conexão entre as duas pontas, e que o custo do
servidor não cresce com a resolução da tela compartilhada.

Só há STUN público configurado, sem TURN. Cobre redes domésticas e a
maioria dos NATs de consumidor; atrás de NAT simétrico ou firewall
corporativo restritivo a conexão simplesmente não estabelece, e o
espectador fica em "conectando…".

## Estado

Tudo em memória (`internal/rooms`). Uma sala é um código de 6 caracteres,
o hash scrypt da senha e quem está conectado agora. Um restart derruba
todas as salas — o que é o comportamento certo para algo cuja vida útil é
"alguém está compartilhando a tela neste momento".

Salas vazias são removidas depois de 10 minutos (para o host sobreviver a
um reload ou uma queda de wifi), e qualquer sala morre com 12 horas.

## Senha vs. host token

São duas coisas diferentes, de propósito:

- **senha da sala** — quem tem, assiste;
- **host token** — quem tem, compartilha.

O token é devolvido só para quem criou a sala e fica no `sessionStorage`,
nunca na URL. Quem tem a senha não consegue tomar a transmissão, e uma
sala aceita apenas um host por vez.

Tentativas de senha são limitadas por IP (`CF-Connecting-IP`, já que isto
roda atrás do Cloudflare), porque um código de 6 caracteres mais uma
senha curta é exatamente o tipo de coisa que vale a pena chutar.

## Rodando local

```bash
# terminal 1 — servidor Go
go run .

# terminal 2 — client com hot reload (proxia /api e /ws para :8000)
cd client && npm install && npm run dev
```

Em produção o binário serve o bundle já buildado (`WEB_DIR`, default
`web/`); o `Dockerfile` compila o client e o Go em stages separados.

```bash
go test ./...   # relay de sinalização, autorização, ciclo de vida da sala
```

## API

| Rota | O quê |
| --- | --- |
| `POST /api/rooms` | cria uma sala — `{password}` → `{roomId, hostToken}` |
| `GET /api/rooms/{id}` | status público — se tem alguém compartilhando e quantos assistem |
| `POST /api/rooms/{id}/check` | valida a senha antes de abrir o WebSocket |
| `GET /ws?room=&role=host&token=` | sinalização, lado de quem compartilha |
| `GET /ws?room=&role=viewer&password=` | sinalização, lado de quem assiste |
| `GET /healthz` | liveness + número de salas |

Mensagens do WebSocket: `welcome`, `viewer:join`, `viewer:leave`,
`host:online`, `host:offline` e `signal`. O servidor nunca olha dentro do
`payload` de um `signal` — SDP e ICE são assunto dos navegadores. Ele só
decide quem pode receber (ver `Room.Relay`): um espectador só fala com o
host, nunca com outro espectador.
