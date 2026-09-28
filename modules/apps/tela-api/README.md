# tela-api

O backend de sinalização do compartilhamento de tela. A página em si é
um app separado, [`tela-frontend`](../tela-frontend/README.md) — os dois
eram um container só até essa separação; veja por quê logo abaixo.

Alguém cria uma sala com uma senha e passa o código; quem entra vê um
grid com todas as telas sendo compartilhadas e pode abrir qualquer uma
em tela cheia. Sem cadastro, sem banco de dados.

Todo mundo na sala é participante igual: qualquer pessoa pode começar a
compartilhar a qualquer momento, várias ao mesmo tempo, e parar sem
atrapalhar as outras.

Não tem relação com os outros apps deste repositório: não usa Postgres,
não usa o Better Auth do post-api, não fala com o domain-api.

## Por que virou dois containers

Até aqui, um único binário Go servia tanto a API/WebSocket/SFU quanto o
bundle React já buildado (`WEB_DIR`). Separado em `tela-api` (isto
aqui) e `tela-frontend` (nginx puro, seu próprio container/domínio)
para bater com o padrão `-api`/`-frontend` do resto do repositório —
`tela-frontend` fala com `tela-api` por CORS agora, não mais
same-origin. `internal/httpapi`'s `Server.AllowedOrigins` é a
allowlist (`FRONTEND_ORIGINS`, env var) tanto para os cabeçalhos CORS
da API REST quanto para a checagem de `Origin` do upgrade do
WebSocket (`ws.go`) — sem isso o navegador rejeita a resposta antes
mesmo do JS ver.

## Como funciona

A mídia passa por um **MediaMTX** auto-hospedado: quem compartilha manda
o stream para ele via **WHIP** e quem assiste puxa via **WHEP** — uma
subida só por compartilhamento, e o MediaMTX reparte para os
espectadores. Nada é transcodificado.

O servidor Go (`internal/mediamtx`) só faz o **proxy do SDP**: recebe o
offer cru do navegador e repassa para o MediaMTX, devolve a answer. O
navegador nunca vê a porta HTTP do MediaMTX nem o nome do path — a mídia
em si vai direto do navegador para a porta ICE/DTLS do MediaMTX.

Antes isso era uma malha, e quem compartilhava codificava um stream
separado por espectador: duas pessoas assistindo eram dois encodes e o
dobro de upload, que era exatamente o que travava tudo. Agora o custo de
quem transmite não cresce com a plateia.

Cada pessoa publica no seu **próprio path** do MediaMTX (um por peer),
então várias pessoas podem compartilhar ao mesmo tempo, e cada
espectador puxa cada transmissão com sua própria conexão WHEP. O
servidor nunca toca nos pacotes.

### A mídia não passa pelo ingress

Isto é o que decide se funciona. O MediaMTX é o endpoint WebRTC: os
navegadores mandam UDP direto para ele, numa porta só
(`mediamtx_udp_port`, padrão 8217, UDP+TCP, para ICE/DTLS) — o ingress
nginx só carrega HTTP (a API, o WebSocket de sinalização), **a mídia
nunca passa por ele**.

`MTX_WEBRTCADDITIONALHOSTS` (Terraform: `mediamtx_public_host`) é o
endereço que o MediaMTX anuncia nos candidatos ICE. Na VPS isso é
simplesmente `var.server_ip` (o IP público dela, passado pelo root
`main.tf`) — sem indireção de DNS, já que é o mesmo host o tempo todo.
Sem ele o MediaMTX anuncia endereços internos e ninguém conecta.

O `tela-api` fala com o MediaMTX por loopback
(`MEDIAMTX_INTERNAL_URL=http://127.0.0.1:8889`): os dois rodam com
`network_mode = host`, então o nome `mediamtx` da rede docker não
resolve. `MEDIAMTX_INTERNAL_URL` vazio desliga o compartilhamento de
tela por completo — as salas, o chat e a presença continuam funcionando.

Por padrão só há STUN público, sem TURN — numa rede que bloqueia UDP, ou
num caminho que descarta os pacotes grandes do handshake DTLS, a conexão
não estabelece. Para esses casos há um **relay TURN** opcional
(`GET /api/rtc/ice`): o navegador recebe os servidores ICE do servidor e,
quando um TURN existe, é fixado nele (`iceTransportPolicy: relay`). Como
o MediaMTX tem IP público, só o lado do navegador precisa do relay.

