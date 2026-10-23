# gitops/

O plano de controle declarativo do cluster, paralelo ao `stacks/` do
Docker Compose. **Nada aqui está em produção ainda**: os dois mundos
rodam lado a lado na mesma VPS, e a migração é serviço a serviço.

```
gitops/
  bootstrap/                   # aplicado à mão, 1x por cluster
    appset.yaml                #   ApplicationSet que varre apps/
    argocd-server-nodeport.yaml #   expõe a UI do ArgoCD na 30080
  apps/<serviço>/              # 1 pasta = 1 Application (descoberta automática)
    kustomization.yaml
    deployment.yaml
    service.yaml
```

## Por que ArgoCD e não Flux

Os dois resolveriam. ArgoCD ganhou por um motivo concreto: esta VPS já é
operada por interface gráfica (Dockhand), e o ArgoCD entrega um diff
visual entre git e cluster — que é exatamente o que falta quando o
deploy é "webhook e reza". Flux é mais leve, mas o custo de RAM aqui
(~700 MB) é irrelevante com 11,9 GB livres.

## O que o cluster NÃO faz

Decisões deliberadas, para não derrubar nada que já atende gente:

| decisão | motivo |
| --- | --- |
| `--disable traefik` | O Traefik ocuparia a porta 80 e o nginx atual perderia. Enquanto o ingress não migrar, ele é o dono da 80. |
| `--disable servicelb` | O klipper-lb também reivindica 80/443 via hostPort. |
| Ingress continua em Compose | É o caminho de entrada de 20 domínios. Migra por último. |
| Registry continua em Compose | O k3s depende dele para puxar as 10 imagens próprias. Migrar o registry para dentro do cluster cria um ciclo de boot. |
| Dockhand continua em Compose | Ele gerencia Docker, não k8s. Sai quando não houver mais nada em Compose. |

## Armadilhas que custam horas

### 1. Pods não alcançam a rede Docker

A política `FORWARD` do iptables é **`DROP`** (o k3s muda isso ao instalar).
Consequência: de dentro de um pod, `172.18.0.16:5432` (postgres) e
`172.18.0.1:5432` (gateway da bridge) dão **timeout** — embora o *host*
alcance o postgres normalmente. Isso vale para **qualquer** serviço que
migre e ainda precise falar com o que ficou em Compose.

Solução: `Service` sem selector + `EndpointSlice` apontando para o IP do
container. O kube-proxy faz DNAT na saída do pod, e o pacote passa por
`KUBE-SERVICES` em vez de `FORWARD`. O `EndpointSlice` é escrito pelo timer
`sync-external-endpoints.timer` no host (o IP do container muda a cada
redeploy do Dockhand); os `Service` moram em `gitops/apps/bridges/`.

**O nome da porta tem de ser idêntico nos dois lados.** Não basta a porta
numérica casar — se o `Service` declara `name: amqp` e o `EndpointSlice` diz
`name: rabbitmq`, o kube-proxy **não cria regra nenhuma** para aquele
ClusterIP. O sintoma é `connection refused` de dentro do pod com o ArgoCD
mostrando `Synced`/`Healthy` e o `EndpointSlice` aparentemente correto.

Isso derrubou 6 das 7 pontes de uma vez, e passou despercebido porque o
`postgres` — a única ponte exercitada até então — funcionava por coincidência:
o nome da porta nos dois lados era literalmente `postgres`. Diagnóstico:
compare `spec.ports[0].name` do Service com `ports[0].name` do EndpointSlice,
e conte as regras com `iptables-save -t nat | grep -c <clusterIP>` (tem de dar
≥2). Por isso o script **lê o nome da porta do próprio Service** em vez de
recebê-lo por parâmetro: a divergência passa a ser impossível.

### 2. ArgoCD exclui EndpointSlice por padrão

O `argocd-cm` traz `Endpoints` e `EndpointSlice` em `resource.exclusions`
(recursos que o control plane recria sozinho). Efeito perverso: o `Service`
sobe, o `EndpointSlice` **não**, e as conexões caem em `connection refused`
— enquanto os 3 recursos aparecem **`Synced`/`Healthy`** no painel. Nenhum
erro visível.

Correção — **agora versionada**, não mais aplicada à mão:

```bash
sudo ./gitops/bootstrap/argocd/apply-resource-exclusions.sh
```

A lista vive em `gitops/bootstrap/argocd/resource-exclusions.yaml` (é a do
cluster, com o cabeçalho explicando por que difere do padrão). O script faz
patch de **uma chave** do `argocd-cm` — não do ConfigMap inteiro, que tem
outras chaves (`url`, `server.insecure`, `timeout.*`) não versionadas.

Dois detalhes que o script acerta e que é fácil errar à mão:

- O `argocd-application-controller` é **StatefulSet**, não Deployment. Um
  `rollout restart deploy/...` nele falha com `not found`.
- O `restart` é obrigatório: o `argocd-cm` é lido no boot, não recarregado a
  quente. Sem ele o patch fica aplicado e sem efeito — pior que não aplicar.

Reinstalar o ArgoCD sem rodar este script reintroduz a exclusão e derruba as 7
pontes em silêncio.

### 3. Kubero exige ingress controller

O Kubero foi projetado para **nginx ingress controller + metrics-server +
cert-manager**. Instalamos o `ingress-nginx` no manifesto *baremetal*, que
expõe por NodePort (30945/30421) em vez de `hostPort` — por isso ele **não**
disputa a porta 80 com o nginx do host.

O `kube-rbac-proxy` do `deploy/operator.yaml` oficial aponta para
`gcr.io/kubebuilder/kube-rbac-proxy:v0.11.0`, que **não existe mais** (o GCR
removeu o repositório kubebuilder). A instalação oficial quebra com
`ErrImagePull` em qualquer cluster novo. Substituto que funciona e tem
arm64: `quay.io/brancz/kube-rbac-proxy:v0.11.0`.

O CR `Kubero` também precisa de `kubero.database.storageClassName`
explícito: o template upstream faz `storageClassName: ""` quando o campo
está vazio, e string vazia significa "sem storage class" — o PVC fica
`Pending` para sempre. `local-path` resolve.

### 4. O DNS do Docker sombreia o Service do k8s

Um container Docker que fala `domain-api:8000` resolve para `172.18.0.27` —
o **container Docker**, não o ClusterIP do k8s. O DNS embutido do Docker
responde primeiro, e o nome do container vence o nome do Service.

Isso é bom e ruim:

- **Bom**: virar o tráfego do ingress não quebra os consumidores internos que
  ainda estão em Docker. Eles continuam falando com o container, e o pod fica
  só atendendo o ingress.
- **Ruim**: "migrei o serviço" não significa "ninguém mais usa o container". O
  `finance-openfinance-worker` em Docker continuou postando em
  `domain-api:8000` **depois** do cutover — para o container, não para o pod.
  O container não fica ocioso, então desligá-lo derruba o worker.

Consequência de ordem: **só desligue o container Docker depois de migrar (ou
desligar) todos os consumidores internos dele**. Verificado com um container
efêmero na rede `apps`: `domain-api:8000` (container), `10.43.247.168:8000`
(ClusterIP do pod) e `postgres:5432` (ponte) respondem todos OK. As duas rotas
coexistem — o que decide é qual nome o cliente usa.

### 5. Nome da chave do ConfigMap vira nome do arquivo montado

Montar um `ConfigMap` num diretório cria **um arquivo por chave**, com o nome da
chave. Não importa como o arquivo se chamava no repositório.

O `loki.yaml` era bind-montado em `/etc/loki/local-config.yaml` no Compose, e o
argumento continuou `-config.file=/etc/loki/local-config.yaml`. Ao virar
ConfigMap com a chave `loki.yaml:`, o arquivo montado virou
`/etc/loki/loki.yaml` — e o Loki morreu com
`local-config.yaml does not exist, set config.file for custom config path`.

`prometheus.yml` e `tempo.yml` não sofreram porque neles a chave e o nome do
destino coincidiam. É uma armadilha que passa em qualquer validação de schema:
o YAML é válido, o mount é válido, e o processo não sobe.

Regra: ao converter bind mount em ConfigMap, a chave tem de ser **o nome do
arquivo no destino**, não o nome do arquivo no repo.

### 6. `commonLabels` do kustomize contamina `spec.selector`

O kustomize injeta `commonLabels` **também no `spec.selector` dos Services**.
Num `Service` de ponte isso é destrutivo: ele precisa ficar *sem* selector
para o kube-proxy usar o `EndpointSlice` manual. Com `commonLabels`, ele
passa a ter `selector: {part-of: giomartins}` — que casa com **todos** os pods
do namespace. O `endpointslice-controller` então assume o Service, cria um
`EndpointSlice` próprio e vazio, e o vazio vence o manual.

Sintoma observado: `vaultwarden-api` em `CrashLoopBackOff` com
`dial tcp 10.43.159.105:80: connect: connection refused`, ArgoCD `Synced`.

Regra: **`Service` de ponte nunca entra num kustomization com
`commonLabels`.** Use `labels:` (lista de `pairs`), que aplica só em metadata:

```yaml
labels:
  - pairs:
      app.kubernetes.io/part-of: giomartins
```

Em apps normais o `commonLabels` é inofensivo — lá o selector *precisa* casar
com os pods, e é isso que ele faz.

Resíduo que sobrevive à correção: o objeto **`Endpoints` legado** (v1,
deprecado no 1.33) criado quando o Service tinha selector. O
`endpointslicemirroring-controller` continua espelhando ele para um
EndpointSlice novo, com os IPs errados, mesmo depois de o selector sumir.
Depois de corrigir o `commonLabels`, apague `kubectl delete endpoints <svc> -n
giomartins` para cada ponte — senão o espelho ressuscita o problema.

### 7. Diretório novo no ApplicationSet pode demorar, e a ordem dos fatos engana

Criar `gitops/apps/<novo>/` e dar push **não** faz o Application aparecer. O
sintoma é `Error from server (NotFound): applications.argoproj.io "<novo>" not
found` ao tentar anotar refresh — e é fácil ler isso como "o manifesto está
errado".

O que realmente acontece, medido:

1. `annotate appset root ... refresh=hard` **não** força o gerador `git`. O
   annotation é honrado pelo controller de Application, não pelo que lista
   diretórios.
2. Depois de `rollout restart` do `applicationset-controller`, a primeira
   listagem pode vir **antes** de o `repo-server` atualizar o clone. Foi
   exatamente o que aconteceu: listagem às 11:48:43, `git fetch` concluído às
   11:49:05. A listagem viu o repo antigo e concluiu, corretamente para o que
   viu, que `9router` não existia.
3. O requeue seguinte chegou ~3 min depois, já com o clone fresco, e o
   Application apareceu.

Regra: depois de criar diretório novo, reinicie os dois (`applicationset-controller`
e `repo-server`), espere **uma** listagem nova nos logs e confira que o caminho
apareceu no `allPaths` **com o timestamp de agora** — antes de concluir que algo
falhou. Procurar `gitops/apps/<novo>` no log é a verificação honesta:

```bash
sudo k3s kubectl logs -n argocd deploy/argocd-applicationset-controller --since=5m \
  | grep "applications result from the repo service" | tail -1 \
  | python3 -c 'import json,sys; print([x for x in json.load(sys.stdin)["allPaths"] if x.startswith("gitops/apps/")])'
```

Armadilha dentro da armadilha: `kubectl logs --since=20m | grep allPaths | tail -1`
pode devolver uma linha **antiga** se o pod tiver acabado de subir. Comparar o
campo `time` do JSON com `date -u`, não confiar na posição da linha.

### 8. `.gitignore` com padrão não ancorado engole diretório do GitOps

O `.gitignore` deste repo tem uma seção de templates Python/Node, e nela estava:

```gitignore
# RabbitMQ
mnesia/
rabbitmq/
rabbitmq-data/
```

Sem a barra inicial, `rabbitmq/` casa com **qualquer** diretório chamado
`rabbitmq` em **qualquer** nível — inclusive `gitops/apps/rabbitmq/`.

A falha é silenciosa em três camadas:

| sintoma | leitura errada | o que era |
| --- | --- | --- |
| `git add -A` não reclama | "foi commitado" | o caminho foi ignorado |
| `git status` limpo | "nada pendente" | arquivo ignorado não aparece |
| `ls gitops/apps/` mostra 13 | "13 apps" | o remoto tinha 12 |

O ApplicationSet gerou **12** Applications, e eu vinha tratando o `rabbitmq` como
"provisionado desde a fatia 5" — o arquivo existia no meu disco. O PVC nunca fora
criado, e a descoberta só veio quando `kubectl get pvc rabbitmq-data` deu NotFound
no meio do cutover.

