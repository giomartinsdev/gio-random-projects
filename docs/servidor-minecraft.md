# Servidor de Minecraft na VPS (All the Mods 11)

> **Nota (2026-10):** este servidor foi **descomissionado**. O documento fica
> como registro de como estava montado (era Docker Compose; os `stacks/*.yml`
> citados foram removidos do repo). Não reintroduza Docker no host sem desenhar
> o caminho de volta antes.

Estado em outubro/2026: servidor de **All the Mods 11** (ATM11) — modpack
NeoForge de **293 mods** sobre **Minecraft 26.1.2** — rodando como **stack do
Dockhand** (`stacks/minecraft.yml`) na VPS Oracle Ampere (arm64). Este documento
é o runbook: como entrar, como gerenciar a whitelist in-game, onde ficam os
dados, e como operar/backup.

> **Antes deste pack rodava Paper 26.3 vanilla-compatible.** A troca foi
> deliberada e é irreversível do ponto de vista do mundo: o pack é **26.1.2**,
> *menor* que 26.3, e mundo não desce de versão. O mundo antigo está preservado
> (ver "O mundo antigo").

## TL;DR operacional

| O quê | Valor |
|---|---|
| Endereço para os jogadores | `mc.giomartins.dev` (ou `168.138.135.6`), TCP `25565` |
| Versão | **26.1.2** com **NeoForge 26.1.2.109** — o cliente *precisa* do pack |
| Instalar o pack no launcher | CurseForge/Prism: **All the Mods 11** `0.12.0-beta` (file ID `9187064`) |
| Entrar na whitelist | **in-game**, por um OP: `/cwhitelist add name <Nick>` |
| Listar | `/cwhitelist list` |
| Remover | `/cwhitelist remove name <Nick>` |
| Console do servidor | `docker exec -it minecraft rcon-cli` |
| Logs | `docker logs -f minecraft` |
| Mundo (o que importa) | `/data/minecraft/world` no host |
| Backup | `/data/minecraft-backups` (diário, 7 dias) |

## O que mudou em relação ao Paper

Paper roda **plugins**; NeoForge roda **mods**. Não é uma diferença de nome: são
APIs incompatíveis. Consequências práticas:

- O plugin de whitelist anterior (NobleWhitelist) **não carrega mais** — foi
  substituído pelo mod **CWhitelist**.
- O cliente vanilla **não conecta**. O servidor recusa com:
  *"You are trying to connect to a server that is running NeoForge, but you are
  not. Please install NeoForge Version: 26.1.2.109"*. Todo mundo precisa
  instalar o pack no launcher.
- Boot muito mais lento: ~85–115 s com cache quente, vários minutos na primeira
  vez (baixa ~1.3 GB de mods).
- Consumo: ~5 GB de RAM com **zero** jogadores.

## O mundo antigo (Paper 26.3)

Nada foi apagado. O mundo vanilla anterior está em dois lugares, no host:

| Caminho | O que é |
|---|---|
| `/data/minecraft-paper-26.3.tar.gz` | arquivo completo do `/data` do Paper (221 MB, 803 arquivos) |
| `/data/minecraft-old-paper/` | o mesmo `/data`, solto (para inspeção rápida) |

Para voltar ao Paper 26.3: reverta `stacks/minecraft.yml` para a versão anterior
no git, pare a stack, mova `/data/minecraft` para outro nome e restaure o
`.tar.gz` dentro de `/data`. O mundo de 26.3 **não abre** no 26.1.2 do pack e
vice-versa — por isso os dois são mantidos separados.

## Whitelist por nome (por que não a vanilla)

O grupo tem contas **não-premium**, então o servidor roda `ONLINE_MODE=false`:
ele **não autentica ninguém** e qualquer pessoa pode entrar usando qualquer
nome. Nesse modo a whitelist é a única porta.

A whitelist vanilla não serve para *adicionar* amigo pelo nome — ela exige
resolver o perfil na Mojang. O mod
[CWhitelist](https://modrinth.com/mod/cwhitelist) (`cwhitelist`, versão
`3.1-26.1+-NeoForge`) resolve: whitelist **por nome** (e opcionalmente UUID/IP),
gerenciada **dentro do jogo**.

### Fail-closed — e a pegadinha

O CWhitelist **não tem on/off**: ele chuta todo mundo que não está na lista,
sempre. Lista vazia = ninguém entra. Isso é bom (falha fechado), mas cria um
problema: num deploy com `/data` vazio não haveria ninguém para rodar o primeiro
`/cwhitelist add`.

A solução é semear no boot via RCON:

```yaml
RCON_CMDS_STARTUP: |
  cwhitelist add name TaldoJovis
```

Roda todo boot e é idempotente — na segunda vez responde
`Entry already exists: name=TaldoJovis`. O estado real fica em
`/data/minecraft/config/cwhitelist_entries.json`:

