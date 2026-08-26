# Servidor de Project Zomboid na VPS

Estado em agosto/2026: servidor dedicado de **Project Zomboid B42**
rodando **nativamente** na VPS Oracle Ampere (arm64) — **fora do
Docker e fora do Terraform**, como serviço systemd gerenciado pelo
utilitário `pzctl`. Este documento é o runbook completo: por que chegou
aqui, como está montado, onde ficam os dados e como operar.

## TL;DR operacional

| O quê | Valor |
|---|---|
| Endereço para os jogadores | `168.138.135.6`, UDP `16261` |
| Senha de join | no ini: `~/Zomboid/Server/servertest.ini` (chave `Password=`) |
| Senha de admin in-game | no unit do systemd (`systemctl cat zomboid-b42.service`, flag `-adminpassword`) |
| Gerência diária | `ssh ubuntu@168.138.135.6` → comando `pzctl` |
| Logs ao vivo | `~/Zomboid/server-console.txt` ou `journalctl -u zomboid-b42.service -f` |
| Marcador de "pronto" | `LuaNet: Initialization [DONE]` no console |
| Saves (o que importa) | `~/Zomboid/Saves` |
| Backup | `pzctl` → backup (grava em `~/pz_backups`) |

## Por que NÃO é um container Docker

A VPS é **aarch64** (Ampere A1); o Project Zomboid e o SteamCMD só
existem para x86-64. A tentativa original — módulo Terraform
`compute/services/zomboid` com a imagem `sknnr/project-zomboid-server`
— falhou em cadeia:

1. A imagem só publica variante **amd64**; aqui ela roda sob emulação
   QEMU (binfmt).
2. O SteamCMD dela **segfaulta deterministicamente** no
   `Loading Steam API...` sob QEMU (confirmado 3/3 tentativas idênticas)
   — o container nunca passou de crash-loop.
3. Mesmo com o download resolvido, a JVM do jogo sob QEMU seria lenta
   demais para jogar.

Imagens comunitárias arm64 foram avaliadas e descartadas: nenhuma tem o
contrato de env vars/secrets que este repo usa, e a mais próxima
(joyfui) exige intervenção manual interativa no primeiro boot.

O módulo Terraform foi revertido (commit `1b469a1`) e há uma nota no
root `main.tf` para não re-adicioná-lo como container sem resolver o
problema de arquitetura antes.

## Arquitetura atual