A lição é sobre qual pergunta cada ferramenta responde:

- `ls` / `find` → **existe no disco**
- `git status` → **há mudança não commitada** (não: "tudo está no remoto")
- `kubectl get` → **existe no cluster**

Para o GitOps, só a terceira importa. Depois de criar qualquer diretório novo em
`gitops/`, confirmar os dois lados:

```bash
git ls-tree -r origin/main --name-only | grep gitops/apps/<novo>   # está no remoto?
kubectl get app <novo> -n argocd                                    # o ArgoCD viu?
```

Padrões de dados (`rabbitmq/`, `mnesia/`, `postgres/`) devem ser ancorados na
raiz (`/rabbitmq/`) ou escopados por caminho. Verificar com
`git status --ignored --porcelain gitops/` — o `!!` é a única forma de ver o que
o git está escondendo.

### 9. `stacks/ingress/default.conf` do repo não era a fonte de verdade

**Esta custou 4 hosts em 502.** Ao adicionar o `server{}` do Rancher, copiei
`stacks/ingress/default.conf` do repositório para o host. O arquivo do repo
estava **desatualizado**: nas migrações das fatias 3–5 as portas foram trocadas
diretamente no host (`:8000` → NodePort `:30800`, `:8092` → `:30092`, `:3000` →
`:30300`, e o mesmo em rabbit, evolution, draw e finance-api), e o repo nunca
acompanhou. O `install` sobrescreveu as portas boas pelas antigas.

Sintoma: 4 hosts em `502` (`domain`, `evolution`, `rabbit`, `finance-api`) e o
resto funcionando — porque só os que tiveram a porta trocada quebraram.

O que protege contra isso, e que agora está no fluxo:

1. **Antes de sobrescrever, compare** — `diff <(ssh host cat arquivo) arquivo`
   deve mostrar **apenas adições**. Se aparecer qualquer linha `<` (remoção), o
   repo está atrás do host: traga o host para o repo primeiro, nunca o contrário.
2. `docker inspect ingress` → `network_mode: host`, e o mount é de **arquivo**
   (`./ingress/default.conf:/etc/nginx/conf.d/default.conf`). Substituir o
   arquivo no host **não** é visto pelo container: o bind aponta para o inode
   antigo. `nginx -s reload` recarrega o inode velho. Só `docker restart ingress`
   resolve — e ele leva ~12s, durante os quais **todos** os hosts ficam sem
   ingress.
3. Restaurar é uma linha (o backup é feito antes de cada troca), mas o certo é
   não precisar: o repo passou a ser cópia fiel do host neste commit.

Verificação de paridade, que deve virar hábito:

```bash
ssh host 'sudo md5sum /opt/giomartins/stacks/ingress/default.conf'
docker exec ingress md5sum /etc/nginx/conf.d/default.conf   # tem que bater
```

### 10. Atrás de Cloudflare, `X-Forwarded-Proto $scheme` quebra o Rancher

**Esta apareceu como "Network Error" no login.** O `server{}` do Rancher copiou o
padrão dos outros 18 hosts:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;   # ERRADO para o Rancher
```

O Cloudflare fala **HTTP** com a origem, então `$scheme` é `http`. O Rancher lê
esse header, conclui que está sendo servido por HTTP e passa a gerar **todas** as
URLs como `http://`:

```bash
curl -s http://127.0.0.1/v3-public/localProviders/local -H 'Host: rancher.giomartins.dev' \
  | jq -r .links.self
# http://rancher.giomartins.dev/v3-public/localProviders/local   ← o browser bloqueia
```

O SPA roda em página `https://`, então cada chamada para um endpoint `http://` é
**mixed content**: o browser bloqueia antes de sair, a promise do `fetch` rejeita,
e a tela mostra "Network Error". Nada aparece no log do nginx, porque a requisição
nunca chega — é por isso que esse erro não deixa rastro no servidor.

A prova que isola a causa: **direto no NodePort o Rancher gera `https://` sozinho**
(ele detecta o TLS da conexão). A única coisa que estraga é o nginx sobrescrever o
header. A correção é fixar o valor:

```nginx
proxy_set_header X-Forwarded-Proto https;   # correto: o browser SEMPRE chega por https
```

Fixar em `https` é seguro porque a perna Cloudflare→origem é sempre HTTP e o
Cloudflare sempre termina TLS para o visitante — não existe acesso por `http://`
que precise ser reportado como tal.

**Para achar esse tipo de bug, o DevTools é o único caminho**: o log do nginx
mostra `200`, e o erro existe só no browser. `list_console_messages` dá o
`Failed to load resource`; `get_network_request` no POST de login mostra o corpo
e os headers exatos que o SPA envia — foi assim que descobri que o fluxo usa
`/v1-public/login` com `{"type":"localProvider","responseType":"cookie",...}` e
não o `/v3-public/...?action=login` que eu estava testando por curl.

### 11. `rollingUpdate: null` não funciona: ServerSideApply ignora null

Trocar um Deployment existente de `RollingUpdate` para `Recreate` no GitOps
falha, e a mensagem aponta para o lugar errado:

```
Deployment.apps "vaultwarden" is invalid: spec.strategy.rollingUpdate:
Forbidden: may not be specified when strategy type is 'Recreate'
```

O manifesto não tem `rollingUpdate` nenhum — o campo foi **defaultado pela API**
quando o Deployment foi criado (`maxSurge: 25%`, `maxUnavailable: 25%`) e
sobrevive ao `type: Recreate`. A tentativa óbvia, `rollingUpdate: null` no
manifesto, **não resolve**: com `ServerSideApply` (que o ApplicationSet usa) um
`null` deixa o campo intacto em vez de removê-lo, porque "ausente" e "nulo" têm
o mesmo efeito no apply — o merge simplesmente não toca na chave.

Um `kubectl patch --type=json -p '[{"op":"remove",...}]'` também volta sem
efeito: a API re-defaulta no mesmo instante, e o patch responde `patched (no
change)`.

A saída é **deletar o Deployment e deixar o ArgoCD recriar**. Seguro quando
`replicas: 0` e não há pod — que é exatamente o estado de um manifesto de fatia
ainda não cortada. Um Deployment novo nasce sem os campos defaultados, então
`type: Recreate` passa limpo.

**Regra**: campo defaultado pela API que conflita com um valor novo não se
"corrige" mudando o manifesto. Ou o objeto nasce certo, ou é recriado.

### 12. `restart: "no"` no Compose não muda container já criado

Ao desligar de vez o `postgres`, o `vaultwarden` e o `vaultwarden-api` (fatia 6),
editei o `restart: unless-stopped` → `restart: "no"` nos arquivos do host. O
arquivo passou a dizer `no`, e o container **continuou** com `unless-stopped`:

```bash
$ docker inspect postgres -f '{{.HostConfig.RestartPolicy.Name}}'
unless-stopped            # o arquivo diz "no"
```

`restart:` é lido na **criação** do container, não a cada `docker inspect`. Um
container já criado mantém a política com que nasceu, mesmo que o YAML mude —
e mesmo que ele esteja `exited`. A política só muda em runtime com:

```bash
docker update --restart=no postgres vaultwarden vaultwarden-api
```

Depois disso, `docker inspect` mostra `no`.

**Cuidado**: `no` **não** impede um redeploy de ressuscitar o container. Isso é
a armadilha 13 — a frase anterior aqui dizia o contrário e estava errada.

**Por que isso importa mais que estética**: com `unless-stopped`, um redeploy do
Dockhand religaria o `postgres` no volume congelado, ao lado do pod que já
escreveu milhares de linhas desde o corte. Dois Postgres divergindo, e o Docker
venceria em quem escuta a porta do host. A troca de política é parte do
cutover, não limpeza opcional.

**Regra**: mudar `restart` no arquivo sem `docker update` é mudança de
documentação, não de comportamento.

### 13. `restart: "no"` não impede `compose up` de subir um container parado

`restart:` rege o **auto-restart após crash**. Não é uma trava de "não suba".
`docker compose up` inicia o serviço parado de qualquer jeito. Provado em
sandbox:

```bash
$ docker stop rp-test
$ docker compose up -d
 Container rp-test Starting
 Container rp-test Started
$ docker inspect rp-test -f '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}'
running no
```

Isso importa porque o Dockhand tem `auto_update=1` e cron `0 3 * * *` nos
projetos `project-infra` e `project-apps`. Todo dia às 03:00 UTC ele roda
`compose up` no diretório que ele mesmo sincroniza (`/opt/stacks/<projeto>/`)
— não em `/opt/giomartins/stacks/`. O log de 2026-10-23 03:00 é explícito:

```
Container postgres Recreate → Container postgres Started
Container vaultwarden Recreate → Container vaultwarden Started
```

Ou seja: os volumes congelados voltariam a subir contra os pods, e duas
sessões Baileys disputariam o mesmo número do WhatsApp.

**A trava correta é `profiles:`**:

```yaml
  postgres:
    profiles: ["retired"]
    restart: "no"
```

Validado em sandbox: `up` sem `--profile` **pula** o serviço, `up
--remove-orphans` **não** o remove, e o volume sobrevive. O rollback continua
barato — uma flag, não um `git revert`:

```bash
docker compose --profile retired up -d postgres
```

**Limite**: um serviço não-profileado **não pode** ter `depends_on` para um
profileado — o compose recusa o projeto inteiro (`service "app" depends on
undefined service "db"`). Se o dependente ainda está vivo, os dois ficam fora
do profile.

**Regra**: ao aposentar um serviço, `restart: "no"` **e** `profiles: ["retired"]`.
O primeiro é higiene; o segundo é o que segura o redeploy diário.

### 14. Script de cutover sem `set -e` transforma erro de sintaxe em queda

Aconteceu no `evolution-redis` (2026-10-23). O script de cutover fazia, nesta
ordem: parar o timer → **apagar o EndpointSlice manual** → aplicar o Service com
selector. O `apply` falhou — um `awk` meu tinha cortado a linha `apiVersion: v1`
ao extrair o manifesto — mas o script continuou e reportou sucesso nos passos
seguintes.

Resultado: por cerca de dois minutos o `evolution-redis` ficou **sem endpoint
nenhum**. O `evolution-api` não quebrou, e é exatamente por isso que o erro era
perigoso: a conexão TCP já estabelecida sobreviveu no conntrack e continuou
servindo. A falha só apareceria no próximo reconnect — possivelmente às 03:00,
no redeploy do Dockhand, sem ninguém olhando.

O `set -uo pipefail` que eu tinha posto **não** aborta em comando que falha; só
`-e` (ou `&&` explícito, ou checar `$?`) faz isso. Um script que mexe em
disponibilidade precisa falhar no primeiro erro, não seguir adiante.

**Regra**: script de janela começa com `set -euo pipefail`. E o passo destrutivo
(apagar o EndpointSlice, parar o container, remover a ponte) vem **depois** do
passo que pode falhar por sintaxe, nunca antes.

### 15. PVC não se move de namespace, e `Delete` apaga o dado quando você tenta

PVC é namespaced; PV não. Não existe "mover um PVC" — o antigo tem que ser
apagado e um novo criado no destino. Com `reclaimPolicy=Delete` (o padrão do
`local-path`), apagar o PVC apaga o diretório: 2,4 GB de Postgres viram pó.

O caminho que **não** copia um byte, e que foi provado num PVC descartável antes
de encostar em produção:

```
Bound --(PVC apagado + Retain)--> Released
      --(remover claimRef)--> Available
      --(claimRef para o PVC futuro)--> Bound no MESMO diretório
```

O PV continua apontando para o mesmo `local.path`. Só o `claimRef` muda de
`giomartins/postgres-data` para `persistence/postgres-data`.

Três armadilhas apareceram na prova, e as três teriam custado a janela:

**a) Pod existente prende o PVC em `Terminating` para sempre.** Apagar o PVC com
o pod ainda no namespace — mesmo `Completed` — deixa o finalizer
`pvc-protection` segurando, e `kubectl delete --wait=true` **bloqueia sem prazo**.
Ordem obrigatória: workload → 0, *esperar o pod sumir de verdade*, só então PVC.

**b) `Released` não aceita claim novo.** Setar `claimRef` num PV `Released` não
transiciona nada. O PVC fica `Pending` e o provisioner cria um volume **novo e
vazio**. O pod sobe, roda, e o dado não está lá. Tem que passar por `Available`
antes, removendo o `claimRef`.

