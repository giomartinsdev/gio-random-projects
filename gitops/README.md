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

- ~~regra no `INPUT` para a 5000 vinda de fora~~ — **não funciona**, e eu tentei:
  o pacote é DNAT'd e sai por `FORWARD`, então a regra no `INPUT` fica inerte
  (o `curl` continuou devolvendo `401`). Ver "O conserto" abaixo;
- pôr a 5000 atrás da Cloudflare com TLS (quebra o nome das 39 imagens:
  `registry.giomartins.dev:5000` viraria `registry.giomartins.dev`);
- mover o push do CI para ghcr e deixar o registry só para pull interno.

**Regra**: depois de trocar NodePort por `hostPort`, testar a porta **de fora**
(`curl http://<ip-publico>:<porta>`), nunca só do host. Do host os dois parecem
iguais, e o `iptables -S INPUT` mostra um `REJECT` que dá a falsa impressão de
que tudo está fechado.

### O conserto (2026-10-24): a porta fechou, o túnel ficou

O descomissionamento do Docker resolveu esta armadilha **de graça**, porque
tirou o motivo de a 5000 estar aberta: o CI não precisa mais falar com o
registry pelo IP público.

Antes, o push vinha de `DOCKER_HOST=ssh://`, ou seja, era resolvido no daemon da
VPS e saía por **loopback**. Agora o build é no runner do GitHub e o push vai por
**túnel SSH** (`ssh -L 5000:127.0.0.1:5000`) — loopback também, só que do outro
lado. Ninguém, de fora, precisa da `5000`.

Três detalhes que custaram tentativa:

1. **`INPUT` não serve.** A primeira tentativa foi
   `iptables -I INPUT -p tcp --dport 5000 -j DROP`. O `curl` de fora continuou
   `401`. O `hostPort` do k3s faz DNAT e o pacote percorre `FORWARD`, não
   `INPUT` — a regra nunca é consultada. (E o `FORWARD` do k3s tem um `ACCEPT`
   por *mark* `0x20000` que vem do `CNI-HOSTPORT-SETMARK`, então "só dropar no
   FORWARD" também é frágil: o k3s reordena a cadeia a cada boot.)
2. **`raw/PREROUTING` é o lugar certo.** Ela é avaliada **antes** do DNAT e o
   k3s não escreve nela (conferido: zero regras `KUBE*`/`CNI*` na tabela `raw`).
   A regra fica `-A PREROUTING -i enp0s6 -p tcp --dport 5000 -j DROP`, seguindo
   a convenção que já existia ali para as portas `80xx` (`-d 127.0.0.1/32 ! -i
   lo ... -j DROP`).
3. **Bloquear por interface, não por origem.** `-s 127.0.0.1 -j ACCEPT` antes do
   `DROP` **não** protege o túnel: o pacote do túnel SSH chega pela `lo` já
   reescrito, e quem precisa passar é o `k3s` no próprio host. `-i enp0s6` deixa
   passar todo o tráfego local (loopback, pods) e barra só o que vem da
   interface pública.

**Prova, nos três caminhos**:

| caminho | resultado |
| --- | --- |
| de fora (`registry.giomartins.dev:5000`, da minha máquina) | `000` (fechado) |
| do host (`127.0.0.1:5000`, o que o containerd do k3s usa) | `401` (vivo) |
| pelo túnel SSH (o que o CI usa) | `401` (vivo) |

E o teste que importa não é o `curl`: foi **deletar o pod do `domain-api`** e ver
o substituto subir `1/1 Running` — prova de que o pull da imagem continua
funcionando com a porta fechada para a internet.

**Lição para o próximo `hostPort`**: "fechar no `INPUT`" é a resposta intuitiva e
está errada. O lugar é `raw/PREROUTING`, e a prova é `curl` de fora, não
`iptables -S`.

### O conserto quase reverteu ao boot (2026-10-24, mesmo dia)

A regra do `raw/PREROUTING` **morreu no caso de teste não imaginado: o reboot**.
Depois do primeiro reboot pós-conserto, `iptables -t raw -S PREROUTING | grep
5000` dava **zero** — o registry voltou a ficar exposto (401 de fora).

Causa raiz, achada no `netfilter-persistent`: o unit **falhou no boot com
`status=4`** antes de o k3s subir, porque o `/etc/iptables/rules.v4` persistido
incluía as chains do **k3s/kube-router/CNI** (`CNI-DN-*`, `KUBE-SERVICES`,
`KUBE-NWPLCY-*`, `FLANNEL-*`), que referenciam interfaces (`cni0`, `veth*`,
`flannel.1`) e ipsets (`KUBE-SRC-*`) **que só existem depois de o k3s criar**.
O `iptables-restore` morre no meio do arquivo, antes de chegar às regras
próprias que estavam logo no começo — e o resultado no boot é **zero regras**,
não "regras parciais". O `iptables-restore --test` rodado com o cluster de pé
passava, porque teste com o k3s vivo usa o estado do kernel como referência
implícita — não simula o boot.

**Como ficou (`rules.v4` reescrito em 2026-10-24, 01:57 UTC)**:

- 1542 linhas → 64. Só tabelas com políticas `ACCEPT` + as regras próprias
  (`raw`: os 12 DROPs — a 5000 e os anti-spoof `-d 127.0.0.1/32` das portas
  `80xx`+`8090`; `filter`: o DROP 25565, os ACCEPTs de `3478`/`8217`/
  `49160:49200`/`16261-2` — **que são as portas do `tela` em `hostNetwork`, não
  lixo de jogo** —, ESTABLISHED, icmp, lo, 80/443/22, e a chain
  `InstanceServices` da OCI, que é infraestrutura da imagem, removê-la é
  avisado como perigo no próprio comment) + `*nat` só com políticas.
- zero chains k3s/CNI/flannel/docker — **o k3s recria as dele sozinho no boot**;
  o que o arquivo precisa guardar são só as regras de quem nunca reaparece.
- `:FORWARD DROP` → `:FORWARD ACCEPT` no arquivo: o kernel vem rodando com
  ACCEPT desde o reboot (o restore falhara), e mudar política no papel sem
  testaria o boot é pedir o mesmo susto de novo.
- REJECT halves de INPUT **deliberadamente fora** — ver dívida 24.

**Prova de que o arquivo sobrevive ao boot sem reboot**: `iptables-restore
--test` no arquivo novo passa **independente do estado do kernel**, porque o
arquivo não referencia mais nada que o kernel não tenha antes do k3s. O teste
da próxima reboot é de rotina, não de fé.

**Ao vivo, sem reboot**: `iptables-restore` completo **não** — ele substituíria
o conteúdo das tabelas e limparia as chains vivas do k3s (o restore duas tabelas
vazias era justamente o risco: um arquivo de "tabelas vazias" passou no `--test`
e estaria aplicável). Foi aplicado só o corte cirúrgico: os 12 DROPs na `raw` e
o DROP 25565 no `INPUT` — regras que não tocam caminho nenhum do k8s (as portas
delas não existem no cluster). Prova antes/depois, da minha máquina:

| quando | `curl http://168.138.135.6:5000/v2/` |
| --- | --- |
| antes | `401` em 0,11s (porta aberta, auth parado) |
| depois | `000` — connection timed out (DROP) |

E de dentro, `127.0.0.1:5000` → `401` (o túnel CI e o containerd continuam
vivos), cluster 18/18 depois.

**Lição maior que a regra**: regras de firewall próprias (que **eu** escrevi) e
regras que um **daemon** recria são coisas com ciclos de vida diferentes. O
`netfilter-persistent save` com o k3s de pé captura a fotografia errada — as do
demonio vão existir de novo sem o arquivo; as minhas não. A partir de agora:
**nunca rodar `netfilter-persistent save` com o k3s ativo**; se precisar
persistir uma regra, adicionar a linha à mão no `rules.v4` (e não inserir chain
nem interface que só exista depois de algum serviço).

**Prova do conserto da armadilha 30** (mesmo dia, `prova-restart-alloy.sh`): o
pod foi **deletado e recriado** com o PVC montado. Resultado: 61 linhas de
`positions.yml` no Docker preservadas, 1.893 entradas enviadas em 90 s,
**zero descartadas**, zero linhas `dropping data`, e OTLP íntegro
(`accepted_spans_total` = `exporter_sent_spans_total` = 3.035). Antes do
conserto, o mesmo restart produzia os 115.696 descartes. O critério de
verificação é **contagem de linhas** (≈61 contra 1–2 se vazio), não md5: o
arquivo avança a cada linha lida, então o hash difere mesmo quando está tudo
certo.



### 32. Em `hostNetwork`, o probe dial-a o IP do nó — não o loopback.

Descoberto ao migrar o `tela-api`, que escuta `127.0.0.1:8007` de propósito (só
o ingress, também `hostNetwork`, precisa alcançá-lo). O pod subia, o processo
respondia perfeitamente no host, e o pod ficava **`Running` e nunca `Ready`**:

```
Warning  Unhealthy  Readiness probe failed: Get "http://10.0.0.209:8007/healthz":
         dial tcp 10.0.0.209:8007: connect: connection refused
```

Com `hostNetwork: true` o `podIP` **é** o IP do nó, e o kubelet monta a URL do
probe com ele. Um processo que fez bind em `127.0.0.1` não responde nesse
endereço. Provado com dois pods de teste lado a lado, ambos escutando só no
loopback:

| pod | probe | resultado |
| --- | --- | --- |
| `probe-hl2` | `tcpSocket: {host: 127.0.0.1, port: 39995}` | **1/1 Ready** |
| `probe-hl3` | `tcpSocket: {port: 39994}` (sem `host`) | **0/1, nunca Ready** |

A correção é `host: 127.0.0.1` no probe — e ela preserva o bind restrito, que é
uma garantia estrutural. A alternativa óbvia (`BIND_HOST=0.0.0.0`) trocaria
"não é alcançável pela internet" por "não é alcançável enquanto o firewall
estiver certo".

Os três pods do `tela` usam `host: 127.0.0.1` (o `mediamtx` e a `tela-api`
escutam loopback; o `coturn` escuta no IP privado e poderia dispensar, mas a
forma uniforme evita a pergunta "por que este é diferente").

**Regra**: qualquer workload `hostNetwork` com bind restrito precisa de
`host: 127.0.0.1` no probe. Sintoma diagnóstico: pod `Running`, `0/1`, processo
comprovadamente vivo no host.

### 33. `fsGroup` conserta uma persistência que falhava em silêncio.

O `tela-state` do Docker era `root:root 755` e o processo rodava `nonroot`: o
`persist()` do registry engolia o erro (`if err := ...; err != nil { return }`),
a API respondia `201` ao criar sala, e **o arquivo nunca era gravado**. Provei
criando uma sala: `{"roomId":"tijolo83galinha"}`, com o volume continuando
vazio. Consequência real: todo redeploy do container perdia as salas, e nada
nos logs dizia isso.

No k8s, `securityContext.fsGroup: 65532` (o uid do `nonroot` na distroless) faz
o kubelet dar grupo de escrita no PVC. Verificado: `rooms.json` nasce
`65532:65532`, e um restart do pod prova a restauração
(`rooms restored, count: 1`).

**Regra**: volume montado em processo não-root precisa de `fsGroup` (ou
`initContainer` de `chown`). "O pod subiu e a API responde" não prova que a
gravação funciona — crie um registro e confira o arquivo.

### 34. `Delete` que chama `persist()` sob lock trava o processo inteiro.

Bug de aplicação encontrado **pela** migração, não causado por ela: o volume
passou a funcionar (armadilha 33) e aí o caminho de código do `persist()` foi
exercitado de verdade.

Em `internal/rooms/rooms.go`, `Delete` fazia `defer r.mu.Unlock()` e chamava
`r.persist()`, que pega **o mesmo** `r.mu`. `Create`, `Sweep` e `SweepIdle` já
soltavam o lock antes; `Delete` era a única que não — e `Create` tem até um
comentário explicando o cuidado, o que mostra que o padrão era conhecido.

O sintoma é desproporcional à causa:

```
DELETE /api/rooms/<id>  →  timeout de 8s
GET    /healthz         →  timeout de 8s   (Count() pega o mesmo mutex)
```

O mutex é do **registry inteiro**, não da sala, e `/healthz` chama `Count()`.
Resultado: apagar uma sala congela a API toda, o liveness probe falha, e o
kubelet mata o container. Qualquer usuário apagando uma sala derrubava o
serviço para todos.

**Regra**: um `defer Unlock` combinado com uma função que pega o mesmo lock é
deadlock garantido. O teste de regressão (`TestDeleteDoesNotDeadlock`) falha no
código antigo — provado por `git stash` — e passa no novo.

### 35. Nome de container PARADO sai do DNS do Docker.

O CI de imagens morreu calado na fatia 6, e a causa é essa linha só.

`fetch_vault_secret.sh` roda um container na rede `apps` e o proxy interno
aponta para `http://vaultwarden:80`. Enquanto o Vaultwarden era container, o
nome resolvia. Depois do cutover, o **pod** assumiu o serviço e o container
homônimo ficou parado como rollback — e o Docker removeu o nome do DNS da rede.
Resultado, em todo pipeline de imagem:

```
Error: getaddrinfo EAI_AGAIN vaultwarden
```

Isso acontece **antes** do build, então nenhuma imagem nova era publicada desde
a fatia 6. Verde em nenhum lugar, vermelho no primeiro passo.

A lição não é "consertar o script", é que **parar um container pode quebrar
consumidores que não parecem ligados a ele**. O `docker stop` é reversível para
quem usa a porta; para quem usa o *nome*, o efeito é imediato e invisível.

**Conserto**: o script ganhou `VAULTWARDEN_UPSTREAM` (`host:port`) e o CI passa
`host.docker.internal:30822`, o NodePort do Service `vaultwarden` em
`persistence`. NodePort, não ClusterIP: o IP do Service muda se o Service for
recriado, o NodePort é constante (armadilha 31). `--add-host
host.docker.internal:host-gateway` é o que faz o nome existir num container
Linux.

Provado com as credenciais reais, lidas do Secret `vaultwarden-api`:
caminho novo devolve `REGISTRY_USERNAME`/`REGISTRY_PASSWORD` e sai 0; o antigo
sai 1 com `EAI_AGAIN`.

**Regra**: ao parar um container, procure quem o referencia **por nome** —
`grep` no repo por `docker run.*--network` e por hostnames de serviço. Porta
fechada dá erro na hora; nome que sumiu dá erro no próximo pipeline.

### 36. `profiles: ["retired"]` só protege se estiver em TODOS os serviços.

A armadilha mais cara da faxina, e a única com prazo: ela tinha hora marcada
para acontecer.

O `docker compose up -d` que o Dockhand roda nos stacks 21 e 22 é:

```
docker compose -p project-apps \
  -f /opt/stacks/project-apps/project-apps.yml \
  --env-file /opt/stacks/project-apps/.env.dockhand \
  up -d --remove-orphans --force-recreate --pull always
```

Note o que **não** está ali: `--profile`. Consequência direta: um serviço só
fica de fora do `up` se ele mesmo declarar `profiles: ["retired"]`. O
`restart: "no"` não ajuda em nada — ele rege auto-restart pós-crash e reboot,
não o `up` explícito.

Em 2026-10-23 a trava existia em 4 arquivos (`domain`, `finance`, `tela`,
`compute`) e faltava em 6 (`persistence`, `observability`, `db-mcp`,
`excalidraw`, `maus`, `core`). O stack 22 tem
`auto_update=1, auto_update_cron='0 3 * * *'`.

**Isso não era teórico.** Publiquei o `tela-api` pelo CI, o workflow chamou o
webhook do stack 22, e o Dockhand rodou o comando acima. Resultado em 20
segundos: `excalidraw`, `omb`, `maus-caddy` e `maus-slack-bridge` voltaram a
rodar — containers que eu tinha acabado de parar. As 03:00 UTC de hoje o mesmo
comando teria subido mais oito (`minio`, `loki`, `prometheus`, `tempo`,
`grafana`, `db-mcp`, `db-mcp-gateway`), todos disputando porta com os pods
(9000, 3100, 9090, 3200, 3000, 8023…).

O sintoma é silencioso do jeito pior: o compose faz o que mandaram, sai 0, o
Dockhand marca `synced`, e o ArgoCD continua `Healthy` porque os pods não
caíram — os dois passam a servir a mesma porta, um pelo DNAT do Docker e outro
pelo NodePort, e qual responde depende da regra de iptables que vier primeiro.

**Duas armadilhas embutidas na primeira:**

1. `profiles` não é herdado por `include:`. O `project-infra.yml` inclui
   `observability.yml`, e o profile tem de estar no serviço, no arquivo-folha.
2. `depends_on` não respeita profile. `alloy` e `grafana` dependiam de
   `loki`/`prometheus`/`tempo`; ao aposentar os três, o compose passou a
   recusar o projeto **inteiro** com `depends on undefined service` — o `up`
   falharia por completo, inclusive para o que deveria subir. Os dois
   `depends_on` saíram junto.

**A prova que vale**, com o comando exato do Dockhand numa cópia dos stacks:

```bash
# sem profile -> a lista de serviços é VAZIA (a trava funciona)
docker compose -f persistence.yml config --services          # (nada)
# com profile -> aparecem os cinco, para rollback consciente
docker compose -f observability.yml --profile retired config --services
# e o agregado, que é o que o Dockhand roda:
docker compose -p project-infra -f project-infra.yml --dry-run up -d --remove-orphans
#   -> "no service selected", exit 1: não sobe e não remove nada
docker compose -p project-apps -f project-apps.yml --dry-run up -d --remove-orphans
#   -> toca só omb/maus-caddy/maus-slack-bridge; NÃO remove os parados
docker compose -p core -f core.yml --dry-run up -d --remove-orphans
#   -> toca só dockhand (registry/ingress foram aposentados em 2026-10-24)
```

> **`no service selected` sai com código 1**, e isso é intencional do Compose —
> não é erro, é "não há nada a fazer". A consequência a observar: o Dockhand
> pode registrar a execução de `project-infra` como falha. Vale checar em
> `schedule_executions` depois do primeiro `auto_update` real às 03:00 UTC. Se
> marcar `failed`, a saída é dar a `project-infra` um serviço vivo ou desligar
> o `auto_update` dele — o que **não** apaga nada, só para de rodar um comando
> que não tem o que fazer. (Dívida 19.)

O último ponto importa: `--remove-orphans` **não** apaga os containers
parados, porque eles pertencem a outro project name (`maus` vs `project-apps`).
Se apagasse, a faxina teria destruído o próprio rollback.

**Efeito colateral bom**: o `alloy` do Docker também ganhou a trava, e por um
motivo próprio. Ele escrevia em `loki:3100`, que está parado, então desde o
cutover *todo* batch falhava com `server misbehaving` — log ingerido em lugar
nenhum. O pod `alloy-logs` já lê os mesmos containers via `docker.sock`;
provado consultando o Loki do cluster, que tem `job=docker` com logs de
`excalidraw`, `tela-api`, `9router` e mais 22. Parar o container não tirou
visibilidade de nada.

**Regra**: todo serviço migrado precisa de `profiles: ["retired"]` **no
próprio bloco** — `include:` não herda profile. Isso é verificável, e agora é
gate de CI (`gitops-validate`), porque um comentário não impede regressão:

```bash
gitops/bootstrap/checa-profiles.sh stacks
```

A saída lista o que o `up` das 03:00 vai subir. O esperado é só `maus`
(não migrado), `minecraft` (fora de escopo) e `core` (morre com o Docker).
Qualquer outro nome é um migrado voltando — o script sai 1, e o CI com ele.

## Bootstrap (uma vez por cluster)

Reconstruir do zero neste host, na ordem. Nada aqui é reconciliado pelo
ArgoCD — é o chão que o ArgoCD precisa existir antes de assumir.

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

**O cluster é tudo o que roda na VPS** desde 2026-10-24: o Docker foi
desinstalado. **21/21 Applications** `Synced`+`Healthy` (18 originais + 4 de
rotas VirtualServer − 1 do ingress legado prunado), zero pods fora de
`Running`, zero containers.

A tabela abaixo é o retrato da migração serviço a serviço (verificada em
2026-10-23, depois do bootstrap e da fatia 3). Mantida como registro do
corte — não é o inventário de agora.

> **A coluna "Docker" é o retrato daquela verificação, não o estado de agora.**
> Em 2026-10-23 os ociosos foram parados (`restart=no` + `docker stop`, ver "A
> faxina final"): `excalidraw`, `adminer`, `grafana`, `loki`, `minio`,
> `prometheus`, `tempo`, `db-mcp`, `db-mcp-gateway`. Em **2026-10-24 todos os
> parados foram removidos** (`docker rm`, ver "A remoção dos parados"): não há
> mais rollback por `docker start` em lugar nenhum desta tabela. O rollback
> agora é `docker compose --profile retired up -d` — e desde o fim de
> 2026-10-24 exige reinstalar o Docker (o daemon foi desinstalado). A tabela
> fica como registro
> histórico da verificação.

**Regra que governa a tabela:** o container Docker só é desligado *depois* de o
equivalente no k8s provar que serve, e o tráfego só muda num commit separado.
A coluna "tráfego" registra onde o tráfego está **hoje**.

| serviço | Docker | k8s | tráfego |
| --- | --- | --- | --- |
| `excalidraw` | **parado** (2026-10-23) | **rodando** (NodePort 30023) | **k8s** — `draw` → `:30023` ✅ |
| `adminer` | **parado** (2026-10-23) | **rodando** (NodePort 30092) | **k8s** — `adminer` → `:30092` ✅ |
| `domain-api` | rodando (ocioso) | **rodando** (NodePort 30800) | **k8s** — `domain` → `:30800` ✅ |
| `domain-worker` | **removido** (2026-10-24) | **rodando** (`replicas: 1`) | **k8s** — único escritor do CQRS; o container foi parado antes de subir o pod |
| `finance-api` | rodando (só consumo interno) | **rodando** (NodePort 30818) | **k8s** — `finance-api` → `:30818` ✅ |
| `finance-openfinance-worker` | **parado** | **rodando** (`replicas: 1`) | **k8s** — poller do Polp, sem tráfego externo ✅ |
| `finance-customersupport-worker` | **removido** (2026-10-24) | **rodando** (`replicas: 1`) | **k8s** — consumidor de fila, sem porta |
| `vaultwarden-api` | rodando | **rodando** (ClusterIP:8080) | sem tráfego externo (bridge interna) |
| `vaultwarden` | **parado** | **rodando** (NodePort 30822) | **k8s** — `vault` → `:30822`, `/api/config` idêntico byte a byte ✅ |
| `9router` | **removido** (2026-10-24) | **rodando** (NodePort 30028) | **k8s** — `ai` → `:30028` ✅ |
| `minio` | **parado** (2026-10-23) | **rodando** (NodePort 30900/30901) | **k8s** — 8 buckets idênticos, 3 SPAs ✅ |
| `rabbitmq` | **removido** (2026-10-24) | **rodando** (NodePort 31525/30672) | **k8s** — 29 filas, 12 exchanges, 62 bindings idênticos ✅ |
| `postgres` | **parado** | **rodando** (ClusterIP:5432) | **k8s** — 54/55 tabelas idênticas, `finance_transactions` md5 igual ✅ |
| `prometheus` | **parado** (2026-10-23) | **rodando** (ClusterIP:9090) | **k8s** — 898M copiados, 8.841 séries ✅ |
| `loki` | **parado** (2026-10-23) | **rodando** (ClusterIP:3100) | **k8s** — 976M copiados ✅ |
| `tempo` | **parado** (2026-10-23) | **rodando** (ClusterIP:3200) | **k8s** — 308M copiados ✅ |
| `grafana` | **parado** (2026-10-23) | **rodando** (NodePort 30300) | **k8s** — `grafana` → `:30300` ✅ |
| `alloy` | **removido** (2026-10-24) | **rodando** (OTLP 4317/4318 + logs, PVC) | **k8s** — pod `alloy-logs` serve o Service `alloy` |
| `registry` | **removido** (2026-10-24) | **rodando** (`hostPort: 5000`) | **k8s** — 39 repos, 12 GB verificados por sha256 ✅ |
| ingress legado (nginx em CM) | **removido** (cutover 2026-10-24 03:23Z, ver "O ingress virou controller") |NIC 5.7.0 em `hostNetwork` responde :80 | **NIC** — 17/17 hosts com paridade provada (21/21 na matriz interna) ✅ |
| demais 6 containers | `dockhand`, `maus`×3, `minecraft`×2 | **nenhum** (daemon desinstalado em 2026-10-24) | parados/descomissionados — ver "O que ainda está em Docker" |
| 17 hosts do ingress | — | — | status idêntico antes/depois (matriz repetida nos dois) |`replicas: 0` não é esquecimento: são consumidores de fila ou donos de volume
com escrita exclusiva. Rodar dois ao mesmo tempo duplica mensagem ou corrompe
dado. Subir para 1 *é* o ato de migrar, e exige parar o Docker antes.

Plataforma no cluster: k3s, ArgoCD, **NIC 5.7.0** (hostNetwork :80 — ver "O
ingress virou controller"), cert-manager, metrics-server, Kubero (operator +
UI em NodePort 30200), Rancher 2.15.2 + Fleet + Turtles + CAPI (NodePort
31198/31844).

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
| 30028 | 9router |
| 30080 | argocd-server |
| 30092 | adminer |
| 30200 | kubero |
| 30300 | grafana |
| 30672 | rabbitmq management |
| 30800 | domain-api |
| 30808 | evolution-api |
| 30818 | finance-api |
| 30821 | db-mcp gateway |
| 30822 | vaultwarden |
| 30900 | minio s3 |
| 30901 | minio console |
| 31528 | NIC — debug da fase azul (o serve é pelo hostNetwork :80) |
| 31759 | NIC debug https (fase azul) |
| 31198 | rancher (http, redireciona para 443) |
| 31525 | rabbitmq amqp (NodePort automático) |
| 31844 | rancher (https) |

`30028` deixou de ser reserva em 2026-10-23: o pod do `9router` está de pé e é
ele quem atende `ai.giomartins.dev`. A prática de reservar o NodePort antes de
haver pod continua valendo — quem for escolher a próxima porta vê o número
ocupado e não planeja em cima dele.

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

### O ingress virou controller + `VirtualServer` (2026-10-24)

A história mudou duas vezes em 24h. A primeira (fatia 8) levou o nginx com os
`server` blocks para dentro do cluster (`gitops/apps/support/ingress/`,
ConfigMap gerado do `default.conf`). A segunda — esta — trocou o motor: o
namespace `support/ingress` foi removido e a rota dos hosts virou
**`VirtualServer` (CRD `k8s.nginx.org/v1`)** servida pelo **NIC
(nginx-ingress 5.7.0)** da NGINX/F5, em `helm release nic/namespace nic`,
rodando **`hostNetwork`** e respondendo pela :80 do host.

Por que `_VirtualServer_` e não `Ingress` nativo: o `Ingress` não expressa o
que estas rotas fazem — reescrita de SPA por host com capture
(`/tela-frontend$1`), upstream HTTPS com `proxy_ssl_verify off` (rancher),
SSE de 1h (db-mcp). O CRD expressa tudo declarativamente, e o resultado é o
mesmo nginx. A rota vive em 4 folders do GitOps, um por namespace (nomes
únicos — ver armadilha 42):

- `gitops/apps/persistence/routes/` — vault, minio, rabbit + as 3 SPAs
- `gitops/apps/applications/routes-*/` — domain, ai, evolution, draw, finance-api, **tela-api**
- `gitops/apps/observability/routes-*/` — grafana, otel
- `gitops/apps/support/routes-*/` — adminer, db-mcp (timeout 1h + buffering off no upstream), **rancher** (upstream cross-ns `cattle-system/rancher:443` com `tls.enable`)

#### O caso `tela-api` — por que o controller hostNetwork

A tela-api escuta `127.0.0.1:8007` de propósito (ver
`gitops/apps/applications/tela/api.yaml`): o bind no loopback é a garantia
estrutural de que a 8007 não existe para a internet. Isso fechou três caminhos,
**todos provados**:

1. `Endpoints` manual apontando para `127.0.0.1` — o API server **recusa**
   (`may not be in the loopback range`);
2. mudar o bind para `0.0.0.0` + firewall — trocar garantia estrutural por
   condicional é decisão recusada no manifesto do app;
3. `Service ExternalName` — o NIC não diala DNS de Service; upstream vira o
   socket 502 dummy dele (provado em probe).

O que funcionou: o **NIC em `hostNetwork`** (mesma netns do pod legado, que já
era) + `location-snippets` com **location aninhada** — o CRD exige uma
`action` com upstream (dummy, nunca atingido), e o snippet injeta uma
`location ~ ^/` dentro da location gerada que intercepta 100% das requests e
faz o `proxy_pass http://127.0.0.1:8007` real. Nginx permite location dentro
de location; o mecanismo foi provado com `return 999` antes de ir pra
produção.

#### O cutover em si (aplicado 2026-10-24 03:23Z)

Fase azul primeiro: NIC em NodePort (31528/31759) com os 17 hosts + matriz de
21 provas (19/21 idênticas ao legado; o `tela-api` 502 azul é o dial de
`127.0.0.1` na netns CNI — vira 404 com hostNetwork). O cutover:

1. `helm upgrade` — NIC para `hostNetwork` (o pod fica `Pending` até a :80
   liberar: o kubelet não agenda pod com conflito de porta declarada);
2. commit removendo `gitops/apps/support/ingress/` — o AppSet `root` prune o
   Application, o controller de cascade mata o pod legado;
3. **script nohup no VPS** (`/opt/k8s-backups/cutover-2026-10-24/cutover.sh`)
   que no instante em que o *objeto* do pod legado desaparece (não basta sair
   de `Running`: em `Terminating` o socket da :80 ainda é dele), faz
   `rollout restart` no NIC — o pod prende a :80 em segundos;
4. matriz de 17 hosts em :80 comparada aos códigos provados na fase azul;
   **qualquer divergência → rollback automático** (reaplicar o snapshot YAML
   do ingress legado, salvo em `/opt/k8s-backups/cutover-2026-10-24/`, +
   helm do NIC de volta pra NodePort).

Resultado medido: **17/17 hosts com paridade**, incluindo `tela-api` 404, e a
sessão do próprio agente (que atravessa `ai.giomartins.dev`) sobreviveu.

#### `ingress-nginx` foi removido (a dívida morreu)

O controller EOL (`kubernetes/ingress-nginx`) foi instalado em 2026-10-23 e
**nunca serviu um byte de tráfego público** — zero `Ingress` objects em
qualquer momento. Era faxina, não migração. Removido em 2026-10-24: helm
release (q.q. tenha sido o método de instalação — nada de `helm list` apontava
pra ele), namespace `ingress-nginx`, `IngressClass nginx` e o webhook
`ingress-nginx-admission`. O Kubero que foi instalado assumindo ingress
controller (armadilha 3) segue com um controller real: o NIC, agora com
`IngressClass nic`. Rollback documenta-se: `helm install` do chart + namespace
— nada de estado nele.

Plataforma no cluster: k3s, ArgoCD, **NIC 5.7.0 (hostNetwork :80)**,
cert-manager, metrics-server, Kubero (NodePort 30200), Rancher 2.15.2 +
Fleet + Turtles + CAPI (NodePort 31198/31844).

## O Docker acabou (2026-10-24)

**A VPS é só o cluster.** O daemon foi parado, desabilitado e desinstalado
(`apt purge docker-ce docker-ce-cli containerd.io ...`), e `/var/lib/docker`
removido. Não existe mais `docker`, `docker.sock`, `docker0`, nem unit do
systemd com esse nome. O k3s usa o **containerd próprio** (`/var/lib/rancher`),
nunca o do Docker — por isso o cluster não sentiu nada.

Estado no fim do dia: **18/18 Applications `Synced`+`Healthy`**, zero pods fora
de `Running`, 16/16 hosts públicos respondendo, e **zero containers**.

### A ordem em que foi feito (e por quê)

Nada foi destruído antes do equivalente em k8s provar que serve. O que mudou:

1. **`maus` e `minecraft` — parados, não migrados** (decisão do usuário). Eram
   os dois últimos serviços legítimos em Docker. O `omb` era o bloqueio duro:
   monta `/var/run/docker.sock` e **cria containers** como parte do produto —
   migrá-lo seria emular Docker dentro do Kubernetes. O `minecraft` estava 5
   dias sem jogador e custava 5,4 GB de RAM.

2. **O CI deixou de depender do daemon** — e essa era a parte não óbvia. Os 6
   workflows buildavam com `DOCKER_HOST=ssh://ubuntu@$VPS_HOST` e provavam o
   deploy com `docker ps`. Ver "O CI sem o daemon", abaixo.

3. **`alloy-logs` perdeu o pipeline Docker** (`discovery.docker` +
   `loki.source.docker` + o `hostPath` do socket). Provado antes de remover:
   `up{job="docker"}` já não existia no Prometheus e o Loki só tinha 6 séries
   `job=docker`, todas de containers parados ou do `dockhand`.

4. **Timers do host**: `sync-external-endpoints.timer` desabilitado (o `MAPA`
   estava vazio, ele só rodava `docker inspect` à toa).

5. **`systemctl disable --now docker` + `docker.socket`**. Parar só o
   `docker.service` não basta: o `.socket` é *socket-activated* e ressuscita o
   daemon em qualquer conexão ao `/var/run/docker.sock`.

6. **`apt purge` + `rm -rf /var/lib/docker`** — 5 GB liberados (84G → 79G).

### O que foi preservado (nada foi perdido)

Backups em `/opt/k8s-backups/2026-10-24-pre-descomissionamento/`, todos com
integridade verificada:

| arquivo | tamanho | conteúdo |
|---|---|---|
| `data.tar.gz` | 4,8 GB | todo o `/data` (mundo do Minecraft, `.openmausbot`) |
| `vm-home.tar.gz` | 2,9 GB | os 52 repos git e scripts pessoais do `vm-home` |
| `data-minecraft-maus.tar.gz` | 1,4 GB | recorte seletivo (mundo + estado do maus) |
| `dockhand-db.tar.gz` | 3,3 MB | snapshot consistente do banco do Dockhand |
| `volume-omb-data.tar.gz` | 100 K | volume do `omb` |
| `volume-maus-caddy-*.tar.gz` | — | volumes do Caddy do maus |

**O banco do Dockhand importa**: ele guardava 37 variáveis de 3 stacks, e 23
delas **não existem com esse nome** em nenhum Secret do cluster (tokens de
Vaultwarden, `SLACK_*`, `GITHUB`-adjacent, senha do Grafana). Sem o snapshot,
essas 23 seriam perdidas no `apt purge`. Foi por isso que o snapshot veio antes.

`/opt/dockhand` (475 MB, arquivos mortos) e `/opt/stacks` (732 K, cópia
desatualizada do git) ficaram no disco na primeira rodada: o ganho de apagar é
pequeno e o risco de precisar de um deploy-log antigo não é zero.

**Atualização no mesmo dia**: decisão do usuário, apagados — mas só depois do
tar verificado. `/opt/k8s-backups/2026-10-24-pre-descomissionamento/vps-dockhand-stacks/`:
`dockhand-full.tar.gz` (199 MB, 13.615 entradas) e `stacks.tar.gz` (132 K, 111),
chmod 600/700, md5 registrados no log da sessão. O binário de 475 MB era o
pequeno demais para justificar 475 MB de provedor de nostalgia.

### O CI sem o daemon

O bloqueio real não era o `maus` — era o CI. Resolvido assim:

- **build**: `runs-on: ubuntu-24.04-arm`, runner arm64 **nativo** (grátis e
  ilimitado em repo público). Saiu o QEMU, que existia só porque o build rodava
  no daemon amd64-para-arm64.
- **push**: **túnel SSH** (`ssh -L 5000:127.0.0.1:5000` → `localhost:5000`). A
  credencial não cruza a internet em claro, e o registry deixa de precisar
  ficar aberto na `:5000` — o que fecha a armadilha 31 de graça.
- **credenciais**: do **Secret do cluster** (`registry-credentials`,
  `minio`), não do Vaultwarden. O `fetch_vault_secret.sh` fazia `docker run` na
  VPS; o cluster já é a fonte da verdade do que os pods usam.
- **deploy**: o CI grava o **digest** no manifesto e commita; o ArgoCD aplica.

Provado duas vezes com o daemon já morto (`domain-api` e `domain-worker`):
build verde → digest commitado pelo bot → pod no digest novo em ~10 s.

### O buraco que o Dockhand escondia

Vale registrar porque vai voltar à memória: **o "deploy" do CI nunca foi
deploy**. Todo manifesto fixa digest, e o webhook do Dockhand só mexe em
Docker. O CI publicava `:latest`, chamava o webhook, ficava verde, e o pod
continuava na imagem antiga — para sempre.

Medido antes de corrigir, o drift já existia:

```
tela-api  rodando   @sha256:91f313c4...
:latest   registry  @sha256:52326c1d...
```

Não era regressão da faxina; era o estado desde a migração, com o CI verde por
cima. `tela-api` continua no digest velho até alguém rodar o workflow dela (o
bump agora existe).

### Zomboid saiu também (2026-10-24)

O Project Zomboid B42 não era Docker — era família de serviços **systemd
nativos**: `zomboid-b42` (o jogo via `box64`, emulação x86_64 em ARM),
`zomboid-b42-ciopfs` (um FUSE *case-insensitive* para os mods do workshop), os
timers `zomboid-b42-watchdog` e `zomboid-b42-modupdate`, os scripts
`zomboid-watchdog.sh`/`pz-boot-retry`/`pz-modupdate` e um `DepotDownloader` de
83 MB que o modupdate usava.

Mesma regra de sempre — nada apagado antes do backup verificado:

1. **Descoberta**: `/opt/zomboid-server` (a instalação do servidor em si, que
   seria o grosso do disco) **já não existia**. Era o motivo de o
   `zomboid-b42-ciopfs` falhar com `Dependency failed` desde o reboot: o
   mountpoint dos mods tinha sumido.
2. **Backup** em
   `/opt/k8s-backups/2026-10-24-pre-descomissionamento/`: `zomboid-data.tar.gz`
   (saves e logs, 160 arquivos) e `zomboid-systemd.tar.gz` (13 arquivos: as 6
   units, `zomboid-b42.env`, os 3 scripts, `common.sh` e `pz-rcon.py`), md5
   conferido **antes** de qualquer `rm`.
3. **Ordem**: timers desligados **primeiro** (o watchdog disparava às 01:37 UTC
   e poderia ressuscitar o jogo no meio da remoção), depois services, units,
   scripts, `/etc/zomboid-b42.env`, `/opt/depotdownloader`, os dados em
   `/home/ubuntu/Zomboid`, e por fim `apt purge box64 ciopfs`.

Custo mínimo: os saves tinham 44 MB; o disco foi a 79G → depois 78G (com a
faxina do Dockhand). O cluster não sentiu: 18/18 Applications e zero pods fora
de `Running`, conferidos após o fim.

### `9router` — migrado em 2026-10-23

Corte em duas portas: o commit `23af05f` copiou o volume `ninerouter_data` para o
PVC (backup lógico `.backup` com `integrity_check ok`, mais cópia física, em
`/opt/k8s-backups/2026-10-23-2243-9router/`) e subiu o pod; o commit `b2d6887`
virou o ingress de `:20128` para o NodePort `:30028`.

O container Docker ficou de pé como rollback até **2026-10-24**, quando foi
parado e removido junto com os demais; o volume, depois de conferido o conteúdo
(mesmas pastas `auth`, `db`, `logs`, `machine-id`, `runtime` do PVC) e
backupado. **Esta sessão do agente atendeu pelo pod novo** desde o commit
`b2d6887`, o que é a prova funcional mais direta que existe aqui.

### `tela` — migrado em 2026-10-23

Os três pods (`tela-mediamtx`, `tela-coturn`, `tela-api`) rodam com
`hostNetwork: true`, replicando o `network_mode: host` do Compose. As portas do
host (8217 TCP+UDP, 3478 TCP+UDP, faixa 49160-49200 UDP, 8007) passaram dos
containers para os pods sem tocar em firewall: `hostNetwork` usa a mesma netns,
então as regras do `INPUT` que já existiam continuam valendo.

Dois achados no caminho, ambos registrados como armadilhas: o probe em
`hostNetwork` dial-a o IP do nó (32) e a persistência de salas falhava em
silêncio por falta de `fsGroup` (33). E um bug pré-existente da aplicação veio
à luz justamente porque o volume passou a funcionar (34).

**Sessão real validada em 2026-10-23**, pelo browser, através do pod:

- sala criada pelo formulário em `tela.giomartins.dev` → código
  `panela35hipopotamo`, e `rooms.json` no PVC com o registro (`65532:65532`);
- `/api/rtc/ice` devolveu credencial TURN efêmera
  (`turn:168.138.135.6:3478?transport=udp|tcp`, usuário `1792802701:tela`) —
  prova de que o pod do `coturn` assina, não o container;
- **mídia real ponta a ponta**: `canvas.captureStream()` → WebSocket
  (`tela-api`) → `whip` no MediaMTX → caminho online com 1 track VP8; um segundo
  peer assinou por `whep` e **decodificou 14 frames / 4.868 bytes em 320x180**.
  O log do MediaMTX registrou publisher e reader na mesma path.
- **persistência provada por restart de verdade**: `kubectl delete pod` no
  `tela-api`, pod novo 13 s depois, `/healthz` já voltou `{"rooms":1}` — a sala
  sobreviveu porque está no PVC, não em memória.
- roster limpa corretamente: fechar os sockets levou `people` de 2 → 0. O que
  parecia peer zumbi eram as minhas próprias conexões de teste abertas.

**PV do `tela-state` estava com `reclaimPolicy: Delete`** (o padrão do
`local-path`), sozinho entre os 13 — todos os outros já eram `Retain`. Corrigido
com `kubectl patch pv ... persistentVolumeReclaimPolicy=Retain`. Não é mudança
declarativa no manifesto: `reclaimPolicy` é campo do **PV**, criado pelo
provisioner, não do PVC. Os outros 12 foram patchados à mão pelos mesmos scripts
de cutover (`copy-volume.sh`, `namespace-cutover.sh`), e o `tela` entrou por
manifesto direto, sem passar por eles — por isso escapou. A regra vale para todo
PVC futuro: **depois que o PV fica `Bound`, conferir se é `Retain`**.


### `maus`, `minecraft` — precisam de redesenho, ou estão fora de escopo

| serviço | por que não é lift-and-shift |
| --- | --- |
| `maus` | cria containers via `docker.sock` e monta `/data` do host. Migrar isso é emular Docker dentro do Kubernetes. **Decisão do usuário em 2026-10-23: não migrar.** |
| `minecraft` | fora de escopo por decisão sua (jogo, não infra). |
| `dockhand` | é a UI do próprio Docker. Morre com ele, por definição. |

### A faxina final (só depois de observar)

Ordem deliberada, e cada passo é um commit separado:

1. ~~**parar os duplicados ociosos**~~ — **executado em 2026-10-23**, com
   `gitops/bootstrap/aposenta-duplicados.sh`. Os 9 (`adminer excalidraw grafana
   loki minio prometheus tempo db-mcp db-mcp-gateway`) foram parados com
   `docker update --restart=no` + `docker stop`. Gates do script, todos
   satisfeitos: o k8s respondia 200 pelos cinco com porta provada, e cada alvo
   tinha **zero** requisição HTTP de terceiros nas 3h anteriores. Depois disso,
   os 19 hosts do ingress seguiam respondendo pelo pod (0 problemas) e as
   Applications ficaram 18/18 `Synced`+`Healthy`.

   Os containers `competent_einstein`, `priceless_chaum` e `zen_mahavira`
   (imagens `tela-api`, criados durante os testes de cutover, bridge, sem porta
   publicada) também saíram — `docker rm -f`. Eram lixo de teste, não rollback.

   Naquele momento sobraram **8 containers rodando**, todos com motivo
   declarado: `alloy`, `dockhand`, `9router` (rollback), `maus`+`maus-caddy`+
   `maus-slack-bridge`+`omb`, `minecraft`+`minecraft-backup`. Medido logo
   depois da parada: **15.008 MB usados, 8.963 MB disponíveis**. Não há medição
   de "antes" confiável — os duplicados eram quase todos ociosos, então o ganho
   esperado é de CPU e descritores, não de RAM. (Em 2026-10-24, com a remoção,
   esses 8 viraram **6**: `alloy` e `9router` saíram, o resto é `maus`,
   `minecraft` e `dockhand`.)

2. ~~**`docker rm`** dos parados. O container parado é o rollback; remover é o
   último ato.~~ — **executado em 2026-10-24**, em três camadas, com
   `gitops/bootstrap/remove-parados.sh` (ver abaixo).
3. ~~**desligar o Docker** (`systemctl disable --now docker`).~~ — **executado
   em 2026-10-24**. Estava bloqueado pelo `maus` (`omb` monta
   `/var/run/docker.sock`) e pelo CI (buildava com `DOCKER_HOST=ssh://`). O
   usuário decidiu descomissionar o `maus` e o `minecraft` em vez de migrá-los;
   o CI foi movido para runner arm64 + túnel SSH. Daemon parado,
   `docker.socket` desabilitado e pacotes removidos. Ver "O Docker acabou".

### A remoção dos parados (2026-10-24)

Feita em camadas, cada uma verificada antes da seguinte, porque "apagar" e
"perder o rollback" são a mesma operação:

1. **Metadado backupado** (`/opt/k8s-backups/2026-10-24-0009-pre-rm-docker/`):
   `docker inspect` de todos os 40 containers, mais `images.txt` (com digests),
   `volumes.txt` e `containers.txt`. Com isso mais o `stacks/` do git, qualquer
   container volta por `docker compose --profile retired up -d`.
2. **30 containers parados removidos** por `remove-parados.sh`, que confere o
   pod **daquele** serviço (`1/1 Running`) imediatamente antes de cada remoção.
   Conferir "o namespace tem 5 pods" não provaria nada: o gate é o pod do
   serviço estar `Ready`, senão o script aborta sem remover. Sobraram rodando
   apenas os 6 que já rodavam.
3. **Build cache e imagens órfãs**: 3,3 GB + 9,1 GB + 0,65 GB liberados.
   Justificado por uma verificação, não por confiança: o `_catalog` do registry
   **pod** (12 GB, autenticado) devolve os 39 repositórios, então toda imagem
   local é re-puxável. As 7 imagens em uso por container ficaram.
4. **Volumes sem equivalente no k8s** (`intelligence-postgres-data` 77 MB,
   `opendots-*` 7 volumes, `apps_redis_data`, 5 anônimos) — backup verificado em
   `/opt/k8s-backups/2026-10-24-orfaos-docker/` antes de remover. Eram dados
   pré-migração sem dono, não resíduo do cutover.
5. **Volumes dos serviços migrados** — backup verificado (14 arquivos, 2,0 GB)
   em `/opt/k8s-backups/2026-10-24-volumes-rollback/`, depois removidos. O
   registry foi o único conferido por **conteúdo** e não por tamanho: os nomes
   dos blobs são o SHA256 deles, e `comm -23` mostrou **zero** blobs e **zero**
   manifests do volume Docker ausentes no PVC (2594 ⊂ 2604 e 4136 ⊂ 4152 — o PVC
   é superconjunto estrito, porque recebeu pushes depois do cutover).

**O resultado**: disco de 107 G → 75 G usados (56% → 39%), ou **118 GB livres**.
Nada caiu: 19/19 hosts com o mesmo status HTTP de antes, 18/18 Applications
`Synced`+`Healthy`, zero pods fora de `Running`.

**O que isso custa**: o rollback por `docker start` deixou de existir. O rollback
agora é `docker compose --profile retired up -d`, que recria o container a partir
do `stacks/` (git) e da imagem no registry (pod). É mais lento — puxa imagem em
vez de só religar — mas não depende de nada que tenha sido apagado aqui. Para os
dados, o caminho é o `.tar.gz` do backup ou o PVC, não o volume Docker.


**O que a faxina provou**: parar 9 containers não derrubou nada — 19/19 hosts com
o mesmo status HTTP, 18/18 Applications `Synced`+`Healthy`, zero pods fora de
`Running`. É o teste que faltava para dizer que os duplicados eram mesmo
duplicados, e não a instância que ainda servia.

**E o que ela quebrou, sem avisar**: a armadilha 35 nasceu aqui. O container
`vaultwarden` já estava parado desde a fatia 6, e o CI de imagens morria com
`EAI_AGAIN` desde então — ninguém tinha rodado um build para ver. Parar
containers é seguro para *portas*; não é seguro para *nomes*.


### O que ainda está em Docker: nada

Esta seção existia para listar os 6 containers que resistiam. Em 2026-10-24 eles
saíram, e com eles o próprio daemon:

| serviço | destino |
| --- | --- |
| `maus` (`omb`, `maus-caddy`, `maus-slack-bridge`) | **parado e descomissionado** (decisão do usuário). O `omb` monta `docker.sock` e cria containers — migrar seria emular Docker no k8s. Dados preservados. |
| `minecraft`, `minecraft-backup` | **parado e descomissionado** (decisão do usuário). 5 dias sem jogador, 5,4 GB de RAM. Mundo preservado em `/data` + backup. |
| `dockhand` | **parado.** UI do próprio Docker; morreu com ele. O banco (37 variáveis de 3 stacks, 23 sem equivalente no cluster) está em backup. |

Dos 3 volumes (`omb-data`, `maus-caddy-data`, `maus-caddy-config`), cada um tem
um `.tar.gz` verificado em `/opt/k8s-backups/2026-10-24-pre-descomissionamento/`
— e o `/var/lib/docker` foi removido depois deles.

**Para trazer qualquer um de volta**: `stacks/*.yml` continua no git com a trava
(`profiles: ["retired"]`). Reinstalar o Docker e rodar
`docker compose --profile retired -f stacks/<x>.yml up -d`. Não há nada de
Docker na VPS hoje, então isso é uma decisão de reinstalação, não um `start`.

### 37. `systemctl disable --now docker` não desliga o Docker.

O `docker.socket` é *socket-activated*: ele fica `active` e o próprio systemd
sobe o `docker.service` na primeira conexão a `/var/run/docker.sock`. Desabilitar
só o service devolve:

```
Disabling 'docker.service', but its triggering units are still active:
docker.socket
docker.service: inactive / disabled
docker.socket:  active / enabled
```

E o socket continua lá (`test -S /var/run/docker.sock` → SIM). Qualquer coisa
que toque nele — o timer do `sync-external-endpoints`, um `docker ps` de
curiosidade — ressuscita o daemon e os containers com `restart` voltam.

A ordem que funciona: `systemctl disable --now docker` **e**
`systemctl disable --now docker.socket`, depois `rm -f /var/run/docker.sock`.
A prova não é `systemctl is-active docker` (ele fica `inactive` nos dois casos):
é o socket não existir mais.

### 38. O CI "deployava" sem deployar, e o verde escondia.

Todo manifesto em `gitops/apps/` fixa **digest** (`image: ...@sha256:...`), o que
é a escolha certa. Mas o único passo de "deploy" do CI era um webhook para o
Dockhand, que só faz `docker compose up`. Nenhum passo escrevia o digest novo no
manifesto.

Resultado: o CI publicava `:latest`, o webhook rodava, o workflow ficava verde,
e o pod continuava na imagem antiga **para sempre**. O ArgoCD mostrava
`Synced`/`Healthy`, porque o git realmente não tinha mudado.

O drift já tinha acontecido quando medi:

```
tela-api  rodando   @sha256:91f313c4...
:latest   registry  @sha256:52326c1d...
```

A lição não é "faltou um passo": é que **"CI verde" não prova deploy quando o
deploy é provado por um sistema que não fala com o alvo**. O `docker ps` do fim
do job provava que um container subiu — e o alvo era um pod.

Correção: o build devolve o digest, o job de deploy reescreve o manifesto e
commita, o ArgoCD aplica. A prova é o pod rodando o digest novo.

### 39. O driver `docker-container` do buildx tem netns própria.

Ao mover o build para o runner e publicar por **túnel SSH**, o push falha com
`connection refused` se o BuildKit estiver no driver `docker-container`: lá
dentro `localhost:5000` é o loopback do *container* do BuildKit, não o do
runner, onde o túnel escuta. `driver-opts: network=host` resolve.

Mas não dá para simplesmente trocar para o driver `docker` embutido: ele recusa
`cache-to: type=gha` ("cache export is not supported for the docker driver"), e
o build passa a reconstruir tudo a cada push. A combinação que funciona é
`docker-container` **com** `network=host`.

### 40. Em Perl, `@sha256` dentro de string é um ARRAY.

Um `perl -pi -e "s|$app@sha256:[0-9a-f]{64}|...|"` não casa nada e **não dá
erro**: dentro de aspas duplas, `@sha256` é interpolado como array (é um nome de
array válido) e vira string vazia. O regex vira `$app:` seguido de nada, não
encontra, e o script "funciona" sem alterar o arquivo.

Precisa de `\@`. Custou um teste que parecia passar (`exit 0`) e um
`grep` mostrando o digest velho no arquivo.

### 41. O ApplicationSet usa o basename do diretório como nome da Application.

`{{ .path.basename }}` + glob `gitops/apps/*/*` significa que o nome do folder
do serviço **é** o nome da Application — na íntegra do `gitops/apps/`. Quatro
folders chamados `routes/{persistence,applications,...}` geraram quatro
Applications com o mesmo nome, e o controller recusou **todas** com
`duplicate name: routes` (o app inteiro não sobe, inclusive nada novo).
Diagnóstico visível só no `logs` do controller. Regra: basename único em todo
o `gitops/apps/` — os folders de rota se chamam `routes-<namespace>`.

### 42. O template do kubeconform rende o kind em MINÚSCULAS.

Para schemas de CRD customizados (`-schema-location
'.github/schemas/{{.Group}}_{{.ResourceKind}}.json'`), o código do kubeconform
mostra `strings.ToLower(resourceKind)` — o arquivo esperado é
`k8s.nginx.org_virtualserver.json`, não `..._VirtualServer.json`. No macOS
(APFS default *case-insensitive*) o nome capitalizado **funciona**; no CI
(ext4) lê "could not find schema" e falha o gate. Custou 3 runs de CI e a
leitura do código fonte descubrir. Os schemas dos CRDs do NIC agora seguem
gerados lowercase por `.github/scripts/kubeconform-crds.py` (source = CRD
instalado no cluster, a versão exata que o API server aceita).

### 43. O NIC valida `upstream.service` com DNS-1035 — o `Service` `9router` existe, mas o VS era rejeitado.

Um Service llamado `9router` aceita ser criado, mas o campo `service: 9river` no
VirtualServer falha na validação do CRD do NIC (DNS-1035: `must start with an
alphabetic character`). O nome do Service virou `ninerouter` (nodePort 30028
e selector intactos; o app não referenciava o nome antigo em nenhum lugar).

### 44. Localização aninhada no `location-snippets` — o único caminho pro loopback.

O `location-snippets` do VirtualServer entra DENTRO da location gerada, onde
um segundo `proxy_pass` é `duplicate directive` (`nginx -t` falha, reload
pede down). A saída: a location aninhada `location ~ ^/ {}` dentro do snippet
— intercepta 100% das requests e permite `proxy_pass` próprio (é o mecanismo
que serve o tela-api em `127.0.0.1:8007`). Provado com `return 999` antes de
produção.

## Dívidas conhecidas

1. ~~**IP do container nas pontes.**~~ **Resolvida em 2026-10-23.** Não existe
   mais nenhum Service de ponte: o último, `evolution-redis`, ganhou selector e
   o `MAPA` do timer ficou `()`. `postgres` e `vaultwarden` saíram na fatia 6,
   `alloy` e `evolution-redis` em 2026-10-23. O timer continua instalado e ativo,
   rodando a cada minuto sem tocar em nada — é a rede de segurança para um
   rollback de emergência (basta devolver a linha ao `MAPA`). Ele sai junto com o
   Docker, no fim — e o Docker só sai depois que o `maus` sair (ver o bloqueio
   acima). Verificado: **0** EndpointSlices sem `managed-by` no namespace.
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
6. ~~**O `alloy` continua em Docker, mas deixou de receber telemetria.**~~
   **Resolvido em 2026-10-24**: o container foi parado em 2026-10-23 e removido
   junto com os outros parados. Sobrou um único pipeline (`alloy-logs`, no pod),
   então os logs dos containers deixaram de ser ingeridos duas vezes. O
   `discovery.docker` que não alcançava a API do k3s deixou de existir junto.
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
   do Docker resolvia `minio` para o container (que existia como rollback), e
   não enxerga Services do cluster. O CI de frontend foi ajustado para
   `http://172.18.0.1:30900`; qualquer outro `docker run` que precise de S3 terá
   o mesmo problema e precisa do mesmo endereço explícito. Desde 2026-10-24 o
   container `minio` não existe mais: o nome simplesmente não resolve, então o
   endereço explícito deixou de ser preferência e passou a ser obrigatório.

   **O caso do `vaultwarden` é a versão pior do mesmo problema** e virou a
   armadilha 35: lá o container foi **parado**, então o nome deixou de existir
   no DNS em vez de resolver para o lado errado. Consertado em 2026-10-23 com
   `VAULTWARDEN_UPSTREAM` + NodePort. A regra geral que sobra: **todo
   `docker run` que fala com um serviço migrado precisa de endereço explícito**
   — `172.18.0.1:<nodePort>` ou `host.docker.internal:<nodePort>` com
   `--add-host`. Nome de serviço não é endereço.
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
   ficou de pé como rollback até 2026-10-24, quando o container foi removido.
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
    O container `minio` ficou de pé como rollback até **2026-10-24**, quando foi
   removido; os dados de 28/09 foram copiados para o PVC (8 buckets idênticos) e
   os antigos, perdidos só na aparência — o PVC tem o estado vivo.

    **Atualização 2026-10-23 (faxina)**: o container foi **parado**. Ele era o
    último caminho para os dados de 28/09; o rollback completo do minio dependia
    de `docker start minio` — que valia até o dia seguinte. Ver armadilha 35
    para o efeito colateral de parar containers cujo *nome* outros scripts usam.

    **Atualização 2026-10-24 (descomissionamento)**: o container foi removido e
    o daemon desinstalado. Os dados de 28/09 só existem agora em
    `/opt/k8s-backups/2026-10-24-volumes-rollback/apps_minio_data.tar.gz`. Esta
    dívida está **encerrada**: não há mais o que reverter.

18. ~~**O CI de imagens estava cego desde a fatia 6.**~~ **Resolvido em
    2026-10-23** (commit `1d9a103`). Nenhuma imagem nova era publicada: o passo
    "Fetch registry credentials from Vaultwarden" morria com
    `getaddrinfo EAI_AGAIN vaultwarden` porque o proxy do `bw` apontava para o
    nome na rede Docker `apps`, e esse nome saiu do DNS quando o container foi
    parado no cutover da fatia 6. O `fetch_vault_secret.sh` ganhou
    `VAULTWARDEN_UPSTREAM` (default `vaultwarden:80`, então nada quebra em
    rollback) e os 6 workflows passaram a usar
    `host.docker.internal:30822` — o NodePort do Service `vaultwarden` em
    `persistence`, que é estável. Detalhe completo na armadilha 35.

    **O que isso ensina sobre detecção**: o pipeline falhava no *primeiro* passo,
    antes de qualquer build, por quase um dia inteiro. Nada no cluster mostrou
    isso — as Applications seguiam `Synced`, os pods `Running`. Só apareceu
    quando alguém tentou publicar uma imagem. **Um sinal que só existe quando o
    caminho é exercitado não é monitoramento.** Se o CI importa, ele precisa
    rodar (ou ter um health check próprio) mesmo sem push.
19. **`project-infra` não tem mais nenhum serviço vivo, e o `auto_update` dele
    continua ligado.** Depois da faxina de 2026-10-24, todos os 18 serviços de
    `project-infra` estão em `profiles: ["retired"]`. O comando do Dockhand
    termina com `no service selected` e **exit 1** — que é o comportamento
    correto do Compose (nada a fazer), mas o Dockhand pode registrar a execução
    como falha. Não apaga nada, não sobe nada; o risco é só um alarme falso
    diário e a tentação de "consertar" mexendo em quem não devia.

    **Como fechar**, quando o primeiro `auto_update` real rodar (03:00 UTC):
    olhar `schedule_executions` no banco do Dockhand para a stack 21. Se vier
    `success`, não há nada a fazer. Se vier `failed`, desligar o `auto_update`
    da stack 21 — que é mudança de configuração, não de código, e não toca em
    container nenhum. A alternativa (manter um serviço "vivo" só para o comando
    não ficar vazio) é pior: ressuscitaria algo migrado.
20. ~~**O gate de `profiles` estava cego justamente onde importava.**~~
    **Resolvido em 2026-10-24.** O `checa-profiles.sh` varria `stacks/*.yml`
    inteiro, então via serviços de arquivos que **nenhuma stack inclui**
    (`ai.yml`), e ao mesmo tempo não seguia os `include:` — que é como
    `project-infra.yml` e `project-apps.yml` realmente montam o projeto. Dois
    efeitos opostos: `9router`/`decision` apareciam na saída como se fossem
    subir (e passavam pela whitelist, mascarando o caso), enquanto os arquivos
    incluídos nunca eram conferidos um a um.

    Agora o script parte dos quatro `compose_path` que o Dockhand executa
    (`project-infra`, `project-apps`, `minecraft`, `core`) e resolve `include:`
    recursivamente. Provado com regressão plantada: tirar a trava do
    `9router` em `compute.yml` faz o gate sair 1 apontando o serviço. E a
    saída hoje lista um só: `dockhand`. (Em 2026-10-24 ele deixou de subir
    também, com o `apt purge`.)
21. ~~**`project-infra`/`project-apps` sem serviço vivo e o `auto_update`
    ligado.**~~ **Resolvida de outro jeito, em 2026-10-24**: o `dockhand` foi
    desinstalado junto com o daemon, então não existe mais `crash`/`auto_update`
    às 03:00 UTC para dar falso alarme. A dívida deixou de ter onde acontecer.
22. ~~**`tela-api` roda um digest mais velho que o `:latest` do registry.**~~
    **Resolvida em 2026-10-24**: um `workflow_dispatch` manual do `go-ci-cd`
    (input `app=tela-api`, run 40052213763) buildou, commitou o digest e o
    ArgoCD aplicou no ciclo seguinte — pod em
    `@sha256:62c7c095...`, `Running`, e a API respondendo (`404` na raiz, o
    comportamento normal dela). Prova de fim a fim do loop novo do CI num app
    que nunca passou por ele.
23. **`excalidraw` usa tag fixa (`v0.18.1`), não digest.** É de propósito (a
    versão é escolhida por input do workflow, e o manifesto é a decisão
    explícita de qual roda), mas viola o "contrato de imagem" do resto do repo e
    fica fora do gate que proíbe `:latest` — uma tag mutável passaria. A
    alternativa (digest + input) exige decidir o que "escolher versão" significa
    no GitOps. Registrado, não decidido.
24. **O firewall de `INPUT` do host está desligado desde o reboot de
    2026-10-24 — e a paralisação foi deliberada.** O `rules.v4` antigo tinha um
    ruleset de verdade: ACCEPT de icmp/lo/22/80/443 e **REJECT no final** para
    todo o resto. Como o `netfilter-persistent` falhou no boot (armadilha 31, o
    capítulo "quase reverteu"), o kernel vem rodando com `INPUT ACCEPT`
    **totalmente aberto** — o que protege a VPS hoje é só Security List da OCI.
    O `raw/PREROUTING` (5000/80xx) foi reaplicado porque não toca caminho
    nenhum do k8s; o firewall de INPUT inteiro é outro nível: sem um teste
    com o k3s de pé, restaurar o REJECT pode quebrar pod→node (scrapes do
    Prometheus no kubelet, fluxos que atravessam `INPUT` com dst do host) e o
    `-A FORWARD -j REJECT` depende da ordem de inserção do kube-proxy, que
    recolocar as regras dele no boot. **Falta decidir** (exige uma janela em
    que reboot/teste sejam combinados, pós o trauma de 2026-10-24): (a) desenhar
    o ruleset sabendo do k8s (p/ex. ACCEPT explícito para lo + ranges do
    cluster 10.42.0.0/16 e 10.43.0.0/16 + 22/80/443, REJECT no final) e provar
    com reboot agendado, ou (b) assumir a Security List da OCI como único
    firewall e registrar a decisão no README. Enquanto isso, o vetor que
    importava (registry na 5000) já está fechado na `raw` — que, agora, também
    sobrevive ao boot: o arquivo persistido só guarda regra própria (dívida
    resolvida em 31).