Instalado pelo one-shot installer
[kaanzapkinus/zomboid-b42-on-arm](https://github.com/kaanzapkinus/zomboid-b42-on-arm)
(referência testada exatamente nesta classe de VM: Oracle Ampere A1).
Re-run do installer atualiza o jogo.

Componentes:

- **box64** (apt `ryanfortner/box64-debs`, pacote `box64-generic-arm`)
  — executa os binários x86-64 via recompilação dinâmica, registrado
  no `binfmt_misc` (muito mais rápido que QEMU user-mode).
- **DepotDownloader** (binário .NET **nativo arm64** em
  `/opt/depotdownloader`) — baixa os depots Steam do app `380870` sem
  passar pelo SteamCMD quebrado.
- **ciopfs** — FUSE case-insensitive montado em
  `/opt/zomboid-server/steamapps/workshop/content/108600` (workshop de
  mods exige case-insensitivity).
- **systemd**:
  - `zomboid-b42.service` — o servidor (`Restart=always`,
    `RestartSec=20`; crash = religa sozinho).
  - `zomboid-b42-ciopfs.service` — mount do workshop (dependência).
  - `zomboid-b42-watchdog.timer` — a cada ~3 min detecta boot travado
    e age ("boot-hang watchdog").
  - `zomboid-b42-modupdate.timer` — atualização automática de mods.
- Tunings box64 aplicados via env vars no unit (`BOX64_DYNAREC_STRONGMEM=3`,
  `SAFEFLAGS=2`, `ALIGNED_ATOMICS=1`, `JVM=0`, `SSE42=0`,
  `MAXCPU=4`) + flags JVM conservadoras (`-XX:TieredStopAtLevel=1`,
  SerialGC, `-Xmx12g`) no `/opt/zomboid-server/ProjectZomboid64.json`.
- Config central do instalador: `/etc/zomboid-b42.env`.

### Portas

| Porta | Protocolo | Uso | Firewall local (iptables) | OCI Security List |
|---|---|---|---|---|
| 16261 | UDP | Steam auth/query — é a que se usa p/conectar | aberta (persistida) | **precisa de regra manual** |
| 16262 | UDP | tráfego de jogo (+1 da query) | aberta (persistida) | **precisa de regra manual** |
| 27015 | TCP | RCON (configurada no ini, não exposta) | fechada | fechada |

A iptables local foi aberta e persistida (`netfilter-persistent save`)
pelo próprio instalador. A **Security List da VCN é camada separada,
que nenhum script dentro da VM consegue abrir**: console Oracle →
Networking → VCN → Security Lists → Add Ingress Rule →
source `0.0.0.0/0`, UDP, portas 16261 e 16262.

## Persistência — o que se perde quando algo morre

Tudo vive no disco de boot da VM, em paths simples (sem volume docker):

| Caminho | Conteúdo | Regenerável? |
|---|---|---|
| `~/Zomboid/Saves` | **os mundos/saves** | NUNCA — é o único dado irreponível |
| `~/Zomboid/Server/servertest.ini` | config (senha de join, slots…) | regenerável + editável |
| `~/Zomboid/` (resto) | logs, db, mods instalados, options | parcialmente |
| `/opt/zomboid-server` (~7 GB) | binários do jogo | sim — installer baixa de novo |
| `~/pz_backups` | saídas do `pzctl backup` | é o próprio backup |

Cenários:

- **Crash do processo / boot travado** — rotina conhecida sob box64.
  O systemd religa em ~20s; mundo intacto. Perde-se no máximo o
  intervalo desde o último autosave do PZ.
- **Reboot da VM** — unidades `enabled`; tudo volta sozinho.
- **VM/disco da Oracle destruído** — perde-se tudo que não estiver em
  `~/pz_backups` copiado pra fora. Rodar `pzctl backup` antes de
  mudanças arriscadas; automatizar (cron) é recomendável.

## Operação dia-a-dia

```
pzctl                 # menu interativo: start/stop/status/logs/
                      # console/mods/settings/backup
pzctl status          # estado do serviço + portas
```

Diagnóstico manual frequente:

```bash
systemctl status zomboid-b42.service          # vivo? há quanto tempo?
ss -ulnp | grep 1626                          # portas bindadas?
tail -f ~/Zomboid/server-console.txt          # log do jogo
journalctl -u zomboid-b42.service -n 50       # stdout/stderr systemd
ls -t /opt/zomboid-server/hs_err_pid*.log     # crashes da JVM (motivo exato)
```

Trocar senhas: join → `Password=` no `servertest.ini` + restart;
admin → editar a flag `-adminpassword` no unit (`systemctl edit`) +
`daemon-reload` + restart.

Atualizar o jogo: re-run do installer (ele detecta instalação existente
e atualiza). Mudar branch (ex.: `legacy41` pro B41): re-run com
`PZ_BRANCH=legacy41` — **saves não são compatíveis entre builds**.

## Troubleshooting conhecido

- **Boot demora vários minutos** (fase `LOADING ASSETS` especialmente)
  — normal sob box64; não restartar por impaciência. Pronto =
  `LuaNet: Initialization [DONE]` no console.
- **SIGSEGV da JVM durante o loading** — já visto 5x seguidas no
  primeiro dia; o auto-restart eventualmente passa da fase. Motivo
  exato sempre em `hs_err_pid*.log` (padrão histórico: corrupção no
  dynarec durante `Matrix4f.invert`/jassimp). Se piorar: testar
  `BOX64_DYNAREC=0` (interpretador puro, lento) ou box64 mais novo.
- **"Waiting for response from Steam servers" parado** — pode ser só
  lentitude; só considerar travado se o `st:` do log não subir por
  ~5 min junto de CPU ~0%.
- **Jogador não conecta mas server saudável** — quase sempre Security
  List da Oracle faltando (acima), não a VM.