**c) Sem asserção de identidade, o teste passa com o banco vazio.** Depois de
criar o PVC, compare `volumeName` do PVC novo com o PV original. Um volume novo
também deixa o pod subir; só essa comparação distingue "migrou" de "perdeu o
dado". Foi exatamente o que a primeira versão da prova errou.

Script: `gitops/bootstrap/namespace-cutover.sh`.

### 16. Namespace é fronteira de DNS, e o nome está dentro do Secret

`postgres:5432` resolve para `postgres.<namespace-do-cliente>.svc.cluster.local`.
Depois de fatiar, o cliente em `applications` procuraria
`postgres.applications...` e não acharia o Postgres em `persistence`.

O agravante: a URI inteira mora no **Secret**
(`postgres://usuario:senha@postgres:5432/domain`), e o repositório é público.
Reescrever para FQDN seria editar segredo com senha, em produção, em dez lugares.

**Regra**: um `Service` do tipo `ExternalName` no namespace do consumidor, com o
nome curto apontando para o FQDN do produtor. O nome não muda; só a resolução.
Provado: `t-svc:8080` respondeu de dentro de outro namespace.

Porta não é proxiada num `ExternalName` — é CNAME. O cliente tem que discar a
porta certa, e todos discam.

### 17. `ClusterRoleBinding` guarda o namespace como texto, e o kustomize não o reescreve

O `ClusterRoleBinding` do Alloy tinha:

```yaml
subjects:
  - kind: ServiceAccount
    name: alloy-logs
    namespace: giomartins
```

`subjects` é uma lista de campos livres, não `metadata`: o transformer de
`namespace:` do kustomize **não** o toca. Depois do fatiamento o binding existia,
apontava para um namespace sem esse ServiceAccount, e o RBAC ficava inerte. O
sintoma seria "o Alloy lê zero pods" — sem erro, com o ArgoCD verde.

O mesmo vale para o filtro `discovery.kubernetes { namespaces { names = [...] } }`
na config dele: listar só o namespace antigo faz o coletor ler zero pods depois
do fatiamento.

**Regra**: ao mover algo que tem RBAC, `grep` pelo nome do namespace em TODO o
manifesto — não só em `metadata.namespace`.



### 18. `hostPort` injetado: o scheduler recusa antes do `CrashLoop`

Com `hostNetwork: true` e `containerPort: 80`, o apiserver **injeta**
`hostPort: 80` no pod mesmo que o manifesto não declare. Consequência prática:
enquanto o container Docker detém a 80, o pod do ingress fica **`Pending`** com
`FailedScheduling: 1 node(s) didn't have free ports`, não em `CrashLoopBackOff`.

O primeiro script de corte esperava o socket `:80` "ficar livre" depois de
`docker stop`. Ele não ficou — porque `docker stop` não é instantâneo — e o
script concluiu "porta ocupada", religou o Docker, e abortou. O gate correto é o
**estado do container** (`docker inspect .State.Running == false`), com espera
de até 120 s. O socket mente; o estado do processo não.

E isso é uma trava melhor que qualquer `ss`: o scheduler se recusa a agendar
enquanto a porta está ocupada, então o pod nunca "quase sobe".

### 19. `httpGet` probe reprova 404/401/302/444 — e os quatro são corretos

O nginx que serve os 19 hosts devolve, de propósito:

| host | status | por quê |
| --- | --- | --- |
| `domain` | 404 | API sem rota em `/` |
| `db-mcp` | 401 | exige bearer token |
| `grafana` | 302 | redireciona para login |
| `_` (default) | 444 | fecha conexão sem Host |

Um `httpGet` considera sucesso só 200–399. Com ele, o pod fica `0/1 Running`
**servindo tráfego**: os 19 hosts respondem normalmente, `docker` está parado, e
o `kubectl rollout status` estoura com `error: timed out waiting for the
condition`. O Deployment nunca fica `Available` e o ArgoCD mostra `Progressing`
para sempre.

O probe tem que ser `tcpSocket`. Aqui ele mede "o processo aceita conexão", que é
exatamente o que um proxy precisa provar sobre si mesmo. Saúde de backend é
problema de cada backend — e cada um tem o seu probe.

### 20. O cluster não pode divergir do git por zero segundo

Ao cortar o registry, o script parou o container e aplicou o manifesto com
`kubectl apply`. O ArgoCD ainda estava sincronizado no commit **anterior**
(`replicas: 0`) e o `selfHeal` desfez o apply em segundos: container parado, pod
escalado a zero, porta 5000 sem dono. O registry ficou fora por ~2 minutos.

A regra: **antes de tocar na infraestrutura que o git governa, espere o ArgoCD
reconciliar.** O critério tem que ser o estado no CLUSTER (`deploy.spec.replicas
== 1`), não a revisão que o git diz. Os dois scripts de corte
(`corta-registry.sh`, `corta-ingress.sh`) fazem essa espera como passo 0, e
enquanto o ArgoCD não chega eles não tocam em nada.

Corolário para `replicas: 0` temporário: não dá para escalar o pod com
`kubectl scale` enquanto o AppSet reaplica o template a cada 3 min. Ou o git
diz `replicas: 0`, ou o pod volta. A cópia dos 12 GB do registry exigiu um
commit só para isso.

### 21. `rm` de imagem no `ctr` não remove blobs, e o teste passa pelo cache

`ctr images rm` apaga a **referência**, não o conteúdo. O content store do
containerd é endereçado por digest e compartilhado entre imagens: puxar de novo
uma imagem que já foi baixada mostra `elapsed 0.1s, total 9.5 KiB` — só o
manifesto — e o comando diz `Completed`.

Isso produz um falso positivo perigoso num teste de registry: "o pull
funcionou" pode significar "nada atravessou a rede".

Três provas que não mentem:

1. **delta do content store** em bytes (`du -sb .../io.containerd.content.v1.content`);
2. **existência do arquivo do blob do manifesto** em
   `.../blobs/sha256/<digest>` antes e depois — binário, sem "quase";
3. escolher um repositório que **nenhum pod jamais puxou**. Metade do catálogo
   (`apostas-*`, `bet-*`, `clubs-*`, `uhumarketing-*`) é de projetos aposentados
   e serve exatamente para isso.

A prova aceita é a 2 ou a 3. A 1 engana quando os layers já estão no store por
outra tag do mesmo repositório.


### 22. Todo cliente guarda o ClusterIP, e o alias não o conserta.

Quando um
produtor muda de namespace, o Service antigo vira `ExternalName` e ganha
**outro** ClusterIP. Clientes que resolveram o nome uma vez continuam
discando para o IP morto para sempre. Visto em três formas:

- `ioredis` (`evolution-api`): `redis disconnected` a cada segundo, DNS
  resolvendo certo, TCP aberto pelo `nc`. O pod tinha nascido 6 h antes do
  alias; o IP antigo (`10.43.236.33`) estava morto. Curou com
  `rollout restart`.
- `amqplib` (`domain-worker`): `dial tcp 10.43.108.164:5672: connection
  refused`. Curou sozinho no retry — `amqplib` re-resolve, `ioredis` não.
- OTLP/gRPC (`alloy`): `rpc error: code = Unavailable desc = no children to
  pick from`. O resolver gRPC guardou a resolução vazia de quando o `tempo`
  ainda não tinha endpoints. Curou com restart.

**Regra**: depois de mover um produtor, reiniciar todo consumidor que ainda
esteja no namespace antigo. Não confiar em "não há erro no log" — ausência de
erro é compatível com cliente que nunca reconectou.

**Corolário para verificação**: `nslookup`, `getent` e `nc` de dentro do pod
provam **DNS e rede**, não provam **o cliente da aplicação**. São testes que
passam enquanto o serviço está caído. A prova tem que ser o contador do
próprio cliente (`sent_spans_total`, `loki_write_sent_entries_total`) ou um
registro novo no destino.

### 23. `kubectl apply -f` em manifesto cru ignora o `namespace:` do kustomization.

O `deployment.yaml` não tem `namespace:` — ele vive em
`kustomization.yaml`, e o transformer do kustomize é quem o injeta. Aplicar o
arquivo cru cria tudo em `default`:

- o PVC nasce em `default`, o `local-path` provisiona um volume **novo e
  vazio**, e o pod sobe "saudável" ao lado do real;
- dois Redis rodando, um com 860 chaves e outro com zero. Nada no
  `kubectl get pods` distingue os dois.

**Regra**: `apply -k`, ou aplicar a saída de `kubectl kustomize`, que já traz
`namespace:` em cada documento. Nunca `apply -f` num arquivo de app.

### 24. Um detector de PVC que falha em silêncio é pior que nenhum.

O movedor da
fatia 7 dizia `sem PVC — nada a rebindar` e seguia. O `awk` usava
`match(doc, /^  name: .../)` sobre um buffer **multi-linha**, e `^` em awk
ancora no início da *string*, não da linha. Resultado: zero PVCs detectados,
`apply` criou um PVC novo, e o **Postgres subiu com 0 tabelas** enquanto as
1176 linhas de `finance_transactions` ficavam num PV órfão. Restaurado sem
perda (rebind no PV original, contagem conferida), mas o serviço ficou vazio
por alguns minutos e os workers registraram
`relation "finance_of_accounts" does not exist`.

**Regra**: quando o render declara PVC e o PV não é encontrado, **abortar**.
E a testemunha de integridade é **bytes**, não contagem de arquivos — o Loki
apaga chunks obsoletos ao fechar (5092 → 5090) e abortou a janela por engano.

### 25. Esperar `Ready` antes de publicar o Service trava dependência intra-namespace.

O `db-mcp-gateway` (nginx) resolve o upstream `db-mcp` no
start e morre com `host not found in upstream` se o Service não existir. A
ordem "aplicar workload → esperar Ready → trocar Services" esperava Ready de
um pod que só ficaria Ready depois da troca. Agora o Service sobe antes, como
`ClusterIP` sem `nodePort` (a porta 30xxx continua com o Service antigo até o
workload provar que serve).

**Armadilha dentro da armadilha**: a fase 5 (apagar o Deployment antigo)
rodava mesmo quando a fase 4 falhava. O `db-mcp-gateway` de produção ficou
sem NodePort (`HTTP 000`) por alguns minutos. O Deployment antigo **é** o
rollback — ele só pode cair quando o Service novo está no ar.

A causa da fase 4 falhar foi banal e vale registrar: a fase 2.5 passou a
gravar `/tmp/<app>.<svc>.render.yaml`, e a fase 4 continuou lendo
`.svc.yaml`. O `grep` que deveria extrair o tipo devolveu vazio, o `apply`
apontou para arquivo inexistente, e o script seguiu. Duas fases que
compartilham um arquivo precisam compartilhar o **nome** dele — derivar duas
vezes é como as duas divergem.

### 26. Trocar o glob do ApplicationSet antes do push apaga tudo.

O AppSet lê do
GitHub, não do disco. A sequência natural — editar o repo, aplicar o
`appset` novo, depois commitar — gera **zero** Applications, porque o glob
novo (`gitops/apps/*/*`) não casa com o layout que ainda está no remoto. O
controller então considera as 15 Applications antigas órfãs e as remove, e
remover uma Application com `prune: true` **apaga os recursos dela**. Ou seja:
o cluster inteiro, por uma ordem de dois comandos.

**Regra**: `git push` é pré-requisito do `appset apply`, não consequência.
Antes de mudar o glob, confirmar que o remoto já tem a árvore que o glob
descreve (`git rev-parse HEAD` = `git rev-parse origin/main`).

Sintoma de que deu errado, se algum dia der: o AppSet reconcilia e o número
de Applications **cai**, em vez de se manter. Ver o `allPaths` no log do
`applicationset-controller` — ele lista o que o glob realmente viu no repo.

### 27. O caminho do usuário não passa pelo `ingress-nginx` do cluster.

O que
serve os 19 hosts é o nginx **em Docker no host**, que faz `proxy_pass` para
`127.0.0.1:<NodePort>`. O `ingress-nginx` do cluster tem zero `Ingress` e
escuta em `30945`/`30421`, fora do caminho.

Duas consequências práticas que custaram tempo:

- **"Não mudar NodePort" não é conservadorismo, é o que preserva o
  site.** O contrato entre o nginx do host e o cluster é só `host:porta`.
  Namespace, nome de Deployment e ClusterIP podem mudar à vontade; a porta
  30xxx não pode.
