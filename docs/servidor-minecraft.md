# Servidor de Minecraft na VPS

Estado em outubro/2026: servidor de **Minecraft Java 26.3** (Paper) para
jogar com os amigos, rodando como **stack do Dockhand** (`stacks/minecraft.yml`)
na VPS Oracle Ampere (arm64). Este documento é o runbook: como entrar, como
gerenciar a whitelist in-game, onde ficam os dados e como operar/backup.

> Versão: o Minecraft mudou para versionamento por ano — **26.3** é a release
> atual (Paper build 205). `VERSION` está fixada no compose de propósito; ver
> "Atualizar" abaixo.

## TL;DR operacional

| O quê | Valor |
|---|---|
| Endereço para os jogadores | `mc.giomartins.dev` (ou `168.138.135.6`), TCP `25565` |
| Versão | Java Edition **26.3** (cliente vanilla, sem mod) |
| Entrar na whitelist | **in-game**, por um OP: `/noblewl add name <Nick>` |
| Listar a whitelist | `/noblewl list` |
| Remover | `/noblewl remove name <Nick>` |
| Ligar/desligar a whitelist | `/noblewl on` / `/noblewl off` (sobe sempre **on**) |
| Console do servidor | `docker exec -it minecraft rcon-cli` |
| Logs | `docker logs -f minecraft` |
| Mundo (o que importa) | `/data/minecraft/world` no host |
| Backup | `/data/minecraft-backups` (diário, 7 dias) |

## Por que Paper em container (e não vanilla, e não nativo)

O Project Zomboid precisou de systemd + box64 **porque só existe binário
x86-64** (`docs/servidor-zomboid.md`). Minecraft não tem esse problema: o
servidor é Java puro, então o jar do Paper roda **nativo** em arm64. O
container é o `itzg/minecraft-server` (multi-arch, tag `java25` — o 26.3 exige
Java 25), que baixa o Paper do build mais recente de `VERSION` no boot e
mantém tudo em `/data`.

Paper em vez de vanilla: mesma compatibilidade de cliente, performance muito
melhor em hardware modesto, e suporta plugins — que é o que permite a
whitelist por nome (abaixo). Não há nada para compilar aqui, então **não** tem
imagem no registry nem workflow de build (diferente de tela/maus/excalidraw).

## Whitelist por nome (por que não a vanilla)

O grupo tem contas **não-premium**, então o servidor roda `ONLINE_MODE=false`:
ele **não autentica ninguém** e qualquer pessoa pode entrar usando qualquer
nome. Nesse modo a whitelist é a única porta.

A whitelist vanilla não serve: com `online-mode=false` ela grava o UUID
"offline" derivado do nome, e o comando `/whitelist add <Nick>` exige que o
jogador exista na Mojang — o que um amigo não-premium nunca vai. O plugin
[NobleWhitelist](https://modrinth.com/plugin/noble-whitelist) (1.2.26, suporte
a 26.3) resolve: whitelist **por nome**, gerenciada **dentro do jogo**.

### Fail-closed

O plugin sobe com a whitelist **desligada** por default no `config.yml`. Para
não existir uma janela em que o servidor está no ar e aberto, o compose passa:

```yaml
RCON_CMDS_STARTUP: "noblewl on"
```

O log confirma no boot: `[Rcon loop] running - noblewl on`. Verificado: um
nome fora da lista recebe `You are not whitelisted on this server.`; depois de
`/noblewl add name <Nick>`, entra.

### Adicionar os amigos (o dia-a-dia)

1. O dono entra no jogo (precisa estar na lista — adicione-se pelo console na
   primeira vez: `docker exec -it minecraft rcon-cli "noblewl add name SeuNick"`).
2. No chat: `/noblewl add name NickDoAmigo`.
3. O amigo conecta em `mc.giomartins.dev`.

Para dar OP a alguém (necessário para gerenciar a whitelist in-game):
`docker exec -it minecraft rcon-cli "op <Nick>"` — em offline-mode o `op` por
nome funciona e casa com o UUID offline.

> **Limite honesto do modelo:** com `online-mode=false` + whitelist por nome,
> quem souber o nome de um amigo da lista pode entrar com aquele nome. Não há
> como evitar isso sem autenticação; o nome é a credencial. Se isso virar
> problema, o caminho é um plugin de login/senha (AuthMe-like) ou migrar todos
> para contas premium e ligar `online-mode=true`.

## Portas e firewall (duas camadas)

A `25565/tcp` é publicada direto no host (não é HTTP; não passa pelo ingress
nem pelo Cloudflare). Para ela funcionar, **as duas camadas** precisam estar
abertas:

| Camada | Onde | Estado |
|---|---|---|
| iptables do host | `modules/infra/terraform/main.tf` → `firewall_rules` `"tcp 25565"`, aplicado pelo `host_baseline` | no código; aplicar com o TF |
| Oracle Security List | console OCI → Networking → VCN → Security Lists → Add Ingress Rule | **manual** (nenhum script dentro da VM abre isso) |

Regra na Security List: source `0.0.0.0/0`, protocolo **TCP**, porta
`25565`. Sem ela, a porta fica em timeout mesmo com o iptables aberto — foi
exatamente o que aconteceu no primeiro teste (a mesma pegadinha que o Zomboid
já tinha registrado).