```json
[{"type":"name","value":"TaldoJovis"}]
```

> Não confunda com a env `WHITELIST` do `itzg/minecraft-server`: ela escreve na
> whitelist **vanilla** (`whitelist.json`), que está desligada
> (`ENABLE_WHITELIST=false`). Não tem efeito aqui.

### Adicionar os amigos (o dia-a-dia)

1. O dono entra no jogo (já está semeado acima).
2. No chat: `/cwhitelist add name NickDoAmigo`.
3. O amigo instala o pack ATM11 na versão `0.12.0-beta` e conecta em
   `mc.giomartins.dev`.

Outros comandos úteis:

```
/cwhitelist list                  # todos os registros
/cwhitelist remove name <Nick>    # tirar de vez
/cwhitelist reload                # reler o arquivo
/cwhitelist status                # modo (local/API) e contagem
```

### OP — cuidado com o UUID

Em `online-mode=false` o jogador entra com o UUID **offline**
(`md5("OfflinePlayer:<nome>")`), que **não** é o UUID da conta Mojang. Se o
`ops.json` tiver o UUID premium, o op **não pega**.

Descoberta em produção: a env `OPS` do itzg resolve o nome pela **API da
Mojang** e grava o UUID premium. `TaldoJovis` é conta premium de verdade —
`OPS` gravou `58ea66b5…` enquanto o runtime usa `2b38b6a0…`. Por isso a env
`OPS` **não é usada** neste stack; o op é escrito direto:

```bash
# na VPS — UUID offline de "TaldoJovis"
sudo python3 - <<'EOF'
import json
p = "/data/minecraft/ops.json"
json.dump([{"uuid": "2b38b6a0-6c5b-3345-8047-89d204865ba4",
            "name": "TaldoJovis", "level": 4,
            "bypassesPlayerLimit": False}], open(p, "w"), indent=2)
EOF
```

Para calcular o UUID offline de outro nick:

```bash
python3 -c "
import hashlib, uuid
n='NICK'
d=bytearray(hashlib.md5(('OfflinePlayer:'+n).encode()).digest())
d[6]=(d[6]&0x0f)|0x30; d[8]=(d[8]&0x3f)|0x80
print(uuid.UUID(bytes=bytes(d)))"
```

> **`op <nome>` via RCON não é confiável aqui.** Ele consulta a Mojang e, para
> nome que não está no `usercache.json`, grava o UUID errado — ou trata um UUID
> passado como argumento como se fosse um *nome* (aconteceu: virou
> `"name": "2b38b6a0-…"`). Escreva o `ops.json` direto, com o servidor parado
> ou seguido de `docker restart minecraft`.

> **Limite honesto do modelo:** com `online-mode=false` + whitelist por nome,
> quem souber o nome de um amigo da lista pode entrar com aquele nome. O nome
> **é** a credencial. A mitigação real é um mod de login/senha, ou migrar todos
> para premium e ligar `online-mode=true`.

## Portas e firewall (duas camadas)

A `25565/tcp` é publicada direto no host (não é HTTP; não passa pelo ingress
nem pelo Cloudflare). Para funcionar, **as duas camadas** precisam estar
abertas:

| Camada | Onde | Estado |
|---|---|---|
| iptables do host | `infra/terraform/main.tf` → `firewall_rules` `"tcp 25565"`, aplicado pelo `host_baseline` | no código, aplicado |
| Oracle Security List | console OCI → Networking → VCN → Security Lists → Add Ingress Rule | **manual**, já aplicado |

Regra na Security List: source `0.0.0.0/0`, protocolo **TCP**, porta `25565`.
Sem ela a porta fica em timeout mesmo com o iptables aberto — foi a pegadinha
do primeiro deploy (a mesma que o Zomboid já tinha registrado).

Se um dia voltar a dar timeout: `tcpdump` na VM durante a tentativa. **Zero
pacotes** = bloqueio na nuvem, não na VM.

## Dados e persistência

Bind mounts no host (não named volumes), porque o mundo é o dado menos
recuperável deste host e assim ele é copiável sem `--volumes-from`:

| Caminho no host | Conteúdo | Regenerável? |
|---|---|---|
| `/data/minecraft/world` | **o mundo** (+ `dimensions/`, `ftbchunks/`) | NUNCA |
| `/data/minecraft/config/cwhitelist_entries.json` | a whitelist | pequena — anote os nomes |
| `/data/minecraft/config/`, `kubejs/`, `defaultconfigs/` | ajustes do pack | parcialmente |
| `/data/minecraft/mods/*.jar` (616 MB) | os 259 jars do pack | sim (AUTO_CURSEFORGE) |
| `/data/minecraft/server.properties` | ajustes do server | regenerável |
| `/data/minecraft-backups` | os `.tar.gz` do backup | é o backup |
| `/data/minecraft-paper-26.3.tar.gz` | mundo antigo (Paper) | não — é o legado |

