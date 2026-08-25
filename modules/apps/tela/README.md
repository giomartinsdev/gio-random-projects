# tela

Compartilhamento de tela em `tela.giomartins.dev`. Alguém cria uma sala com
uma senha e passa o código; quem entra vê um grid com todas as telas sendo
compartilhadas e pode abrir qualquer uma em tela cheia. Sem cadastro, sem
banco de dados.

Todo mundo na sala é participante igual: qualquer pessoa pode começar a
compartilhar a qualquer momento, várias ao mesmo tempo, e parar sem
atrapalhar as outras.

Não tem relação com os outros apps deste repositório: não usa Postgres,
não usa o Better Auth do post-api, não fala com o domain-api. Um container,
um domínio.

## Como funciona

O vídeo **não passa por este servidor**. Os navegadores se conectam
diretamente por WebRTC; o servidor só apresenta uns aos outros,
repassando offer/answer/ICE pelo WebSocket. O custo do servidor não
cresce com a resolução nem com o número de telas.

É uma malha: cada par de pessoas pode precisar de **duas** conexões — uma
levando o stream de A até B, outra o de B até A. São separadas de
propósito, porque uma conexão só com os dois lados ofertando ao mesmo
tempo cai em *glare*. Por isso cada mensagem de sinalização carrega o
papel de quem enviou (`publisher` ou `subscriber`): sem isso um candidato
ICE seria ambíguo entre as duas conexões.

O preço da malha é o upload de quem compartilha, que se multiplica pelo
número de pessoas na sala. Funciona bem para um grupo pequeno; passar
disso pediria um SFU.

Só há STUN público configurado, sem TURN. Cobre redes domésticas e a
maioria dos NATs de consumidor; atrás de NAT simétrico ou firewall
corporativo restritivo a conexão simplesmente não estabelece, e o
espectador fica em "conectando…".

## Estado

Uma sala é um código de 6 caracteres, o hash scrypt da senha e uma chave
que assina tokens de retomada. **Isso é persistido** (`STATE_FILE`, num
volume) para que um deploy não acabe com sessões em andamento. Quem está
conectado **não** é persistido: são WebSockets vivos que morrem com o
processo de qualquer jeito, e cada cliente reconecta e se re-anuncia.

Salas vazias são removidas depois de 10 minutos (o suficiente para todo
mundo reconectar), e qualquer sala morre com 12 horas. Sem `STATE_FILE`
tudo fica só em memória — é o modo de desenvolvimento local.

## Deploy sem interromper quem está usando

O ponto de partida é que **o vídeo não passa por este servidor**. Uma vez
que a conexão WebRTC existe, o stream vai direto entre navegadores: se o
container morrer agora, quem está assistindo continua assistindo. O
servidor só carrega sinalização. Então o problema não é zero downtime, e
sim tornar a lacuna de alguns segundos invisível.

Três peças fazem isso:

1. **O cliente reconecta sozinho**, com backoff de 500ms a 8s e jitter
   (para uma sala cheia não voltar toda no mesmo instante e atropelar o
   servidor que acabou de subir).
2. **A identidade sobrevive.** Na primeira entrada o servidor emite um
   token de retomada (HMAC de uma chave por sala); o cliente guarda e
   reapresenta ao reconectar. Voltar com o mesmo `peerId` é o que faz as
   conexões WebRTC existentes continuarem valendo — sem isso cada
   reconexão seria uma pessoa nova e tudo seria renegociado. O token é
   exigido em vez de confiar no id porque, só com o id, um membro da sala
   poderia se passar por outro.
3. **Período de graça de 12s** antes de derrubar o vídeo de quem sumiu.
   Cobre o caso de um cliente só piscando (wifi ruim, reload): se voltar
   dentro da janela com a mesma identidade, o teardown é cancelado.

O `welcome` já carrega o estado completo da sala, então a reconexão
ressincroniza sozinha — quem estava publicando se re-anuncia e oferece
apenas para quem ainda não tem conexão.

### Fazendo o deploy

Não precisa de janela de manutenção para o caso normal:

```bash
gh workflow run go-ci-cd.yml -f app=tela
```

O container é recriado, fica alguns segundos fora, e os clientes voltam
sozinhos. Se quiser conferir antes se tem gente usando:

```bash
curl -s https://tela.giomartins.dev/healthz   # {"rooms":N,...}
```

### O que ainda interrompe

- Quem estiver **no meio da negociação WebRTC** no exato instante do
  restart perde e refaz. Fica invisível para streams já estabelecidos,
  não para quem está entrando naquele segundo.
- Se o volume for perdido, as salas somem e ninguém consegue voltar.
- Um restart que passe de ~12s estoura o período de graça e o vídeo cai
  (embora a sala e a senha continuem funcionando).

## Senha

A senha da sala é a única credencial que existe: quem tem, entra, e quem
entra pode tanto assistir quanto compartilhar. Não há dono nem host — a
pessoa que criou a sala não tem nenhum poder a mais que as outras.

Ela viaja pelo estado de navegação do React, nunca pela URL, para que o
link possa ser colado em qualquer lugar sem vazar o acesso.

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
| `POST /api/rooms` | cria uma sala — `{password}` → `{roomId}` |
| `GET /api/rooms/{id}` | status público — quantas pessoas e quantas compartilhando |
| `POST /api/rooms/{id}/check` | valida a senha antes de abrir o WebSocket |
| `GET /ws?room=&password=` | sinalização |
| `GET /healthz` | liveness + número de salas |

Mensagens do WebSocket: `welcome` (com a lista de quem já está na sala e
quem já está compartilhando), `peer:join`, `peer:leave`, `publish:start`,
`publish:stop` e `signal`. O servidor nunca olha dentro do `payload` de um
`signal` — SDP e ICE são assunto dos navegadores. Ele só confere que o
destinatário está na mesma sala e carimba quem realmente enviou (ver
`Room.Relay`).

Cada pessoa recebe um nome automático (“Pessoa 1”, “Pessoa 2”…) na ordem
de entrada — ninguém faz login, mas um grid sem rótulo nenhum fica
ilegível.

## No celular

Assistir funciona normalmente. **Compartilhar a tela não**: nenhum
navegador de celular implementa `getDisplayMedia`. A interface detecta
isso e oferece a câmera no lugar, dizendo por quê, em vez de deixar um
botão que só falharia.