- **Testar com `curl --resolve host:443:127.0.0.1` dá `000` em todos os
  hosts** — inclusive nos que nunca foram tocados. Não há nada escutando na
  443 do host: o TLS termina no Cloudflare e chega em HTTP na 80. Um alarme
  de "todos os 24 hosts caíram" que era só o teste errado. O teste válido é
  `curl https://host/` de verdade, ou `curl http://127.0.0.1:<NodePort>/`.

### 28. `head -c 160` no corpo de um login é vazamento de token.

Ao verificar a
rotação da senha do Kubero, o script fez `echo "corpo: $(head -c 160 ...)"`.
O corpo é JSON com `access_token` no topo — um JWT de ~528 caracteres. Em 160
caracteres já vão o header e boa parte do payload.

Neste caso não houve dano: o corte caiu no meio da assinatura, e o pedaço não
autentica (`/api/auth/session` devolveu `400`). Mas isso foi **sorte de onde
o corte caiu**, não desenho. Um `head -c 600` teria exfiltrado sessão de admin.

**Regra**: em verificação de credencial, imprimir só `sorted(d.keys())`,
tamanho e presença — nunca `d["token"][:N]`. E se o corpo for logado por
engano, redigir o arquivo **e** trate o token como comprometido: rotacione de
novo se ele estiver completo.

### 29. O status HTTP do login do Kubero não significa nada.

`POST
/api/auth/login` devolve **201** para credencial inválida (com
`{"statusCode":403}` no corpo) **e** para requisição vazia (com
`{"status":400}`). Julgar por `code` daria "login ok" para qualquer coisa.
A verificação olha o corpo: ausência de `status`/`message` **e** presença de
`access_token`.

E a senha do admin **não** está no Secret: `KUBERO_ADMIN_PASSWORD` é
referenciado no Deployment, mas a chave não existe em `kubero-secrets` — o
admin é semeado no **SQLite** (`/app/server/db/kubero.sqlite`, tabela `User`)
na primeira subida, e o log confirma `No legacy users to migrate. KUBERO_USERS
is not set.` Trocar a env não faz nada.

### 30. Perder as posições do coletor não "duplica log", perde log.

O `alloy-logs` guardava o estado em `emptyDir`, justificado no manifesto com
uma frase que parecia razoável: *"perder isso num restart significa reler
desde o começo e duplicar linhas já enviadas, não perder dado"*. Era o
contrário, e o Loki prova.

A cadeia, medida em 2026-10-23 num pod com 1h45 de vida:

```
loki_write_sent_entries_total      285.328
loki_write_dropped_entries_total   115.696   reason=ingester_error
```

**29% das linhas foram perdidas**, não duplicadas:

1. o pod reinicia (nesta sessão: rollout do `ingress`, do `minio`, do
   `excalidraw`);
2. o `emptyDir` vai junto, e o Alloy torna a ler o log Docker **desde o byte
   zero** — o log tem linhas de 19/10, 20/10, 22/10;
3. o Loki rejeita com `400 entry too far behind` (default
   `reject_old_samples_max_age: 1h`);
4. `4xx` não tem retry no `loki.write` → `no retries left, dropping data`.

O sintoma no `alloy` é uma linha `error` a cada ~10 min, fácil de ignorar
entre `warn` de tailer. O sintoma no Loki é `write operation failed` no
ingester. Nenhum dos dois aparece no Grafana, porque o dado que falta é
exatamente o que ninguém consulta.

**Regra**: o `positions.yml` é estado, não cache. Se o componente tem
`storage.path`, ele precisa de volume persistente — e a justificativa
"perder só duplica" tem de ser medida no destino, não deduzida. Duplicar e
perder são resultados opostos da mesma causa, e qual dos dois acontece
depende do `reject_old_samples_max_age` de quem recebe.

**Corolário**: PVC em `local-path` é `WaitForFirstConsumer`. O PVC fica
`Pending` para sempre até um pod montá-lo, então "esperar `Bound` antes de
criar o pod" trava num laço que nunca termina. A ordem é pod → `Bound`.

**Corolário 2**: com PVC `RWO` num nó único, o scheduler deixa **dois pods**
montarem o mesmo volume — `RWO` significa "um nó", não "um pod". Um
`RollingUpdate` com `maxSurge` padrão faria os dois escreverem
`positions.yml` e corromperia o arquivo que deveria salvar. `Recreate` é
obrigatório, e ele esbarra na armadilha 11 (campo defaultado pela API) →
deletar o Deployment e deixar o ArgoCD recriar.

### 31. `hostPort` fura o firewall do host; NodePort não.

Medido em 2026-10-23, do meu computador contra `168.138.135.6`:

| porta | mecanismo | de fora |
| --- | --- | --- |
| `5000` | `hostPort` (registry) | **200/401 em 27 ms** |
| `30092`, `30900`, `30821`, `30200`, `30080`, `31844` | NodePort | `000` (timeout) |
| `80` | `hostPort` (ingress) | 200 |

A causa está na ordem das cadeias do netfilter. O `INPUT` do host termina com
`-A INPUT -p tcp -j REJECT --reject-with tcp-reset`, e é isso que barra os
NodePorts. Mas `hostPort` no k3s é **DNAT** (`CNI-DN-...-j DNAT
--to-destination 10.42.0.x:porta`), e pacote DNAT não percorre o `INPUT`: entra
por `PREROUTING` e sai por `FORWARD`. O `REJECT` do `INPUT` nunca é consultado.
O NodePort, ao contrário, é atendido por um socket do `kube-proxy` no próprio
host — e aí sim passa pelo `INPUT`.

**Consequência**: trocar um serviço de NodePort para `hostPort` muda o modelo de
exposição sem que o firewall perceba. Foi o que aconteceu com o `registry` na
fatia 8: ele está em **HTTP puro com Basic auth** no IP público, e a Cloudflare
não cobre isso (só proxia 80/443; na 5000 o `dig` resolve direto para o IP do
host). Não é vazamento de dado — `/v2/_catalog` responde `401` — mas é uma porta
que ninguém escolheu abrir.

Saídas, em ordem de custo:

- regra no `INPUT` para a 5000 vinda de fora, deixando passar `127.0.0.1` e as
  redes dos pods — o CI **precisa** dela aberta, então tem de ser por origem,
  não cega;
- pôr a 5000 atrás da Cloudflare com TLS (quebra o nome das 39 imagens:
  `registry.giomartins.dev:5000` viraria `registry.giomartins.dev`);
- mover o push do CI para ghcr e deixar o registry só para pull interno.

**Regra**: depois de trocar NodePort por `hostPort`, testar a porta **de fora**
(`curl http://<ip-publico>:<porta>`), nunca só do host. Do host os dois parecem
iguais, e o `iptables -S INPUT` mostra um `REJECT` que dá a falsa impressão de
que tudo está fechado.


## Bootstrap (uma vez por cluster)



```bash
# 1. k3s sem ingress controller (não toca em nada existente)
curl -sfL https://get.k3s.io | sudo sh -s - \
  --disable traefik --disable servicelb \
  --write-kubeconfig-mode 600 --node-name vps-1

# 2. apontar o containerd para o registry local (ele só resolve em loopback)
sudo tee /etc/rancher/k3s/registries.yaml >/dev/null <<'YAML'
mirrors:
  "registry.giomartins.dev:5000":
    endpoint:
      - "http://127.0.0.1:5000"
YAML
sudo systemctl restart k3s

# 3. ArgoCD
sudo k3s kubectl create namespace argocd
sudo k3s kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/install.yaml

# 4. namespace + credencial do registry (fora do git: o repo é PÚBLICO)
sudo k3s kubectl create namespace giomartins
sudo k3s kubectl create secret generic registry-credentials -n giomartins \
  --from-file=.dockerconfigjson=/root/.docker/config.json \
  --type=kubernetes.io/dockerconfigjson

# 5. expõe a UI do ArgoCD na 30080 e roda o GitOps
sudo k3s kubectl apply -f gitops/bootstrap/argocd-server-nodeport.yaml
sudo k3s kubectl apply -f gitops/bootstrap/appset.yaml

# 6. UIs de plataforma (opcionais, fora do GitOps — ver seções próprias)
#    Kubero:  helm install ... -f gitops/bootstrap/kubero.yaml
#    Rancher: sudo gitops/bootstrap/rancher/install.sh
```

Do passo 5 em diante, **nada mais é `kubectl apply`**: adicionar uma
pasta em `gitops/apps/` cria o Application sozinho.

O passo 3 do `install.yaml` e o passo 5 (`argocd-server-nodeport.yaml`) são
os únicos manifestos de plataforma. Para reaplicar do zero num cluster novo,
a ordem é: k3s → registries.yaml → namespace argocd → install.yaml →
namespace giomartins + secret → `server.insecure=true` no
`argocd-cmd-params-cm` → rollout do `argocd-server` → os dois YAMLs de
`bootstrap/` → (opcional) Kubero e Rancher.

### Acessar o ArgoCD

**A tela do cluster era o próprio ArgoCD** — a decisão original era não instalar
uma UI separada de Kubernetes. Isso mudou em 2026-10-23, com o Rancher: ele
mostra nós, workloads, eventos e logs por uma interface de cluster de verdade,
não só Applications. O ArgoCD continua sendo quem reconcilia o `gitops/`; a
divergência entre as duas telas é esperada e está explicada na seção "Rancher".

**Cuidado com a porta 8080: ela já é do `evolution-api`** (`127.0.0.1:8080`).
Um port-forward para 8080 falha com "address already in use" — e pior, quem
apontar o navegador para 8080 vai falar com o evolution, não com o ArgoCD.

O ArgoCD roda em modo `server.insecure` (HTTP atrás do proxy), igual ao resto
da infra: o TLS termina no Cloudflare, o nginx fala HTTP na 80. Ele está
exposto no **NodePort 30080**, que **não** é alcançável de fora (a security
list da Oracle bloqueia 30000-32767). O acesso é por túnel:

```bash
# No SEU computador. -N mantém o túnel aberto sem rodar comando remoto;
# sem -N o ssh encerra assim que o comando remoto termina.
ssh -N -L 30080:127.0.0.1:30080 ubuntu@168.138.135.6
# depois: http://localhost:30080  (usuário: admin)
```

Senha inicial:

```bash
sudo k3s kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
```

Verificado: `/healthz` → `200`, `/api/version` → `v3.5.6`, login
`POST /api/v1/session` → `200`, e a UI serve `<title>Argo CD</title>`.

Para ter a tela em `https://argocd.giomartins.dev` (sem túnel), o caminho é o
mesmo dos outros serviços: adicionar o hostname em
`modules/infra/terraform/locals.tf` (`hostname` + `port = 30080`), `terraform
apply` para o A record + Access, e um `server{}` no `default.conf` com
`proxy_pass http://127.0.0.1:30080`. **Isso ainda não foi feito.**

### Alternativas à UI do ArgoCD

| ferramenta | o que dá | custo |
| --- | --- | --- |
| `k9s` | TUI no terminal: pods, logs, shell, eventos. Mais rápido que qualquer web UI para operar no dia a dia | 1 binário, ~0 RAM (roda na sua máquina) |
| `kubectl` + `--watch` | o básico, sem instalar nada | já existe |
| Grafana | dashboards de cluster **se** houver kube-prometheus-stack | pesado (~1-2 GB); hoje o Grafana só vê métricas OTel das apps |
| Headlamp / Kubernetes Dashboard | UI web alternativa | mais um serviço para expor e proteger |

Recomendação: **ArgoCD para estado de deploy + Rancher para operar o cluster +
`k9s` para o dia a dia no terminal**. O k9s usa o kubeconfig (copie
`/etc/rancher/k3s/k3s.yaml`, troque `server: https://127.0.0.1:6443` pelo IP e
acesse por túnel na 6443); o plano de controle está em `127.0.0.1:6443` e a
security list já bloqueia de fora.

O Rancher entrou nessa lista em 2026-10-23 por escolha do usuário e **não
substitui o ArgoCD**: ele não reconcilia o `gitops/`. É a tela de operação
(nós, pods, eventos, logs, kubectl no browser); o ArgoCD é a fonte de verdade
do que está deployado. Confundir os dois leva a "corrigir" na UI algo que o
próximo sync desfaz.

## Como um serviço migra

1. Criar `gitops/apps/<serviço>/` com `kustomization.yaml` + manifests.
2. `git push` — o ArgoCD sincroniza sozinho (o ApplicationSet varre o repo a
   cada 3 min; ou force com `kubectl -n argocd annotate app <nome> argocd.argoproj.io/refresh=normal`).
3. Validar por dentro, **sem tocar no ingress**:
   `curl -H 'Host: <domínio>' http://127.0.0.1:<NodePort>/`
