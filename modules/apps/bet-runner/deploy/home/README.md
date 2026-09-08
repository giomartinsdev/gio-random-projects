# bet-runner em casa

O Chrome que aposta roda na rede de casa (IP residencial), não no VPS —
e sempre headed sob Xvfb: a página "Access to this page is restricted
due to security and compliance measures" da Betano responde ao
**browser headless** (apareceu de IP residencial também, em modo
headless), não ao ASN de datacenter como se suspeitou primeiro; headed,
o mesmo IP passa. O container roda com `HEADED=1` e o CMD do Dockerfile
já sobe o `xvfb-run` — nada a configurar. Este diretório é o deploy
substituto do que era o módulo terraform `compute_apps_bet_runner`.

## Setup (uma vez)

```bash
mkdir -p ~/.config/bet-runner-home
cat > ~/.config/bet-runner-home/.env <<EOF
# /internal/* do bet-api — o valor está no Vaultwarden (item "bet").
RUNNER_API_KEY=<do vault>
BET_API_URL=https://bet-api.giomartins.dev
POLL_INTERVAL_MS=5000
HEADED=1
DRY_RUN=1
EOF
```

O `.env` fica **fora do repo** de propósito (o compose aponta o caminho
absoluto); nenhum segredo mora na working tree.

## Rodar

```bash
docker compose -f modules/apps/bet-runner/deploy/home/compose.yaml up -d --build
docker compose -f modules/apps/bet-runner/deploy/home/compose.yaml logs -f
```

`--build` compila a imagem do próprio repo (o Dockerfile do app). Para
atualizar depois de um push no main: `git pull` e repita o comando (ou
`docker pull registry.giomartins.dev/bet-runner:latest` trocando
`image:` — precisa de `docker login` na registry).

## Como funciona

- O runner polla `POST https://bet-api.giomartins.dev/internal/jobs/claim`
  com `X-Runner-Key` — a borda não cobra Access de `/internal/*` (a
  autenticação é essa chave, como sempre foi no apps network).
- `/api/*` e `/auth/*` continuam atrás do Cloudflare Access
  (path-protected, precedentes: `hub.giomartins.dev/sso`) — nada mudou
  para o bet-frontend.
- Perfis do Chromium bind-mountados do host
  (`~/.config/bet-runner-home/profiles`): o login na casa de aposta
  sobrevive a restart, e o container corre com o MESMO perfil que
  qualquer teste local usou — cookies de confiança incluídos (um perfil
  virgem no container levou a parede de compliance da Betano de novo,
  mesmo headed). Apagar o diretório = novo login na próxima aposta.
- `DRY_RUN=1` percorre o fluxo inteiro mas nunca clica no confirm
  final. Virar para `0` é a única chave entre ensaio e dinheiro real —
  só depois de os receipts provarem os seletores contra o site de
  verdade.