O backup (`itzg/mc-backup`, segundo serviço da stack) fala RCON com o server
para `save-all flush` + pausar a escrita antes de copiar — o `.tar.gz` é
consistente, não um `cp` de arquivo aberto. Roda a cada 24h (10 min após o
boot), adia se não houver ninguém online, e guarda 7 dias. `EXCLUDES` tira
`mods/`, `libraries/`, caches e logs (re-baixáveis; o pack sozinho tem 616 MB).

Backup manual:

```bash
docker exec minecraft-backup backup now
ls -lh /data/minecraft-backups
```

Conferido: o `.tar.gz` sai com ~117 MB e contém `world/level.dat` e
`world/data/` (166 entradas de mundo).

**Ainda é o mesmo disco.** Para sobreviver à perda da VM, copie para fora
(rclone para R2/S3, ou `scp`). Não está automatizado — próximo passo óbvio.

## Operação dia-a-dia

```bash
# status / saúde
docker ps --filter name=minecraft --format '{{.Names}}\t{{.Status}}'
docker logs -f minecraft

# console (RCON)
docker exec -it minecraft rcon-cli
docker exec minecraft rcon-cli "list"
docker exec minecraft rcon-cli "say aviso"

# parada graciosa (salva o mundo antes de sair)
docker stop minecraft
```

`docker stop` espera a parada graciosa; **evite `docker kill`**.

### Pausa quando vazio

O servidor tem pausa nativa (`pause-when-empty-seconds`, 1.21.2+): com 0
jogadores o processo congela e economiza CPU. Neste stack ela está **desligada**
(`PAUSE_WHEN_EMPTY_SECONDS: "0"`) de propósito: pausado, o servidor não responde
o ping do server-list e o cliente mostra "offline" mesmo estando tudo certo.
Para economizar RAM, mude para `"60"` — o custo é esse "offline" enganoso até o
primeiro connect acordar o processo.

## Atualizar o pack

O pack é **beta** (`0.12.0-beta`) e recebe updates frequentes. `CF_FILE_ID`
está fixado justamente para o servidor **não** se auto-atualizar a cada boot
(sem ele, o AUTO_CURSEFORGE pega a última versão e o loader junto).

Atualizar é ato deliberado:

1. Backup e copie para fora: `docker exec minecraft-backup backup now`
2. Descubra o novo `fileId` do pack (CurseForge → Files, ou
   `curl -s https://api.cfwidget.com/minecraft/modpacks/all-the-mods-11`).
3. Troque `CF_FILE_ID` em `stacks/minecraft.yml`.
4. Suba a stack e acompanhe o log: o pack novo pode remover/adicionar mods, e
   **mundos de modpack quebram entre versões** (regressões são comuns em beta).
5. Se o CWhitelist não tiver build para a versão nova, o server **sobe aberto**
   ou não sobe — confira no log: `CWhitelist mod is ready on server!` **e**
   `Using local whitelist file with N entries`. Se não aparecer, pare.

## Troubleshooting

- **Amigo não conecta, server saudável** → Security List da OCI (acima), não a
  VM. `nc -z -G 3 168.138.135.6 25565` de fora confirma.
- **"Please install NeoForge Version: 26.1.2.109"** → cliente sem o pack, ou
  com pack de outra versão. Instale ATM11 `0.12.0-beta`.
- **"You are not whitelisted!"** → falta `/cwhitelist add name <Nick>` (nome
  exato, com maiúsculas).
- **Server-list mostra "offline" mas está no ar** → pausa por inatividade
  (acima). Conecte direto, ou ponha `PAUSE_WHEN_EMPTY_SECONDS: "60"` → `"0"`.
- **OP não funciona** → `ops.json` com UUID premium em vez do offline (acima).
- **Boot lento** → normal: 293 mods, ~85–115 s com cache quente. O healthcheck
  tem `start_period: 15m`. Não reinicie por impaciência.
- **`RCON_PASSWORD` faltando** → variável de stack no Dockhand (nunca no git);
  sem ela o compose recusa subir, por design.

## Segredos

`MINECRAFT_RCON_PASSWORD` — variável de stack no Dockhand (criptografada no DB
dele), usada pelo server e pelo backup. Não é publicada no host: o RCON só
existe no loopback do container, alcançado pelo backup por compartilhar a
netns. Nenhum outro segredo (não há senha de jogo; o gate é a whitelist).

O CurseForge funciona **sem** API key própria: a imagem `java25` já traz uma
embutida (documentado no `itzg/minecraft-server`). Se um dia o download começar
a falhar com 403, gere uma key em `console.curseforge.com` e passe como
`CF_API_KEY` (variável de stack, nunca no git).