4. Só então trocar o `proxy_pass` do bloco no `default.conf` do host e
   `nginx -s reload` (graceful: requests em voo terminam).
5. Passar alguns dias assim. Se estiver estável, remover o serviço do
   Compose.

Rollback de qualquer passo 4 é uma linha no `default.conf` + reload.

### Escolha de NodePort

Use a faixa `30000-32767` (o k8s não aceita fora dela de qualquer forma) e
**espelhe o número do Docker** quando possível — `8023` → `30023`, como no
piloto. Facilita a leitura durante a migração e evita que dois serviços
diferentes acabem com nomes trocados.

Registre aqui o que já está ocupado:

| NodePort | serviço |
| --- | --- |
| 30023 | excalidraw |

Não confunda com portas do **host** ocupadas pelo Docker: `8080`
(evolution-api), `3000` (grafana), `8000`, `8007`, `8018`, `8021`, `8023`,
`8092`, `8093`, `5000` (registry), `9000`/`9001` (minio), `15672`
(rabbitmq), `25565` (minecraft), entre outras. Nenhuma delas conflita com
NodePort, mas conflitam com `port-forward` — use porta alta e livre para
túneis.

## Contrato de imagem

**Nunca use a tag `latest` em `gitops/apps/`.** Com tag móvel o manifesto
não muda entre builds, o ArgoCD não vê diff e o cluster fica preso numa
versão antiga sem ninguém perceber. Use tag imutável (semver, sha ou
`vX.Y.Z`) e atualize-a por commit.

Duas formas de automatizar, ambas válidas:

- **CI commita a tag** (explícito, auditável no git). Cuidado com loop:
  o workflow precisa ignorar mudanças em `gitops/apps/**`.
- **ArgoCD Image Updater** (observa o registry e escreve o commit sozinho).
  Mais mágica, mais uma peça para operar.

Escolhemos a primeira quando o serviço migrar para valer.

## Estado atual

Verificado em 2026-10-23, depois do bootstrap e da fatia 3.

**Regra que governa a tabela:** o container Docker só é desligado *depois* de o
equivalente no k8s provar que serve, e o tráfego só muda num commit separado.
Por isso a coluna "tráfego" ainda diz Docker em tudo.

| serviço | Docker | k8s | tráfego |
| --- | --- | --- | --- |
| `excalidraw` | rodando (ocioso) | **rodando** (NodePort 30023) | **k8s** — `draw` → `:30023` ✅ |
| `adminer` | rodando (ocioso) | **rodando** (NodePort 30092) | **k8s** — `adminer` → `:30092` ✅ |
| `domain-api` | rodando (ocioso) | **rodando** (NodePort 30800) | **k8s** — `domain` → `:30800` ✅ |
| `domain-worker` | rodando | manifesto, **`replicas: 0`** | Docker (único escritor do CQRS) |
| `finance-api` | rodando (só consumo interno) | **rodando** (NodePort 30818) | **k8s** — `finance-api` → `:30818` ✅ |
| `finance-openfinance-worker` | **parado** | **rodando** (`replicas: 1`) | **k8s** — poller do Polp, sem tráfego externo ✅ |
| `finance-customersupport-worker` | rodando | manifesto, **`replicas: 0`** | Docker |
| `vaultwarden-api` | rodando | **rodando** (ClusterIP:8080) | sem tráfego externo (bridge interna) |
| `vaultwarden` | **parado** | **rodando** (NodePort 30822) | **k8s** — `vault` → `:30822`, `/api/config` idêntico byte a byte ✅ |
| `9router` | rodando | manifesto, **`replicas: 0`** | Docker (`ai` → `:20128`) — **exige parada** |
| `minio` | rodando (rollback) | **rodando** (NodePort 30900/30901) | **k8s** — 8 buckets idênticos, 3 SPAs ✅ |
| `rabbitmq` | rodando (rollback) | **rodando** (NodePort 31525/30672) | **k8s** — 29 filas, 12 exchanges, 62 bindings idênticos ✅ |
| `postgres` | **parado** | **rodando** (ClusterIP:5432) | **k8s** — 54/55 tabelas idênticas, `finance_transactions` md5 igual ✅ |
| `prometheus` | rodando | **rodando** (ClusterIP:9090) | **k8s** — 898M copiados, 8.841 séries ✅ |
| `loki` | rodando | **rodando** (ClusterIP:3100) | **k8s** — 976M copiados ✅ |
| `tempo` | rodando | **rodando** (ClusterIP:3200) | **k8s** — 308M copiados ✅ |
| `grafana` | rodando (ocioso) | **rodando** (NodePort 30300) | **k8s** — `grafana` → `:30300` ✅ |
| `alloy` | rodando (rollback) | **rodando** (OTLP 4317/4318 + logs, PVC) | **k8s** — pod `alloy-logs` serve o Service `alloy`; container só lê `docker.sock` |
| `registry` | **parado** (`exited`, `restart=no`) | **rodando** (`hostPort: 5000`) | **k8s** — 39 repos, 12 GB verificados por sha256 ✅ |
| `ingress` | **parado** (`exited`, `restart=no`) | **rodando** (`hostPort: 80`) | **k8s** — 19/19 hosts com o mesmo status ✅ |
| demais 17 containers | rodando ou parados como rollback | — | Docker |
| 19 domínios do ingress | — | — | idênticos antes/depois (mesmo status HTTP) |

`replicas: 0` não é esquecimento: são consumidores de fila ou donos de volume
com escrita exclusiva. Rodar dois ao mesmo tempo duplica mensagem ou corrompe
dado. Subir para 1 *é* o ato de migrar, e exige parar o Docker antes.

Plataforma no cluster: k3s, ArgoCD, ingress-nginx (NodePort), cert-manager,
metrics-server, Kubero (operator + UI em NodePort 30200), Rancher 2.15.2 +
Fleet + Turtles + CAPI (NodePort 31198/31844).

Recursos: k3s + ArgoCD + ingress-nginx + cert-manager + Kubero ≈ 1,3 GB de
RAM; com o Rancher e o que ele instala (Fleet/Turtles/CAPI), ≈ 2,5 GB. Sobram
~7,4 GB. Nenhuma porta do host foi disputada — o cluster usa 6443 (API), 10250
(kubelet), 8472 (VXLAN) e NodePorts em `30000-32767`.

### Serviços de ponte (`gitops/apps/bridges/`)

**Duas** `Service` sem selector, ligadas por `EndpointSlice` aos containers
Docker que ainda não migraram. Eram sete. `minio` migrou na fatia 5, `rabbitmq`
em 2026-10-23, e `postgres` + `vaultwarden` fecharam a fatia 6 (viraram Services
com selector em `gitops/apps/<app>/`). Os nomes são **idênticos aos do Compose**
— é o que permite migrar um consumidor sem tocar em nenhuma env var:

| Service | container | porta |
| --- | --- | --- |
| `alloy` | alloy | 4318 |
| `evolution-redis` | evolution-redis | 6379 |

`postgres` e `vaultwarden` saíram desta tabela em 2026-10-23 (fatia 6): os dois
Services ganharam `selector` e o `EndpointSlice` do controller passou a ser a
fonte.

Morrem quando os dois últimos containers migrarem: aí o `Service` ganha
`selector` e o `EndpointSlice` manual deixa de existir.

**`rabbitmq` saiu desta lista em 2026-10-23**, e o motivo de ter sido o último
está em `gitops/apps/rabbitmq/deployment.yaml`: um broker é ponto de encontro
compartilhado, e cortá-lo com qualquer consumidor ainda em Docker cria dois
brokers com zero estado compartilhado, sem erro em log nenhum.

**`postgres` e `vaultwarden` saíram em 2026-10-23** (fatia 6). Os dois tinham uma
diferença em relação a `rabbitmq`/`minio` que mudou o procedimento: o pod não
alcança a rede Docker, então **não havia como rodar os dois em paralelo e
comparar**. Minio e RabbitMQ tinham armazenamento separado e puderam conviver
por horas; aqui a cópia só faz sentido se o dado for o mesmo, e o pod não
conversa com o container.

O que substituiu a comparação lado a lado foi **baseline anotado antes da
parada**: contagem por tabela + md5 de uma tabela real, medidos com o container
ainda no ar; depois do corte, a mesma consulta no pod. Para um banco, "o pod
subiu" não prova nada — `pg_isready` responde num PGDATA vazio, e um SQLite
recém-criado tem `integrity_check ok` com zero usuários.

### NodePorts ocupados

| NodePort | serviço |
| --- | --- |
| 30023 | excalidraw |
| 30028 | 9router (**reservado**, pod em `replicas: 0`) |
| 30080 | argocd-server |
| 30092 | adminer |
| 30200 | kubero |
| 30300 | grafana |
| 30421 | ingress-nginx (https) |
| 30672 | rabbitmq management |
| 30800 | domain-api |
| 30808 | evolution-api |
| 30818 | finance-api |
| 30821 | db-mcp gateway |
| 30822 | vaultwarden |
| 30900 | minio s3 |
| 30901 | minio console |
| 30945 | ingress-nginx (http) |
| 31198 | rancher (http, redireciona para 443) |
| 31525 | rabbitmq amqp (NodePort automático) |
| 31844 | rancher (https) |

`30028` está reservado pelo Service do `9router` mesmo sem pod: um Service
`NodePort` existe independente de ter endpoint. Reservar antes é de propósito —
quem for escolher a próxima porta vê o número ocupado e não planeja em cima dele.

O `registry` e o `ingress` **não** aparecem nesta tabela porque não usam
NodePort: os dois publicam no host por `hostPort` (`5000` e `80`). É a diferença
que os torna migráveis sem reescrever referência nenhuma — a porta faz parte do
nome da imagem no caso do registry, e é a porta pública no caso do ingress.

`31525` é o NodePort do AMQP e não foi escolhido à mão: o Service declara
`nodePort` só para o `management`. Os pods não precisam dele (usam o ClusterIP
5672); ele existe porque o k3s aloca um por padrão. Nenhum NodePort é alcançável
de fora — o firewall do host bloqueia `30000-32767`, verificado com `curl` do IP
público.

### O que foi provado, não assumido

- **Os 4 ConfigMaps da observabilidade sobem de verdade**: pods avulsos com os
  mesmos ConfigMaps (`emptyDir`, fora do ArgoCD para não brigar com `selfHeal`)
  provaram que prometheus (`Completed loading of configuration file` →
  `Server is ready`), tempo (`server listening` 3200/9095), grafana (3 arquivos
  de provisioning montados, datasources registrados em `/api/datasources` com
  `http://prometheus:9090` e `http://loki:3100`) e loki sobem com a config real.
  O Loki **falhou no primeiro teste** — ver armadilha 5.
  `kubeconform` aprovou os 17 recursos com esse bug presente.
- **Fatia 4 fechada com estado, não com tela**: Prometheus subiu com
  `8.841 séries / 28.258 chunks` e `minTime` do dia anterior (nome de métrica de
  produção: `alloy_build_info`), Loki devolveu os labels históricos
  (`container`, `job`, `level`, `service_name`), e o Grafana respondeu
  `200` com a senha do Secret e `1 dashboard / 1 usuário` nos dois lados —
  prova de que o `grafana.db` copiado é o real, não um banco novo.
- **`minio/minio` não é mais puxável do Docker Hub** — `pull access denied,
  repository does not exist`. O container rodava há 11 horas com aquele digest
  porque a imagem estava no cache local; nenhum pod herda esse cache. A imagem
  foi retaggeada para o registry próprio com tag imutável. **Consequência: o
  cluster depende de um registry de cópia única para subir o minio.**
- **`RABBITMQ_NODENAME` não substitui `spec.hostname`** — fixar o nome do nó num
  pod falha com `{epmd_error, "...", nxdomain}`, porque o epmd resolve o *host*
  do nome pelo DNS. A solução é `spec.hostname: <nome-antigo>` no Pod. Provado
  com volume vazio: hostname, diretório mnesia e `node()` coincidem.
- **`alloy` em Docker não alcança a API do k3s**: `https://172.18.0.1:6443`
  responde `connection refused` de dentro do container. Por isso o coletor novo
  roda como pod (ServiceAccount), e não como edição do config existente — não
  há caminho de rede, não é escolha de arquitetura.
- **Persistência do `local-path` exercitada**: PVC `Pending` é o comportamento
  correto (`WaitForFirstConsumer`) enquanto o Deployment tem `replicas: 0` —
  mas significava que o caminho de dados nunca tinha sido testado. Criei um PVC
  e um pod descartáveis: escreveu, montou e o PV ficou `Bound`. Os dados vão
  para `/var/lib/rancher/k3s/storage/` (136 GB livres; o postgres ocupa 2,3 GB,
  então a fatia 6 cabe). Criar PVC sem pod **não** prova nada — fica `Pending`.
