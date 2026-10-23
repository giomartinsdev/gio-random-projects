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
| `vaultwarden` | rodando | manifesto, **`replicas: 0`** | Docker (`vault` → `:8222`) |
| `9router` | rodando | manifesto, **`replicas: 0`** | Docker (`ai` → `:20128`) — **exige parada** |
| `minio` | rodando (rollback) | **rodando** (NodePort 30900/30901) | **k8s** — 8 buckets idênticos, 3 SPAs ✅ |
| `rabbitmq` | rodando (rollback) | **rodando** (NodePort 31525/30672) | **k8s** — 29 filas, 12 exchanges, 62 bindings idênticos ✅ |
| `prometheus` | rodando | **rodando** (ClusterIP:9090) | **k8s** — 898M copiados, 8.841 séries ✅ |
| `loki` | rodando | **rodando** (ClusterIP:3100) | **k8s** — 976M copiados ✅ |
| `tempo` | rodando | **rodando** (ClusterIP:3200) | **k8s** — 308M copiados ✅ |
| `grafana` | rodando (ocioso) | **rodando** (NodePort 30300) | **k8s** — `grafana` → `:30300` ✅ |
| `alloy` | rodando | **não migrável** (docker.sock) | Docker — e `alloy-logs` no cluster cobre os pods |
| demais 23 containers | rodando | — | Docker |
| 20 domínios do ingress | — | — | idênticos antes/depois (mesmo status HTTP) |

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

Quatro `Service` sem selector, ligados por `EndpointSlice` aos containers Docker
que ainda não migraram. Eram sete; `minio` migrou na fatia 5 e `rabbitmq` em
2026-10-23 (viraram Services com selector em `gitops/apps/<app>/`). Os nomes são **idênticos aos do Compose** — é o que
permite migrar um consumidor sem tocar em nenhuma env var:

| Service | container | porta |
| --- | --- | --- |
| `postgres` | postgres | 5432 |
| `alloy` | alloy | 4318 |
| `evolution-api` | evolution-api | 8080 |
| `evolution-redis` | evolution-redis | 6379 |
| `vaultwarden` | vaultwarden | 80 |

Morrem quando os dados migrarem (fatia 6): aí o `Service` ganha `selector` e o
`EndpointSlice` manual deixa de existir.

**`rabbitmq` saiu desta lista em 2026-10-23**, e o motivo de ter sido o último
está em `gitops/apps/rabbitmq/deployment.yaml`: um broker é ponto de encontro
compartilhado, e cortá-lo com qualquer consumidor ainda em Docker cria dois
brokers com zero estado compartilhado, sem erro em log nenhum.

**Exceção deliberada: `rabbitmq`.** Ele tem manifesto pronto com `replicas: 0` e
**sem** `service.yaml`, porque um broker só pode ser cortado quando todos os
publishers e consumers estiverem do mesmo lado. Ver
`gitops/apps/rabbitmq/deployment.yaml` para a lista medida de quem está onde.

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
| 30900 | minio s3 |
| 30901 | minio console |
| 30945 | ingress-nginx (http) |
| 31198 | rancher (http, redireciona para 443) |
| 31525 | rabbitmq amqp (NodePort automático) |
| 31844 | rancher (https) |

`30028` está reservado pelo Service do `9router` mesmo sem pod: um Service
`NodePort` existe independente de ter endpoint. Reservar antes é de propósito —
quem for escolher a próxima porta vê o número ocupado e não planeja em cima dele.

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

### `ingress-nginx` está fora de suporte (dívida consciente)

`ingress-nginx` foi **aposentado em março/2026**; este ambiente é outubro/2026.
O próprio chart do Rancher registra isso (`includeDefaultExtraAnnotations` está
deprecado "due to ingress-nginx retiring in March 2026") e a seção de EOL do
projeto recomenda migrar para Gateway API ou outro controller.

Estado aqui, medido: **zero `Ingress` objects no cluster**. O controller roda
com NodePort `30945`/`30421` e não serve nenhum tráfego. Quem serve os 18 hosts
é o nginx do **host** (`nginx:1.27-alpine`, `network_mode: host`, porta 80), que
não é `ingress-nginx` e não é afetado por esse EOL.

Decisão registrada em 2026-10-23: **não mexer agora**. Removê-lo liberaria RAM e
um webhook, mas o Kubero foi instalado assumindo um ingress controller
(armadilha 3) e a troca por Traefik/Gateway API afeta o roteamento dos 18 hosts
— é migração própria, não faxina. Fica como dívida, com a data visível.

