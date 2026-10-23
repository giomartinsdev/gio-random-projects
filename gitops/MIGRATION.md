# Plano de migração — Docker Compose → Kubernetes

> Estado: em execução. Fatias concluídas marcadas com ✅.
> Última atualização: 2026-10-23.

## Princípio

Nada em Docker é destruído antes do equivalente em k8s provar que serve. Cada
serviço migra em **duas etapas**: (1) sobe em paralelo no k8s, validado por
NodePort; (2) o `proxy_pass` do ingress vira, e o Docker é desligado só depois
de um período de observação.

O Docker nunca é removido no mesmo commit que o k8s entra.

## A alavanca: DNS como interruptor

As aplicações não referenciam IPs — referenciam **nomes**:

```
postgres:5432   rabbitmq:5672   minio:9000   alloy:4318   evolution-redis:6379
```

Consequência: migrar um serviço de dados não exige editar a configuração de
nenhum consumidor. O nome fica igual; o que muda é para onde ele resolve.

- Enquanto o Docker existir, `postgres` resolve para o container Docker
  (DNS da rede `apps`).
- Depois do cutover, resolve para o `Service` do k8s.

Para que isso funcione, **todo Service de dados no k8s tem exatamente o mesmo
nome do serviço no Compose**. Não é cosmético: é o que evita reescrever env
vars em 10 stacks.

## Ordem das fatias

A ordem é por risco crescente, e não por importância. Estado é sempre por
último, porque é o único que não tem rollback barato.

| # | fatia | serviços | estado | rollback |
| --- | --- | --- | --- | --- |
| 1 ✅ | stateless puro | `excalidraw`, `adminer` | — | trivial |
| 2 ◐ | stateless com volume próprio | `9router` | SQLite + WAL | **parada obrigatória** |
| 3 ✅ | apps com dependência de dados | `domain-api` ✅, `domain-worker` ✅, `finance-api` ✅, `finance-*` ✅, `vaultwarden-api` ✅, `db-mcp` ✅ | — | trivial |
| 3b ✅ | tráfego de apps já migrados | `adminer`, `draw`, `domain`, `finance-api` no ingress | — | uma linha |
| 4 ✅ | observabilidade | `prometheus`, `loki`, `tempo`, `grafana` ✅ + `alloy-logs` (novo, absorveu o OTLP em 2026-10-23) | volumes | médio |
| 5 ✅ | dados de apoio | `minio` ✅, `rabbitmq` ✅ | volumes | médio |
| 6 ✅ | dados primários | `postgres`, `vaultwarden` | volumes | **alto** |
| 7 ☐ | ingress + registry | `ingress`, `registry` | — | alto |

**A fatia 6 foi fechada em 2026-10-23.** Antes dela, o usuário pediu o Rancher
como plano de controle (2.15.2 instalado e validado, ver README). A fatia
exigia janela e a exigência foi paga do jeito mais barato possível:

`vaultwarden` primeiro (1 MB de SQLite), porque provava o procedimento de volume
stateful de ponta a ponta sem encostar no banco onde tudo mora. Depois o
`postgres` (2.4 GB), com paridade medida contra um baseline anotado **antes** da
parada: 54 das 55 tabelas com contagem idêntica e `finance_transactions` com
md5 do dado idêntico (`89358a62`, 1176 linhas). A única tabela que divergiu foi
`audit_log` (+1458 linhas), que é a tabela de escrita ativa — cresceu depois do
baseline, não é divergência.

O que autorizou o corte do postgres não foi `pg_isready`: um PGDATA vazio
inicializado na hora também responde. Foi o log do pod dizer
`database system was shut down at 16:24:07` e `ready to accept connections`
**sem** `initdb` (`Skipping initialization`), e a prova de que uma conexão nova
pelo Service chega ao pod (`inet_server_addr()` = IP do pod, com o Docker já
parado).

Os dois cutovers foram em commits separados de propósito: o pod sobe
(`replicas: 1`), prova que lê o dado, e **só então** o Service vira. No caso do
postgres, isso significou 3 commits (manifesto → pod → Service+ponte).

**A armadilha que a fatia custou** (detalhe no README, seção de pontes): o
timer `sync-external-endpoints` recriava o EndpointSlice manual a cada minuto, e
com **dois** EndpointSlices para o mesmo Service o kube-proxy balanceia entre
eles. O domínio servia ora o pod, ora o container. No vaultwarden o sintoma era
mudo (os dois respondem o mesmo `/api/config`); no postgres seria escrito nos
dois bancos. Por isso os dois saíram do `MAPA` do timer **no mesmo commit** em
que o Service ganhou selector.

**Plano de controle exposto em 2026-10-23**: `https://rancher.giomartins.dev`
(DNS via Terraform, `server{}` com upstream HTTPS no ingress). Não entra como
fatia — não é migração de serviço, é ferramenta de operação. O `server-url` do
Rancher aponta para esse hostname, então agentes futuros já nascem certos.

**A fatia 6 tinha um furo que só apareceu no fim do dia.** O `restart: "no"` que
aplicamos nos serviços migrados não impedia a ressurreição: o Dockhand roda
`compose up` nos projetos `project-infra` e `project-apps` **todo dia às 03:00
UTC** (`auto_update=1`), e `up` sobe container parado mesmo com `restart: "no"`.
O log de 03:00 daquele dia mostra `Container postgres Recreate → Started`. Sem
correção, os volumes congelados do `postgres`/`vaultwarden` voltariam a subir
contra os pods na madrugada seguinte, e duas sessões Baileys disputariam o mesmo
número.