- **Primeiro container Docker desligado de vez**: `finance-openfinance-worker`
  parado (`exited`), pod atendendo em `replicas: 1`. Prova de que assumiu o
  trabalho: `finance_of_raw` recebeu linha com `captured_at` de 1 segundo antes
  da consulta, com o Docker parado. Não é "parece que subiu" — o dado apareceu
  no banco.
- **O timer das pontes se auto-recupera**: apontei o `EndpointSlice` do
  postgres para `172.18.0.250` (inexistente) de propósito; em <1 min o timer
  reaplicou `172.18.0.16` sozinho. Ele compara o IP atual com o do container,
  não espera "algo mudar".
- **Cuidado com o falso 200**: durante essa sabotagem, `domain` continuou
  respondendo 200 — mas por causa do pool de conexões do app, com sockets já
  abertos. Um pod novo teria falhado. "A URL respondeu 200" **não** prova que a
  ponte está boa; a verificação honesta é `nc` de um pod **novo** para o
  Service, que abre conexão do zero. Foi assim que o bug do nome de porta
  apareceu.

- **Fatia 6 fechada com o Docker parado**: `postgres` e `vaultwarden` migraram
  em 2026-10-23. A prova não foi "o pod subiu":
  - `vaultwarden`: `/api/config` idêntico **byte a byte** pelo domínio e pelo
    container (589 bytes, mesmo sha256), `rsa_key.pem` com sha256 idêntico (a
    chave de assinatura, então sessões antigas continuam válidas), e o
    `vaultwarden-api` sincronizando **42 vault items** — o mesmo número do PVC.
  - `postgres`: log do pod dizendo `database system was shut down at 16:24:07`
    e `ready to accept connections` **sem** `initdb`; 54 das 55 tabelas com
    contagem idêntica; `finance_transactions` com **md5 do dado idêntico**
    (`89358a62`, 1176 linhas); e uma conexão nova, com o Docker **já parado**,
    retornando `inet_server_addr() = 10.42.0.231` (o IP do pod).
  - A única tabela que divergiu foi `audit_log` (+1458 linhas) — é a tabela de
    escrita ativa, cresceu entre o baseline e o corte. Divergir aqui seria o
    esperado mesmo num banco saudável; comparar contagem de tabela viva sem
    congelar escrita é comparar instantes diferentes.
- **O split silencioso do kube-proxy com dois EndpointSlices**: depois de o
  Service do vaultwarden ganhar selector, o timer `sync-external-endpoints`
  continuou recriando o EndpointSlice manual. Com **dois** EndpointSlices para o
  mesmo Service, o kube-proxy balanceia entre eles: o domínio servia ora o pod,
  ora o container. O sintoma é mudo — `/api/config` responde igual dos dois
  lados, e o `vaultwarden-api` sincroniza 42 itens dos dois jeitos (mesmo dado).
  Só um **marcador por requisição** revelou: 6 requisições com query única, 6 no
  log do pod, 0 no do container. Antes da correção (tirar o serviço do `MAPA` do
  timer) era metade para cada lado. No postgres isso teria sido escrito em dois
  bancos.
- **Remover arquivo de `kustomization` é duas edições**: `git rm` do YAML **e**
  a linha em `resources`. O `kustomize` não avisa no commit; a Application
  `bridges` virou `Unknown` com `ComparisonError` só no reconcile. Nada caiu
  porque o Service já era gerenciado pela Application `postgres`, mas as duas
  pontes restantes dependiam de `bridges` reconciliando.
- **Terceiro cutover, primeira API de produção**: `domain.giomartins.dev` →
  `:30800`. Paridade provada com resposta **autenticada de dados reais**:
  `GET /finance/daily-summary?user_id=…&date=2026-10-23` devolveu 200 e
  **133 bytes idênticos** dos dois lados
  (`{"income":"0.00",…,"transaction_count":0}`), com o `user_id` lido da
  tabela `finance_bills` no Postgres que continua em Docker. Status 200 e
  corpo de erro idêntico não provariam leitura de banco — foi preciso acertar
  os dois parâmetros obrigatórios e usar um `user_id` que existe.
- **`domain-api` no cluster é distroless** (sem `sh`): probes e diagnóstico
  usam `tcpSocket`, e qualquer investigação tem de ser feita de um pod
  auxiliar, não com `kubectl exec ... sh`.
- **Duas ciladas de NodePort**: `30080` já é do ArgoCD — o k8s recusa a
  alocação, o Service fica `OutOfSync` sem aplicar, e um `curl` na porta
  devolve 200 *do ArgoCD*, falso positivo. E a `operation` do ArgoCD trava em
  retry com o manifesto obsoleto em cache; a saída foi `delete app
  --cascade=orphan` e deixar o ApplicationSet recriar. `30800` segue a
  convenção 80xx→308xx.
- **Primeiro tráfego real no cluster**: `adminer.giomartins.dev` passou a
  servir do pod (`:30092`) em vez do container (`:8092`). Prova de que veio do
  k8s: o log do pod recebe de `10.42.0.1` (a ponte do cluster) e o log do
  Docker parou de receber requisições no mesmo instante. Rollback é uma linha
  no `default.conf` (`30092` → `8092`) + `nginx -s reload`.
- **Segundo cutover, SPA com WebSocket**: `draw.giomartins.dev` → `:30023`.
  Paridade provada por hash, não por inspeção: HTML `4409a45a…` e bundle
  `index-CcD73-6E.js` `23c190c5…` idênticos nos dois lados. O WebSocket já
  estava configurado no `server{}` e continuou funcionando. Request marcado
  (`?prova=draw-k8s`) apareceu no pod e não no container.
- **adminer no k8s alcança o postgres em Docker**: PDO devolve
  `password authentication failed` com senha errada de propósito — prova de
  que o TCP abriu *e* o protocolo do Postgres respondeu. `could not connect`
  seria a ponte quebrada.
- **Paridade de versão conferida antes do cutover**: as duas instâncias
  serviam Adminer **6.0.1**. O manifesto estava em 6.1.2 — desvio pego
  comparando o HTML, não o status HTTP (o `<title>` era idêntico nas duas).
- **Pull do registry privado**: pod puxou `excalidraw` em 1,4 s pelo mirror
  `127.0.0.1:5000` com `imagePullSecret`.
- **Conteúdo idêntico**: `:30023` e `:8023` devolvem 6605 bytes e o mesmo
  `<title>`.
- **`selfHeal`**: `kubectl scale --replicas=2` à mão foi revertido para 1
  sozinho.
- **git → cluster**: mudar `replicas` para 2 no git e dar push fez o
  cluster subir a segunda réplica sem nenhum `kubectl`.
- **Pod alcança o postgres via EndpointSlice**: `fsockopen` responde OK, e
  o PDO chega a receber `fe_sendauth: no password supplied` — prova de que
  o TCP está estabelecido (só falta credencial, que é digitada na UI).
- **`domain-api` no k8s lê do postgres em Docker**: 10 `GET
  /finance/daily-summary` no pod produziram **21 transações commitadas** no
  banco (`xact_commit` de `pg_stat_database`, antes/depois). Não é o pod
  respondendo do cache — é o banco do Docker executando o trabalho.
- **`finance-api` alcança `domain-api` e `vaultwarden-api`** pelo DNS do
  cluster, embora os três tenham sido migrados em commits diferentes.
- **As 7 pontes abrem**: de dentro de um pod, `nc -zv` responde `open` para
  postgres, rabbitmq, minio, alloy, evolution-api, evolution-redis e
  vaultwarden — e cada ClusterIP tem ≥2 regras em `KUBE-SERVICES`.
- **Zero regressão**: 20/20 domínios com o mesmo status HTTP antes, depois,
  e após reiniciar o k3s.

### Kubero

UI em **NodePort 30200** (não exposta de fora; a security list da Oracle
bloqueia a faixa). Acesso por túnel:

```bash
ssh -N -L 30200:127.0.0.1:30200 ubuntu@168.138.135.6
# http://localhost:30200
```

No primeiro acesso, o Kubero pede para criar o usuário admin.

### Rancher

Instalado em 2026-10-23, **antes** da fatia 6, por decisão do usuário: a tela do
Rancher é a que ele quer usar como plano de controle.

**Não** é gerenciado pelo ArgoCD — é `helm`, não manifesto em `gitops/apps/`.
O motivo: o chart instala CRDs e um webhook de admissão próprios, e o
`ApplicationSet` sincroniza só diretórios de app. Os valores e o script de
instalação ficam versionados em `gitops/bootstrap/rancher/`.

```bash
helm repo add rancher-stable https://releases.rancher.com/server-charts/stable
helm repo update
kubectl create namespace cattle-system
helm install rancher rancher-stable/rancher \
  --version 2.15.2 --namespace cattle-system \
  -f rancher-values.yaml --set bootstrapPassword="$P"
```

O comando acima é o que foi digitado à mão na primeira vez. O que **reproduz**
é o script versionado:

```bash
sudo gitops/bootstrap/rancher/install.sh     # install ou upgrade, idempotente
```

Ele resolve três coisas que o `helm install` cru não resolve: exporta
`KUBECONFIG` (o k3s guarda o seu em `/etc/rancher/k3s/k3s.yaml`, que o `helm` não
conhece), não rotaciona a senha em execuções seguintes, e **fixa os NodePorts**
— o chart não expõe `nodePort` em `values`, então o k8s sorteia a cada
reinstall e o comando de túnel passaria a mentir.

Decisões que não são default do chart, e por quê:

| valor | default | usado | motivo |
| --- | --- | --- | --- |
| `replicas` | `3` | `1` | nó único; 2 réplicas ficariam `Pending` e o Deployment nunca fecharia |
| `networkExposure.type` | `ingress` | `none` | o Ingress do cluster não serve nada e o `ingress-nginx` está EOL; quem expõe é o nginx do host |
| `ingress.enabled` | `true` | `false` | idem |
| `service.type` | `""` | `NodePort` | acesso por túnel, sem DNS e sem tocar no Cloudflare |
| `tls` | `ingress` | `rancher` | auto-assinado; `letsEncrypt` falharia porque `rancher.giomartins.dev` ainda não existe no DNS |
| `agentTLSMode` | `strict` | `strict` | default de instalação nova desde 2.9; funciona porque o CA é o do próprio Rancher |

`hostname: rancher.giomartins.dev` já é o nome final. Isso é de propósito: o
certificado e os links da UI nascem com o nome definitivo.

**Acesso público: `https://rancher.giomartins.dev`** (desde 2026-10-23).

O caminho completo, e por que ele tem um salto a mais que os outros 18 hosts:

```
navegador ──TLS──> Cloudflare ──HTTP──> nginx do host :80 ──HTTPS──> Rancher :31844
                                                          (proxy_ssl_verify off)
```

O Rancher é o **único** host do `default.conf` com upstream HTTPS: o Service do
chart expõe 80 e 443, mas a 80 só redireciona, e o `server-url` exige TLS. Como o
certificado dele é auto-assinado, o `server{}` usa `proxy_ssl_verify off` — a
verificação que importa acontece no navegador, que vê o certificado do Cloudflare.

Esse `server{}` também é o único que **fixa** `X-Forwarded-Proto: https` em vez de
usar `$scheme`. Com `$scheme`, o Rancher passa a gerar links `http://` e o SPA
mostra "Network Error" no login — a explicação completa está na armadilha 10.

**Acesso por túnel** (continua válido, útil para debug quando o Cloudflare está no
meio do caminho):

```bash
ssh -N -L 31844:127.0.0.1:31844 ubuntu@168.138.135.6
# https://localhost:31844 — aviso de cert auto-assinado, normal
```

A senha de bootstrap **não está no chat nem no git**: está em
`/root/.rancher-bootstrap-password` (mode 600) e em
`cattle-system/bootstrap-secret`.

```bash
sudo cat /root/.rancher-bootstrap-password
# ou:
kubectl get secret bootstrap-secret -n cattle-system \
  -o go-template='{{.data.bootstrapPassword|base64decode}}{{ "\n" }}'
```

No primeiro login o Rancher **obriga** trocar a senha de bootstrap.

