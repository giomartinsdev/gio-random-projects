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

### 5. O DNS do Docker sombreia o Service do k8s

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
```

Do passo 5 em diante, **nada mais é `kubectl apply`**: adicionar uma
pasta em `gitops/apps/` cria o Application sozinho.

O passo 3 do `install.yaml` e o passo 5 (`argocd-server-nodeport.yaml`) são
os únicos manifestos de plataforma. Para reaplicar do zero num cluster novo,
a ordem é: k3s → registries.yaml → namespace argocd → install.yaml →
namespace giomartins + secret → `server.insecure=true` no
`argocd-cmd-params-cm` → rollout do `argocd-server` → os dois YAMLs de
`bootstrap/`.

### Acessar o ArgoCD

**A tela do cluster é o próprio ArgoCD** — não há uma UI separada de
Kubernetes para instalar. Ele mostra os Applications, a árvore de recursos
(Deployment → ReplicaSet → Pod → Service), diff contra o git, logs, eventos e
o botão de sync.

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

Recomendação: **ArgoCD para estado de deploy + `k9s` para operação**. O k9s
usa o kubeconfig (copie `/etc/rancher/k3s/k3s.yaml`, troque
`server: https://127.0.0.1:6443` pelo IP e acesse por túnel na 6443); o plano
de controle está em `127.0.0.1:6443` e a security list já bloqueia de fora.

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
| demais 23 containers | rodando | — | Docker |
| 20 domínios do ingress | — | — | idênticos antes/depois (mesmo status HTTP) |

`replicas: 0` não é esquecimento: são consumidores de fila ou donos de volume
com escrita exclusiva. Rodar dois ao mesmo tempo duplica mensagem ou corrompe
dado. Subir para 1 *é* o ato de migrar, e exige parar o Docker antes.

Plataforma no cluster: k3s, ArgoCD, ingress-nginx (NodePort), cert-manager,
metrics-server, Kubero (operator + UI em NodePort 30200).

Recursos: k3s + ArgoCD + ingress-nginx + cert-manager + Kubero ≈ 1,3 GB de
RAM. Sobram ~10 GB. Nenhuma porta do host foi disputada — o cluster usa
6443 (API), 10250 (kubelet), 8472 (VXLAN) e NodePorts em `30000-32767`.

### Serviços de ponte (`gitops/apps/bridges/`)

Sete `Service` sem selector, ligados por `EndpointSlice` aos containers Docker
que ainda não migraram. Os nomes são **idênticos aos do Compose** — é o que
permite migrar um consumidor sem tocar em nenhuma env var:

| Service | container | porta |
| --- | --- | --- |
| `postgres` | postgres | 5432 |
| `rabbitmq` | rabbitmq | 5672 |
| `minio` | minio | 9000 |
| `alloy` | alloy | 4318 |
| `evolution-api` | evolution-api | 8080 |
| `evolution-redis` | evolution-redis | 6379 |
| `vaultwarden` | vaultwarden | 80 |

Morrem quando os dados migrarem (fatias 5 e 6): aí o `Service` ganha
`selector` e o `EndpointSlice` manual deixa de existir.

### NodePorts ocupados

| NodePort | serviço |
| --- | --- |
| 30023 | excalidraw |
| 30080 | argocd-server |
| 30092 | adminer |
| 30200 | kubero |
| 30421 | ingress-nginx (https) |
| 30945 | ingress-nginx (http) |

### O que foi provado, não assumido

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

## Próximo serviço a migrar

O `adminer` é o **primeiro serviço com tráfego real no cluster** — o
`adminer.giomartins.dev` sai do pod, não do container. É a prova de que o
caminho inteiro (ingress → NodePort → pod → Service → EndpointSlice → Docker)
funciona em produção, não só em teste.

Próximos passos, em ordem:

1. **Observar o adminer** por um período antes de desligar o container. O
   Docker ficar rodando e ocioso é o rollback; não custa nada.
2. **`draw.giomartins.dev` (excalidraw)** — mesmo movimento, já validado. É o
   segundo cutover e confirma que o padrão se repete.
3. **`domain.giomartins.dev`** — primeiro cutover de uma API com dependência de
   banco. Mais arriscado, porque um erro aparece como 5xx para o cliente, não
   como página em branco.
4. Só então as fatias 4, 5 e 6 do `MIGRATION.md`.

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
5. **`argocd-cm` sem `resource.exclusions` é estado do cluster, não do git** —
   o mesmo item 2 visto pelo outro lado.
