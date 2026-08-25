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

Tudo em memória (`internal/rooms`). Uma sala é um código de 6 caracteres,
o hash scrypt da senha e quem está conectado agora. Um restart derruba
todas as salas — o que é o comportamento certo para algo cuja vida útil é
"alguém está compartilhando a tela neste momento".

Salas vazias são removidas depois de 10 minutos (para o host sobreviver a
um reload ou uma queda de wifi), e qualquer sala morre com 12 horas.

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