O deploy de produção usa um **coturn auto-hospedado** (grátis: a banda sai
do egress da própria VPS), com `--use-auth-secret`: o tela-api gera uma
credencial curta por requisição (`hmac(segredo, "<expiracao>:<id>")`) que
o coturn verifica sozinho — nada de senha fixa no navegador, e o relay não
vira um relay aberto. Como coturn e MediaMTX ficam no mesmo host, e a
Oracle não faz hairpin para o próprio IP público, o MediaMTX anuncia
**os dois** endereços (público e privado) e uma regra de NAT redireciona o
tráfego do próprio host ao IP público de volta para a interface privada.
Alternativas por env var (todas opcionais; vazio = STUN-only):

| Env | O quê |
| --- | --- |
| `TELA_STUN_URLS` | STUN (espaço/vírgula). Vazio usa o padrão (Google STUN). |
| `TELA_TURN_URLS` | Endereços TURN (ex.: `turn:host:3478?transport=udp`). |
| `TELA_TURN_SECRET` + `TELA_TURN_USERID` + `TELA_TURN_TTL` | coturn `use-auth-secret`: credenciais efêmeras geradas por requisição. **Preferido.** |
| `TELA_TURN_USERNAME` + `TELA_TURN_PASSWORD` | TURN com credencial fixa (passada como está). |
| `TELA_TURN_CF_KEY_ID` + `TELA_TURN_CF_API_TOKEN` | Cloudflare Realtime TURN (gerenciado, pago fora do SFU deles). Usado só se não houver coturn. |

## Estado

Uma sala é um código tipo "abacate98suco" (duas palavras e um número),
o hash scrypt da senha e uma chave que assina tokens de retomada.
**Isso é persistido** (`STATE_FILE`, num
volume) para que um deploy não acabe com sessões em andamento. Quem está
conectado **não** é persistido: são WebSockets vivos que morrem com o
processo de qualquer jeito, e cada cliente reconecta e se re-anuncia.

Salas vazias são removidas depois de 10 minutos (o suficiente para todo
mundo reconectar), e qualquer sala morre com 12 horas. Sem `STATE_FILE`
tudo fica só em memória — é o modo de desenvolvimento local.

## Deploy sem interromper quem está usando

O ponto de partida é que **a mídia não passa por este servidor**. Uma vez
que as conexões com o MediaMTX existem, os streams vão direto entre cada
navegador e o MediaMTX: se o container do `tela-api` morrer agora, quem
está assistindo continua assistindo. O `tela-api` só carrega
sinalização. Então o problema não é zero downtime, e sim tornar a lacuna
de alguns segundos invisível.

Três peças fazem isso:

1. **O cliente reconecta sozinho**, com backoff de 500ms a 8s e jitter
   (para uma sala cheia não voltar toda no mesmo instante e atropelar o
   servidor que acabou de subir).
2. **A identidade sobrevive.** Na primeira entrada o servidor emite um
   token de retomada (HMAC de uma chave por sala); o cliente guarda e
   reapresenta ao reconectar. Voltar com o mesmo `peerId` é o que mantém
   a sala coerente — sem isso cada reconexão seria uma pessoa nova e
   tudo seria renegociado. O token é exigido em vez de confiar no id
   porque, só com o id, um membro da sala poderia se passar por outro.
3. **Período de graça de 12s** antes de derrubar o vídeo de quem sumiu.
   Cobre o caso de um cliente só piscando (wifi ruim, reload): se voltar
   dentro da janela com a mesma identidade, o teardown é cancelado.

O `welcome` já carrega o estado completo da sala, então a reconexão
ressincroniza sozinha — quem estava publicando re-oferece ao MediaMTX, e
o cliente reconstrói uma conexão WHEP para cada transmissão no ar.

### Fazendo o deploy

Não precisa de janela de manutenção para o caso normal:

```bash
gh workflow run go-ci-cd.yml -f app=tela-api
```

O container é recriado, fica alguns segundos fora, e os clientes voltam
sozinhos. Se quiser conferir antes se tem gente usando:

```bash
curl -s https://tela-api.giomartins.dev/healthz   # {"rooms":N,...}
```

### O que ainda interrompe

- Quem estiver **no meio da negociação WebRTC** no exato instante do
  restart perde e refaz. Fica invisível para streams já estabelecidos,
  não para quem está entrando naquele segundo.
- Se o volume for perdido, as salas somem e ninguém consegue voltar.
- Um restart que passe de ~12s estoura o período de graça e o vídeo cai
  (embora a sala e a senha continuem funcionando).
- **O MediaMTX também pode ser reiniciado**; um restart dele derruba as
  transmissões no ar, e os clientes reconectam ao path na próxima
  publicação. Ele guarda estado só em memória.

## Senha

A senha da sala é a única credencial que existe: quem tem, entra, e quem
entra pode tanto assistir quanto compartilhar. Não há dono nem host — a
pessoa que criou a sala não tem nenhum poder a mais que as outras.

Ela viaja pelo estado de navegação do React, nunca pela URL, para que o
link possa ser colado em qualquer lugar sem vazar o acesso.