A trava correta é `profiles: ["retired"]`, validada em sandbox (`up` pula,
`--remove-orphans` não remove, volume sobrevive). Doze serviços passaram a
tê-la; onze ficaram de fora por ainda estarem vivos (`evolution-redis`, `minio`,
`alloy`, `9router`, `db-mcp*`, observabilidade, `excalidraw`, `tela-*`, `maus*`).
Rollback segue sendo uma flag: `docker compose --profile retired up -d <svc>`.
Detalhe na armadilha 13 do README.

**O `rabbitmq` foi cortado em 2026-10-23.** Um broker é ponto de encontro
compartilhado: se o Service passasse a apontar para o pod enquanto algum consumidor
ainda estivesse em Docker, ficariam dois brokers com zero estado compartilhado —
`domain-api` publica num, `domain-worker` consome do outro, sem erro em log
nenhum. Por isso a ordem foi: migrar os quatro consumidores primeiro
(`evolution-api`, `domain-worker`, `finance-customersupport-worker`, e parar os
containers órfãos de `domain-api`/`finance-api`), e só então trocar o Service.

O corte foi autorizado por comparação, não por "o pod subiu": os dois brokers
rodaram em paralelo e `list_queues` / `list_exchanges` / `list_bindings` / `list_users`
deram **diff vazio** (29 filas, 12 exchanges, 62 bindings, 1 usuário), incluindo as
2341 + 9 mensagens de backlog. Um mnesia vazio também responde `ping` e sobe
`1/1 Running` — o probe não distingue broker cheio de broker vazio.

Fatias 5 e 6 são as únicas que exigem janela de manutenção. Todas as outras
são quentes — com uma exceção que apareceu na prática: o `9router` também
exige parada, não por ser stateful no sentido clássico, mas porque SQLite em
WAL não admite dois escritores. "Stateless com volume próprio" não é sinônimo
de "cutover quente".

A fatia 2 encolheu: `hub` não é um container (é um bucket servido pelo
`minio`), e `maus` precisa de `docker.sock` + `/data` do host — não migra sem
redesenho. Sobrou o `9router`, e ele tem SQLite com WAL ativo, então deixou de
ser "trivial" e foi para depois da fatia 3.

O que a fatia 3 provou, e que importa mais que a lista: um serviço migrado
alcança outro serviço migrado (`finance-api` → `domain-api`), e alcança um que
ficou em Docker (`domain-api` → `postgres`) — **sem alterar uma única env var**.
A composição de serviços em estágios diferentes de migração funciona.

## O que já está em produção no cluster (fatia 3b ✅)

Três cutovers de tráfego HTTP e um serviço de background:

| host | antes | agora | paridade provada por |
| --- | --- | --- | --- |
| `adminer.giomartins.dev` | `:8092` Docker | `:30092` k8s | HTML idêntico (fora nonce/token) |
| `draw.giomartins.dev` | `:8023` Docker | `:30023` k8s | sha256 do HTML **e** do bundle JS |
| `domain.giomartins.dev` | `:8000` Docker | `:30800` k8s | resposta autenticada de dado real |
| `finance-api.giomartins.dev` | `:8018` Docker | `:30818` k8s | corpo 422 + CORS header a header |
| `finance-openfinance-worker` | Docker | pod `replicas: 1` | `finance_of_raw.captured_at` |

O `finance-openfinance-worker` foi o **primeiro container desligado de vez**
(`exited`), não apenas posto em paralelo.

### A regra de desligamento que emergiu

Um container Docker continua sendo usado mesmo depois do cutover do ingress:
o DNS do Docker resolve `domain-api` para o **container**, não para o ClusterIP
do pod. O worker em Docker seguiu postando no container depois do cutover.

Portanto: **só desligue o container depois de migrar todos os consumidores
internos dele**. Verificado com container efêmero na rede `apps` — as duas
rotas coexistem (`domain-api:8000` → container, `10.43.x.x:8000` → pod), e o
que decide é o nome que o cliente usa.

### A ordem correta para trocar um worker

```text
1. remover o patch de replicas do kustomization (git = fonte da verdade)
2. esperar o ArgoCD reconciliar e o pod ficar 1/1
3. confirmar no log que ele executa o trabalho
4. só então parar o Docker
```

A ordem inversa (parar o Docker primeiro) cria lacuna: com `selfHeal` ligado,
`kubectl scale` é revertido em segundos e o pod nunca sobe. Aconteceu, e o
worker ficou parado dos dois lados por ~3 min.

## Como o estado é preservado

Três barreiras, nesta ordem:

1. **Backup verificado antes de qualquer movimento.**
   `pg_dumpall` comprimido + `rabbitmqctl export_definitions` + os volumes
   copiados com `tar`. Um dump que não foi testado não é backup.

2. **Cópia, nunca movimento.** O volume Docker continua intacto. O k8s monta
   um PVC próprio, populado a partir do dump ou de um `tar` do volume. Se algo
   der errado, o dado original nunca foi tocado.

3. **O Docker só desliga depois.** Enquanto o PVC não estiver validado, os
   dois bancos coexistem. Postgres em Docker e em k8s na mesma máquina, portas
   diferentes, dados separados.

## Onde ficam os segredos

Nunca no git — o repositório é público. O padrão é `Secret` no namespace
`giomartins`, criado por um script de bootstrap que lê o `.env.dockhand` do
host. O manifesto referencia via `secretKeyRef`, então o YAML é público e
inofensivo.

## Dívidas conhecidas

- O IP do container `postgres` aparece no `EndpointSlice` do adminer. Quebra se
  o container for recriado com outro IP. Morre junto com a fatia 6.
- O patch do `argocd-cm` (exclusão de `EndpointSlice`) não está versionado.
- `docker compose` no host ainda é o plano de controle de 31 containers.