**A senha fica legível em `helm get values`.** Consequência de passar por
`--set`: o Helm guarda os valores do release num Secret (`sh.helm.release.v1.rancher.v1`),
e `helm get values rancher -n cattle-system` devolve o `bootstrapPassword` em
texto claro para quem tiver `get secret` naquele namespace. Não é vazamento
para fora do cluster (o Secret não é versionado nem exposto), mas quebra a
premissa de "só em `/root`". O remédio definitivo é `--set-file` com um arquivo
efêmero ou um `Secret` pré-criado com `bootstrapPassword` — quando o Rancher
for exposto publicamente (dívida 12), isso deve ser revisto junto.

**O que foi provado, não assumido:**

- pod `1/1 Running`, imagem `rancher/rancher:v2.15.2` arm64 (945 MB) puxada
- `POST /v3-public/localProviders/local?action=login` → **201** com token
- `GET /` → **200** com `Host: rancher.giomartins.dev`; `/dashboard/` → 200
- cluster `local` existe em `clusters.management.cattle.io` com `Ready=True`
- **zero Ingress objects** criados (confirmado) e os NodePorts novos não
  colidem com nenhum dos 15 anteriores
- 18/18 hosts de produção com o mesmo status HTTP; 26 containers (baseline 26);
  pods Running sem nenhum fora de `Running`
- **reinstall do zero provado**: `helm uninstall` + `install.sh` de novo. O k8s
  sorteou `32164`/`30789` para os NodePorts e o script corrigiu para
  `31198`/`31844`; login voltou `201` e a UI `200`. Sem esse passo o comando de
  túnel documentado apontaria para uma porta que não existe mais.
- **idempotência provada**: `install.sh` duas vezes seguidas não rotaciona a
  senha nem reescreve os NodePorts.

**Riscos aceitos, medidos:**

- **+1 admission webhook** num nó único: `rancher` soma aos
  `cert-manager-webhook` e `ingress-nginx-admission`. Se o pod não responder,
  `kubectl create` trava — por isso o Rancher não guarda estado crítico de
  produção, e `helm uninstall rancher -n cattle-system` remove webhook e CRDs.
- **~1.150 Mi de RAM, medidos** (`kubectl top`, 3 amostras estáveis), não os
  ~700 MB estimados antes de instalar. O pod do Rancher sozinho são ~830 Mi; o
  resto é o ecossistema que ele instala junto. Host foi de 13G para 16,6G de
  23G — sobram 7,4G.
- **O Rancher instala cinco namespaces além do `cattle-system`, e isso não é
  opcional.** `helm install rancher` traz, além dele: `cattle-fleet-system` +
  `cattle-fleet-local-system` (Fleet: 4 pods, ~230 Mi), `cattle-turtles-system`
  (Turtles, ~55 Mi) e `cattle-capi-system` (Cluster API, ~31 Mi). Mais
  `cattle-global-data`, `cattle-ui-plugin-system`, `cattle-impersonation-system`
  e `cattle-local-user-passwords`, que não rodam pods.
  Os dois últimos existem para **provisionar clusters** — capacidade que este
  nó único não vai usar. É o preço de instalar o Rancher inteiro em vez de só a
  UI; desativar não é suportado pelo chart.
- **O Fleet é um segundo motor de GitOps**, vazio hoje (`0` GitRepos, `0`
  Bundles). No dia em que alguém criar um `GitRepo` apontando para este
  repositório, ArgoCD e Fleet disputam os mesmos objetos. Ver dívida 14.
- **CPU**: 449m no pod do Rancher é o pico de boot, não o regime. O nó tem
  4 vCPU; se isso persistir, é o maior consumidor individual do cluster.
- **A UI ficou PÚBLICA, sem Cloudflare Access.** Decisão tomada em 2026-10-23 e
  registrada com o risco: agentes de cluster e webhooks do próprio Rancher são
  clientes não-browser que não completam um redirect de SSO Google. O login
  `admin` + senha do Rancher é a única camada. Medido: a API responde 401 sem
  token (`/v3/clusters`, `/v3/users`), e **não há lockout** — 5 tentativas de
  senha errada deram 401 sem bloqueio. Com a UI exposta, um ataque de força
  bruta contra `admin` é possível e ilimitado. Mitigação pendente: regra de
  WAF/rate-limit no Cloudflare para `/v3-public/localProviders/local?action=login`,
  ou reavaliar o Access com um *service token* para os agentes. Ver dívida 12.
- O pod do Rancher **não** é `replicas: 1` por escolha de disponibilidade — é o
  máximo que um nó único comporta.

### O ingress é um nginx, e não um Ingress controller (fatia 8)

O nginx que serve os 19 hosts agora é um pod (`gitops/apps/support/ingress/`),
com `hostNetwork: true` e `hostPort: 80`, rodando o **mesmo** `default.conf` do
host (`sha256 08e10fe5…`, 403 linhas, byte-idêntico). **Zero `Ingress` objects**
foram criados.

Isso é deliberado, e a alternativa foi considerada e recusada:

- migrar 19 hosts para `Ingress` objects significaria reescrever cada um dos 23
  `proxy_pass` como um backend + annotations para os casos que não são
  `location /` (as três SPAs servidas do MinIO por prefixo de bucket, o Rancher
  com upstream HTTPS e `proxy_ssl_verify off`, o SSE do `maus` e do `db-mcp`);
- e faria isso na **mesma janela** em que se muda quem publica a porta 80;
- um erro de digitação em uma linha derrubaria **um** host, sem erro visível no
  cluster — o ArgoCD mostraria tudo `Synced`.

O que se ganhou com a migração é o que se queria: **a porta 80 saiu do Docker**.
O arquivo continua sendo a fonte da verdade, agora por `configMapGenerator` —
o sufixo de hash faz o pod reiniciar sozinho quando uma linha muda.

### `ingress-nginx` está fora de suporte (dívida consciente)

`ingress-nginx` foi **aposentado em março/2026**; este ambiente é outubro/2026.
O próprio chart do Rancher registra isso (`includeDefaultExtraAnnotations` está
deprecado "due to ingress-nginx retiring in March 2026") e a seção de EOL do
projeto recomenda migrar para Gateway API ou outro controller.

Estado aqui, medido: **zero `Ingress` objects no cluster**. O controller roda
com NodePort `30945`/`30421` e não serve nenhum tráfego. Quem serve os 19 hosts
é o nginx da fatia 8 — um pod com `hostNetwork`, não o `ingress-nginx`.

Uma consequência disso para a dívida: como o `ingress-nginx` **nunca serviu
tráfego**, removê-lo hoje é uma operação de faxina (liberar RAM e um webhook de
admission), não uma migração. O que a decisão de 2026-10-23 protegia — "a troca
por Traefik/Gateway API afeta o roteamento dos 18 hosts" — não vale mais: o
roteamento está no `default.conf` do pod, que nenhum controller lê. A troca de
motor, se acontecer, é reescrever o `default.conf` como `Ingress` objects, e
isso é a migração própria que continua fora de escopo.

Decisão registrada em 2026-10-23: **não mexer agora**. Removê-lo liberaria RAM e
um webhook, mas o Kubero foi instalado assumindo um ingress controller
(armadilha 3) e a troca por Traefik/Gateway API afeta o roteamento dos 18 hosts
— é migração própria, não faxina. Fica como dívida, com a data visível.

## O que falta

A migração serviço a serviço acabou. O que resta não é "o próximo serviço" — é
uma decisão sobre quatro serviços que **não são lift-and-shift**, mais a faxina
final do Docker.

Estado em 2026-10-23 22:12 UTC: **17/17 Applications `Synced`**, zero pods fora
de `Running`, 19/19 hosts respondendo pelo pod do ingress, registry servindo 39
repositórios.

### `9router` — bloqueado pela própria sessão

Provisionado no git, `replicas: 0`, NodePort 30028 reservado. Exige parada por
causa do SQLite com WAL; o procedimento está no topo de
`gitops/apps/applications/9router/deployment.yaml`.

**O bloqueio é real, não teórico**: medido em 2026-10-23, o container `9router`
atendeu esta própria sessão (`opencode-free` → `ollama`/`deepseek-v4.1-flash`,
348 mensagens, 12 ferramentas). Parar o container no meio da migração mata o
agente que está fazendo a migração. Isso pede janela com o usuário presente e o
runbook em mãos — não um `docker stop` dentro de um script.

### `maus`, `tela-*`, `minecraft` — precisam de redesenho, não de manifesto

| serviço | por que não é lift-and-shift |
| --- | --- |
| `maus` | cria containers via `docker.sock` e monta `/data` do host. Migrar isso é emular Docker dentro do Kubernetes. |
| `tela-api` / `tela-mediamtx` / `tela-coturn` | `network_mode: host` com UDP (STUN/TURN/WebRTC). A porta 3478 UDP seria disputada com o Docker durante a transição. |
| `minecraft` | fora de escopo por decisão sua (jogo, não infra). |
| `dockhand` | é a UI do próprio Docker. Morre com ele, por definição. |

### A faxina final (só depois de observar)

Ordem deliberada, e cada passo é um commit separado:

1. **parar os duplicados ociosos** — `gitops/bootstrap/aposenta-duplicados.sh`,
   escrito mas **não executado**. Alvos: `adminer excalidraw grafana loki minio
   prometheus tempo db-mcp db-mcp-gateway`. O `alloy` fica de fora de propósito:
   é a única forma de ler o stdout dos containers que ainda restarem.
2. **`docker rm`** dos parados. O container parado é o rollback; remover é o
   último ato.
3. **desligar o Docker** (`systemctl disable --now docker`). Junto vão o
   `sync-external-endpoints.timer` (MAPA vazio desde a fatia 6, zero
   EndpointSlices manuais no cluster) e o `dockhand`.

**Por que não agora**: a fatia 8 cortou `ingress` e `registry` há pouco mais de
uma hora. A disciplina deste repositório é observar antes de remover o rollback
— e a armadilha 26 acabou de mostrar que "o pod subiu" não é o mesmo que "o
sistema está inteiro".


### O que ainda está em Docker e por quê

Não é pendência esquecida, é ordem deliberada:

| serviço | o que falta |
| --- | --- |
| `postgres` | migrado (fatia 6) — o container é rollback congelado |
| `vaultwarden` | migrado (fatia 6) — idem |
| `9router` | parada obrigatória (WAL) + é a porta de IA do host |
| `evolution-redis` | **migrado em 2026-10-23** — container parado, volume intacto como rollback |
| `tela-*` | `hostNetwork` + UDP (coturn, mediamtx) |
| `maus` | `docker.sock` + `/data` do host; exige redesenho |
| `alloy` | container de pé como rollback; o OTLP já é do pod `alloy-logs` |
| `ingress` | dono da porta 80; sai por último, com janela |

Ficam de fora, e por motivo, não por esquecimento:

- **`maus`** — cria containers via `docker.sock` e monta `/data` do host.
  Migrar isso para k8s seria emular Docker dentro do Kubernetes. Precisa de
  redesenho, não de manifesto.
- **`tela-api` / `tela-mediamtx` / `tela-coturn`** — `network_mode: host` com
  UDP (STUN/TURN/WebRTC). `hostNetwork: true` cobre parte, mas a porta 3478
  UDP passaria a ser disputada com o Docker durante a transição.
- **`ingress` / `registry` / `dockhand`** — os três formam um ciclo: o ingress
  é a porta de entrada, o registry serve as imagens que o cluster puxa, e o
  Dockhand é o plano de controle do que ainda está em Docker. Nessa ordem
  inversa, no fim.

## Dívidas conhecidas

1. ~~**IP do container nas pontes.**~~ **Resolvida em 2026-10-23.** Não existe
   mais nenhum Service de ponte: o último, `evolution-redis`, ganhou selector e
   o `MAPA` do timer ficou `()`. `postgres` e `vaultwarden` saíram na fatia 6,
   `alloy` e `evolution-redis` em 2026-10-23. O timer continua instalado e ativo,
   rodando a cada minuto sem tocar em nada — é a rede de segurança para um
   rollback de emergência (basta devolver a linha ao `MAPA`). Ele sai junto com o
   Docker, no fim. Verificado: **0** EndpointSlices sem `managed-by` no
   namespace.
2. ~~Patch do `argocd-cm` não versionado.~~ **Resolvido** em
   `gitops/bootstrap/argocd/` — lista versionada + script idempotente. Ainda é
   um passo manual no bootstrap, mas não depende mais de memória.
3. **O timer e o `sync-app-secrets.sh` não são declarativos.** São scripts
   instalados à mão em `/usr/local/sbin`. Funcionam e são idempotentes, mas não
   são reconciliados por nada — se a máquina for recriada, alguém precisa
   lembrar de rodá-los. O `bootstrap.sh` do repositório deve cobrir isso.