Tentativas de senha são limitadas por IP (`CF-Connecting-IP`, definido
pela Cloudflare quando os registros estiverem proxiados — Fase 2),
porque um código de sala mais uma senha curta é exatamente o
tipo de coisa que vale a pena chutar.

## Pedir para entrar (knock)

Quem tem só o código da sala, sem a senha, pode bater na porta em vez
de adivinhar: `POST /api/rooms/{id}/knock` registra um pedido e avisa
todo mundo que já está dentro pelo próprio WebSocket (`knock:request`)
— não existe host, então qualquer pessoa presente pode aprovar ou
recusar (`knock:approve` / `knock:deny`), e a decisão vale pra sala
inteira (`knock:resolved` desfaz o aviso em todas as telas de uma vez,
não só na de quem clicou).

Quem pediu não fica com uma conexão aberta esperando resposta — isso
travaria a aba numa sala lenta ou sem ninguém prestando atenção. Em vez
disso, faz polling em `GET /api/rooms/{id}/knock/{requestId}` a cada
~1,5s. Aprovado, a resposta já vem com um `admitToken`: uma senha
pessoal e temporária (30 minutos, ver `knock.go`'s `admitTokenTTL`) que
abre o WebSocket no lugar da senha de verdade, que essa pessoa nunca
chega a saber.

## Rodando local
```bash
# terminal 1 — MediaMTX (WHIP/WHEP), com SDP em :8889 e mídia em :8217
docker run --rm --network host \
  -e MTX_WEBRTCADDRESS=127.0.0.1:8889 \
  -e MTX_WEBRTCLOCALUDPADDRESS=:8217 \
  -e MTX_WEBRTCLOCALTCPADDRESS=:8217 \
  -e MTX_WEBRTCADDITIONALHOSTS=127.0.0.1 \
  -e MTX_RTSP=no -e MTX_RTMP=no -e MTX_HLS=no -e MTX_SRT=no \
  -e MTX_MOQ=no -e MTX_API=no -e MTX_METRICS=no \
  bluenviron/mediamtx:1

# terminal 2 — esta API (aponta para o MediaMTX por loopback)
MEDIAMTX_INTERNAL_URL=http://127.0.0.1:8889 go run .

# terminal 3 — tela-frontend com hot reload (proxia /api e /ws para :8000)
cd ../tela-frontend && npm install && npm run dev
```

Sem `MEDIAMTX_INTERNAL_URL` as salas funcionam, mas o compartilhamento de
tela é recusado com uma mensagem clara.

```bash
go test ./...   # proxy MediaMTX, autorização, ciclo de vida da sala
```

## API

| Rota | O quê |
| --- | --- |
| `POST /api/rooms` | cria uma sala — `{password}` → `{roomId}` |
| `GET /api/rooms` | salas com alguém dentro agora — a lista "salas rolando" da home |
| `GET /api/rooms/{id}` | status público — quantas pessoas e quantas compartilhando |
| `POST /api/rooms/{id}/check` | valida a senha antes de abrir o WebSocket |
| `POST /api/rooms/{id}/knock` | pede para entrar sem a senha — `{name}` → `{requestId}` |
| `GET /api/rooms/{id}/knock/{requestId}` | status do pedido, com `admitToken` quando aprovado |
| `GET /ws?room=&password=` (ou `&admitToken=`) | sinalização |
| `GET /api/rtc/ice` | servidores ICE do navegador (STUN sempre, TURN quando configurado) |
| `GET /healthz` | liveness + número de salas |

Mensagens do WebSocket: `welcome` (com a lista de quem já está na sala,
quem já está compartilhando e qualquer pedido de entrada ainda sem
resposta), `peer:join`, `peer:leave`, `peer:rename`, `publish:start`,
`publish:stop`, `publish:offer`/`publish:answer`, `subscribe:offer`/
`subscribe:answer`, `room:reset`, `spotlight:set`, `knock:request` e
`knock:resolved`. Nos quatro de oferta/answer o servidor só repassa o
SDP cru para o MediaMTX e devolve a resposta — nunca olha dentro do SDP
(ver `internal/mediamtx` e `internal/httpapi/ws.go`).

Quem entra pode digitar um nome; quem deixa em branco recebe uma
palavra pequena e aleatória em português (“Abacate”, “Girafa”…) em vez
de um nome de pessoa de verdade — ninguém faz login, mas um grid sem
rótulo nenhum fica ilegível.

## No celular

Assistir funciona normalmente. **Compartilhar a tela não**: nenhum
navegador de celular implementa `getDisplayMedia`. A interface detecta
isso e oferece a câmera no lugar, dizendo por quê, em vez de deixar um
botão que só falharia.