## Próximo serviço a migrar

A fatia 4 está fechada: os quatro backends servem do cluster com o histórico
real, e o buraco de observabilidade que ela escancarou está fechado também.

O que foi feito, em ordem:

1. **Coletor de logs no cluster** (`alloy-logs`): `loki.source.kubernetes` para
   os pods + `loki.source.docker` (via `hostPath: docker.sock`) para o que ainda
   está em Docker. Foi o passo que revelou que o alloy em Docker **não alcança**
   a API do k3s (`172.18.0.1:6443` → connection refused), então rodar como pod
   não é preferência, é a única opção.
2. **Volumes copiados** com o container parado e religado antes do pod subir:
   898M / 976M / 308M / 50M, tamanhos idênticos à origem.
3. **Grafana** virou para `:30300`. Paridade provada por estado, não por tela:
   1 dashboard e 1 usuário nos dois lados, `version 12.4.3 commit 86c83248`
   iguais nos dois — e um request marcado apareceu 1× no pod, 0× no Docker.

Ordem daqui pra frente:

1. **Fatia 6** (`postgres`, `vaultwarden`): janela, backup verificado,
   rollback alto. É o último bloqueio grande.
2. **`9router`** (fatia 2): provisionado, `replicas: 0`. Exige parada por causa
   do SQLite com WAL — ver o procedimento escrito no topo de
   `gitops/apps/9router/deployment.yaml`. **Não é migrável pelo agente sem
   aceitar o risco**: ele serve a própria sessão que faria a migração.
3. **`evolution-redis`**: ainda é ponte. Não é cache descartável — guarda o
   estado Baileys da sessão do WhatsApp (2M, AOF + RDB). Migra com o mesmo
   cuidado de um banco, não como cache.
4. **`tela-*`** por último: `hostNetwork` + UDP (coturn/mediamtx).

### O que ainda está em Docker e por quê

Não é pendência esquecida, é ordem deliberada:

| serviço | o que falta |
| --- | --- |
| `postgres` | fatia 6 — 332M de dump, é o banco de tudo |
| `vaultwarden` | fatia 6 — senha do cofre, SQLite |
| `9router` | parada obrigatória (WAL) + é a porta de IA do host |
| `evolution-redis` | guarda a sessão Baileys; migra como banco, não como cache |
| `tela-*` | `hostNetwork` + UDP (coturn, mediamtx) |
| `maus` | `docker.sock` + `/data` do host; exige redesenho |
| `alloy` | não alcança a API do k3s; `alloy-logs` cobre os pods |
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

1. **IP do container nas pontes.** O `EndpointSlice` manual carrega o IP do
   container Docker. Mitigado pelo `sync-external-endpoints.timer` (1 min),
   mas o timer é um processo no host, fora do GitOps. Morre com as fatias 5/6.
2. ~~Patch do `argocd-cm` não versionado.~~ **Resolvido** em
   `gitops/bootstrap/argocd/` — lista versionada + script idempotente. Ainda é
   um passo manual no bootstrap, mas não depende mais de memória.
3. **O timer e o `sync-app-secrets.sh` não são declarativos.** São scripts
   instalados à mão em `/usr/local/sbin`. Funcionam e são idempotentes, mas não
   são reconciliados por nada — se a máquina for recriada, alguém precisa
   lembrar de rodá-los. O `bootstrap.sh` do repositório deve cobrir isso.
4. **`vaultwarden` aparece como `Progressing` no ArgoCD.** Deployment com
   `replicas: 0` nunca reporta `AvailableReplicas`, então o health check fica
   inconclusivo para sempre. Cosmético, mas ruído no painel.
5. ~~**Os pods migrados não têm log no Loki.**~~ **Resolvido** — o coletor
   `alloy-logs` roda no cluster e cobre os pods (`loki.source.kubernetes`) e o
   que resta em Docker (`loki.source.docker` via `hostPath`).
6. **O `alloy` continua em Docker, e continua sendo necessário.** Ele monta
   `docker.sock` e usa `discovery.docker` + `loki.source.docker`, e não alcança
   a API do k3s de dentro do container (`172.18.0.1:6443` → refused). Sai
   quando o último container sair. Enquanto isso, dois coletores coexistem: é
   dívida com prazo, não desenho final.
7. **`domain.events.queue` com 585 mensagens e 0 consumidores.** O consumidor
   previsto (`events-announcer`) nunca existiu como container neste host.
   Pré-existente, não tocado: mexer em fila de produção sem entender o efeito
   não é migração.
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