Enquanto a regra da OCI não existir, dá para validar localmente na VPS:

```bash
docker exec minecraft rcon-cli list          # o server está de pé?
# da VPS para ela mesma:
python3 -c "import socket; socket.create_connection(('127.0.0.1',25565),5); print('porta ok')"
```

## Dados e persistência

Bind mounts no host (não named volumes), porque o mundo é o dado menos
recuperável deste host e assim ele é copiável sem `--volumes-from`:

| Caminho no host | Conteúdo | Regenerável? |
|---|---|---|
| `/data/minecraft/world` | **o mundo** | NUNCA |
| `/data/minecraft/plugins/NobleWhitelist/whitelist.sql` | a whitelist | pequena, mas anote os nomes |
| `/data/minecraft/server.properties`, `config/` | ajustes do server | regenerável (o compose reescreve o que define) |
| `/data/minecraft/plugins/*.jar` | o plugin | sim (Modrinth, pinado no compose) |
| `/data/minecraft-backups` | os `.tar.gz` do backup | é o backup |

O backup (`itzg/mc-backup`, segundo serviço da stack) fala RCON com o server
para `save-all flush` + pausar a escrita antes de copiar — o `.tgz` é
consistente, não um `cp` de arquivo aberto. Roda a cada 24h (10 min após o
boot), adia se não houver ninguém online, e guarda 7 dias. O destino fica
**fora** do `/data` do jogo (se o mundo corromper, o backup não corrompe
junto).

Backup manual agora:

```bash
docker exec minecraft-backup backup now
ls -lh /data/minecraft-backups
```

**Ainda é o mesmo disco.** Para sobreviver à perda da VM, copie para fora
(rclone para R2/S3, ou `scp` para outra máquina). Isso não está automatizado —
é o próximo passo óbvio se o mundo virar importante.

## Operação dia-a-dia

```bash
# status / saúde
docker ps --filter name=minecraft --format '{{.Names}}\t{{.Status}}'
docker logs -f minecraft                       # log ao vivo

# console (RCON, sem precisar do tty)
docker exec -it minecraft rcon-cli
docker exec minecraft rcon-cli "list"          # quem está online
docker exec minecraft rcon-cli "say aviso"     # mensagem no chat

# parada graciosa (salva o mundo antes de sair)
docker stop minecraft                          # o runner manda "stop" via RCON

# whitelist
docker exec minecraft rcon-cli "noblewl list"
docker exec minecraft rcon-cli "noblewl add name Nick"
docker exec minecraft rcon-cli "noblewl remove name Nick"
docker exec minecraft rcon-cli "noblewl status"
```

`docker stop` espera até 60s pela parada graciosa; o mundo é salvo nesse
caminho. **Evite `docker kill`** — mata sem salvar o que estava em memória.

## Atualizar a versão do Minecraft

O mundo **sobe de versão e não desce**: um mundo aberto no 26.3 não abre mais
no 26.2. Por isso `VERSION` é fixa e atualizar é um ato deliberado.

1. Rode um backup e copie o `.tar.gz` para fora: `docker exec minecraft-backup backup now`
2. Confira que o Paper tem build para a versão nova:
   `curl -s https://fill.papermc.io/v3/projects/paper` (a lista de versões).
3. Troque `VERSION` em `stacks/minecraft.yml`.
4. Suba a stack pelo Dockhand (ou `docker compose -f stacks/minecraft.yml up -d`
   no host, se estiver testando).
5. Se o plugin da whitelist não suportar a versão nova, o server **sobe aberto**
   — o `RCON_CMDS_STARTUP` falha silencioso se o plugin não carregou. Confira
   no log: `[NobleWhitelist] Enabling` **e** `[Rcon loop] running - noblewl on`.
   Se o plugin não carregar, pare o server até resolver.

## Troubleshooting

- **Amigo não conecta, server saudável** → quase sempre a Security List da OCI
  (acima), não a VM. `nc -z -G 3 168.138.135.6 25565` de fora confirma.
- **"You are not whitelisted on this server."** → falta `/noblewl add name <Nick>`
  (o nome exato, com maiúsculas como o cliente manda).
- **"Outdated client! Please use 26.3"** → cliente em outra versão. O servidor
  é vanilla-compatible: o launcher precisa selecionar 26.3.
- **Chat diz "mensagens não assinadas"/some** → `ENFORCE_SECURE_PROFILE` deve
  ficar `false` em offline-mode (já está no compose).
- **Boot lento na primeira vez** → o Paper baixa o jar e gera o mundo; o
  healthcheck tem `start_period: 5m`. Não reinicie por impaciência.
- **`RCON_PASSWORD` faltando** → é variável de stack no Dockhand (nunca no
  git); sem ela o compose recusa subir, por design.

## Segredos

`MINECRAFT_RCON_PASSWORD` — variável de stack no Dockhand (criptografada no DB
dele), usada pelo server e pelo backup. Não é publicada no host: o RCON só
existe no loopback do container, alcançado pelo backup por compartilhar a
netns. Nenhum outro segredo (não há senha de jogo; o gate é a whitelist).