4. ~~**`vaultwarden` aparece como `Progressing` no ArgoCD.**~~ **Resolvido** na
   fatia 6: com `replicas: 1` o Deployment reporta `AvailableReplicas` e o health
   fica `Healthy`.
5. ~~**Os pods migrados não têm log no Loki.**~~ **Resolvido** — o coletor
   `alloy-logs` roda no cluster e cobre os pods (`loki.source.kubernetes`) e o
   que resta em Docker (`loki.source.docker` via `hostPath`).
6. **O `alloy` continua em Docker, mas deixou de receber telemetria.** Desde
   2026-10-23 o OTLP (traces e métricas) vai para o pod `alloy-logs`, que assumiu
   o Service `alloy`. O container monta `docker.sock` e usa
   `discovery.docker` + `loki.source.docker`, e não alcança a API do k3s
   (`172.18.0.1:6443` → refused) — mas o `alloy-logs` **também** monta
   `docker.sock` e já lê os containers, então os dois pipelines de log se
   sobrepõem. O container sai quando o último container sair; até lá, os logs
   dos containers são ingeridos **duas vezes** (labels `job=docker` em ambos),
   em dois Lokis diferentes. Custo: ~2 GB de disco, não corrupção.
7. **`domain.events.queue` acumulando sem consumidor.** Medido em 2026-10-23
   21:57 UTC: **2.929 mensagens, 0 consumidores**. A linha antiga deste README
   dizia 585 — cresceu 5× em poucas horas, o que muda a leitura: não é um resto
   inerte de um recurso abandonado, é um produtor ativo escrevendo para ninguém.
   O consumidor previsto (`events-announcer`) nunca existiu como container neste
   host. Pré-existente, não tocado: mexer em fila de produção sem entender o
   efeito não é migração.

   O total do broker é **2.954 mensagens em 28 filas, 6 delas com mensagens e
   zero consumidores** — as outras cinco são de `evolution.*` e somam 25. A
   diferença de ordem de grandeza entre as duas é o que aponta o produtor:
   `domain-worker` publica eventos de domínio e ninguém assina.

   **A fila está congelada, não crescendo.** Medido duas vezes com 45 s de
   intervalo: `2929 → 2929`, e nenhuma das 28 filas mudou. O `domain-worker`
   **está rodando** no cluster (1 pod, `processing loop started`), então o
   número parado não é "produtor morto": é produtor que só publica quando há
   evento de domínio. A medição importa porque um número que cresce pede ação
   imediata e um número parado pede decisão — e o README antigo (585) não
   distinguia os dois.

   Antes de "consertar": enfileirar sem consumidor **não** perde dado, mas o
   disco cresce. A correção certa é decidir se o `events-announcer` deve existir
   ou se o produtor deve parar de publicar — não criar um consumidor às pressas
   para drenar 2.929 eventos de origem desconhecida.
8. **`argocd-cm` sem `resource.exclusions` é estado do cluster, não do git** —
   o mesmo item 2 visto pelo outro lado.
9. **A imagem do `minio` existe só no registry local.** `minio/minio` saiu do
   Docker Hub; a única cópia é
   `registry.giomartins.dev:5000/minio:RELEASE.2025-09-07T16-13-09Z`, num
   volume em `/var/lib/registry`. Se o host se perder, o minio não volta de
   lugar nenhum — diferente das apps próprias, que a CI reconstrói a partir do
   git. Saída: espelhar essa imagem para um registro externo (ghcr público ou
   um tar em object storage) e registrar o procedimento de restauração.
10. **O `minio` no k8s não é alcançável por containers Docker pelo nome.** O DNS
   do Docker resolve `minio` para o container (que segue de pé como rollback), e
   não enxerga Services do cluster. O CI de frontend foi ajustado para
   `http://172.18.0.1:30900`; qualquer outro `docker run` que precise de S3 terá
   o mesmo problema e precisa do mesmo endereço explícito.
11. ~~**O `rancher-values.yaml` vive em `/tmp` no host.**~~ **Resolvido** em
   `gitops/bootstrap/rancher/` (`values.yaml` + `install.sh` idempotente), no
   mesmo padrão do `argocd-cm`. O script exporta `KUBECONFIG`, não rotaciona a
   senha em execuções seguintes e fixa os NodePorts, que o chart deixa o k8s
   sortear a cada reinstall.
12. **`rancher.giomartins.dev` está público, sem Access e sem rate-limit.**
   Resolvido em 2026-10-23 o DNS + ingress (A record no Terraform, `server{}`
   com upstream HTTPS no `default.conf`). O que **não** foi resolvido é a
   proteção: o hostname ficou em `excluded_hostnames` porque agentes e webhooks
   não-browser não passam por SSO, então o login `admin`+senha é a única camada
   — e o Rancher **não tem lockout** (5 senhas erradas seguidas, 5× `401`, sem
   bloqueio). Saídas, em ordem de custo:
   - regra de WAF/rate-limit no Cloudflare só para
     `/v3-public/localProviders/local?action=login` (não quebra agente);
   - Access com *service token* nos paths de agente + SSO no resto;
   - trocar `tls=rancher` por cert real e reativar `proxy_ssl_verify on`.
13. **`ingress-nginx` está EOL desde março/2026 e roda sem servir nada.** Detalhe
   e decisão na seção própria acima. Não é urgente (zero Ingress), mas é o
   componente mais desatualizado da plataforma.
14. **Três planos de controle de UI convivem no cluster** (ArgoCD, Kubero,
   Rancher). Consome RAM e confunde qual é a fonte de verdade: o ArgoCD
   reconcilia o `gitops/`; o Kubero e o Rancher não reconciliam nada hoje.
   Pior: o Rancher instalou o **Fleet** (`cattle-fleet-system`), que é um
   *segundo* motor de GitOps — vazio, mas presente. Três reconciliadores com um
   deles vazio é armadilha esperando acontecer: no dia em que alguém criar um
   `GitRepo` no Fleet apontando para este repositório, ArgoCD e Fleet vão
   disputar os mesmos objetos. Além disso, Turtles + CAPI (2 pods, ~86 Mi)
   existem para provisionar clusters que este nó único nunca vai provisionar.
   A decisão de qual plano de controle fica ainda não foi tomada.
15. **`/opt/giomartins/stacks/` no host DIVERGE do `stacks/` no git.** Descoberto
   ao aplicar o `restart: "no"` da fatia 6. Comparação direta:

   | arquivo | host (produção) | repo (git) |
   | --- | --- | --- |
   | `persistence.yml` | `postgres`, **`redis`**, `minio`, `minio-buckets` | `postgres`, **`rabbitmq`**, `minio`, `minio-buckets` |

   O host declara um serviço `redis` que nunca criou container (o Redis vivo é o
   `evolution-redis`, que não é declarado em stack nenhuma), e o repo já trocou
   esse slot pelo `rabbitmq`. **Copiar o arquivo do repo para o host apagaria a
   declaração `redis`** — por isso a mudança da fatia 6 foi aplicada cirurgicamente
   (só a linha de `restart`), não por `scp`.

   Consequência: o repo **não é** a fonte da verdade do Docker. O plano de
   controle real dos 24 containers ainda é o Dockhand + estes arquivos editados
   à mão. Enquanto a fatia 7 (`ingress`, `registry`) não fechar, isso não dói;
   depois dela, um `docker compose up` a partir do repo pode divergir do que
   está rodando. A saída é reconciliar os dois lados e versionar o que falta
   (`evolution-redis`, o stack `ai`), ou desligar o Dockhand e tratar o repo como
   fonte única.

   **Atualização 2026-10-23 (armadilha 13)**: o parágrafo acima subestima o
   problema. Não é que `/opt/giomartins/stacks/` divirja — é que **ele não é o
   diretório que roda nada**. Os containers de aplicação vêm de
   `/opt/stacks/project-infra/` e `/opt/stacks/project-apps/`, que o Dockhand
   sincroniza do git (`git_stacks.repository_id=1`,
   `compose_path=stacks/project-infra.yml`) e redeploya às 03:00 UTC. Dos 37
   containers, só 5 rodam de `/opt/giomartins/stacks/` (`ingress`, `registry`,
   `dockhand`, e 2 one-shots); 18 são de `project-infra`, 12 de `project-apps`,
   2 do `minecraft`.

   Por isso as edições da fatia 6 em `/opt/giomartins/stacks/` eram inertes para
   o Docker: o arquivo que o `compose up` lê é outro. O `restart: "no"` que
   aplicamos em runtime via `docker update` funcionava, mas teria sido desfeito
   na recriação seguinte de qualquer forma (o YAML de lá não tinha o `no`).

   A lição: antes de editar YAML "do host", confirme qual arquivo o processo de
   deploy realmente consome:

   ```bash
   docker inspect <container> \
     -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'
   ```
16. ~~**A observabilidade está PARTIDA em duas metades, e o painel esconde isso.**~~
   **Resolvido em 2026-10-23.** Descoberto ao responder "migrou tudo?". A fatia 4
   foi marcada ✅ com base em paridade de *estado* (1 dashboard, 1 usuário, mesma
   versão), mas a paridade de **fluxo** nunca foi medida. O que estava
   acontecendo:

   | dado | ia para | quem consulta no Grafana (`:30300`) |
   | --- | --- | --- |
   | **traces** dos pods | `tempo` **container** (172.18.0.11) | `tempo` **Service** (pod) |
   | **métricas** OTLP | `prometheus` **container** (172.18.0.8) | `prometheus` **Service** (pod) |
   | **logs** dos pods | `loki` Service (pod) | `loki` Service (pod) |

   A causa: os apps usam `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318`, e o
   Service `alloy` era a **ponte** para o container Docker. O `alloy-logs` era
   aditivo de propósito — só logs, sem receiver OTLP.

   **Correção em dois passos** (commits `f15181d` e `ca8c954`), no padrão dos
   cutovers da fatia 6 — o pod prova antes de o Service virar:

   1. `alloy-logs` ganhou `otelcol.receiver.otlp` (grpc 4317 + http 4318) com o
      pipeline copiado de `stacks/observability/alloy.alloy` e o CORS idêntico.
      Nada mudou de roteamento ainda.
   2. Provado ponta a ponta **mandando OTLP direto no IP do pod**:
      - span com `service.name=prova3-<ts>` → **1 trace** no Tempo do pod
      - gauge `metricprova_<ts>=42` → **1 série** no Prometheus do pod
   3. Só então o Service `alloy` ganhou `selector` e saiu do `MAPA` do timer —
      os três no mesmo commit: Service com selector, remoção do `MAPA`, e
      `bridges/alloy.yaml` apagado. Sem o segundo, o timer recriaria o
      EndpointSlice manual e o kube-proxy balancearia entre pod e container:
      metade dos traces sumindo, com `200 OK` nos dois alvos.

   Resultado medido depois: `job=finance-api` com 16 séries
   `http_server_duration_milliseconds_count` no Prometheus **do cluster** (era
   0), Tempo do pod com 20 traces de `domain-worker`, e span metrics
   (`traces_spanmetrics_calls_total`) de 6 chamadas.

   Efeito colateral corrigido junto: o target `job=alloy` do Prometheus estava
   `Down` permanente desde a fatia 4 — o Alloy escutava em `127.0.0.1:12345`
   dentro do pod e o Service apontava para o container. Agora escuta em
   `0.0.0.0` e a porta 12345 é exposta, então `up{job="alloy"}` = 1.

   Novo NodePort **30418** para `otel.giomartins.dev`; o `:4318` do container
   segue de pé como rollback (uma linha no ingress).
17. ~~**Os dois MinIOs divergiram e o console público aponta para o antigo.**~~
    **Resolvido em 2026-10-23, junto com o corte do ingress.** O `proxy_pass` do
    `server_name minio.giomartins.dev` era `127.0.0.1:9001` (console do container)
    e virou `127.0.0.1:30901` (console do pod), no mesmo arquivo que migrou para
    o pod. Verificado **no pod em produção**, não no repo:
    `sha256 08e10fe5…` e `proxy_pass http://127.0.0.1:30901` lidos de
    `/etc/nginx/conf.d/default.conf` dentro do pod do ingress.

    O par S3 (`:30900`) e o console (`:30901`) apontam agora para a **mesma**
    instância, que é a condição para o sintoma sumir: um upload feito pelo
    console passa a aparecer nos sites. Os objetos antigos eram idênticos por
    md5 (nada se perdeu); o que estava quebrado era só o caminho de escrita novo.
    O container `minio` continua rodando como rollback, com os dados de 28/09.
