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
| 2 ☐ | stateless com volume próprio | `9router` | SQLite + WAL | trivial |
| 3 ✅ | apps com dependência de dados | `domain-api` ✅, `domain-worker` ✅, `finance-api` ✅, `finance-*` ✅, `vaultwarden-api` ✅, `db-mcp` ✅ | — | trivial |
| 3b ✅ | tráfego de apps já migrados | `adminer`, `draw`, `domain`, `finance-api` no ingress | — | uma linha |
| 4 ☐ | observabilidade | `prometheus`, `loki`, `tempo`, `grafana`, `alloy` | volumes | médio |
| 5 ☐ | dados de apoio | `minio`, `rabbitmq` | volumes | médio |
| 6 ☐ | dados primários | `postgres`, `vaultwarden` | volumes | **alto** |
| 7 ☐ | ingress + registry | `ingress`, `registry` | — | alto |

Fatias 5 e 6 são as únicas que exigem janela de manutenção. Todas as outras
são quentes.

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
