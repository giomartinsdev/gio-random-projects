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

## Duas armadilhas que custam horas

### 1. Pods não alcançam a rede Docker

A política `FORWARD` do iptables é **`DROP`** (o k3s muda isso ao instalar).
Consequência: de dentro de um pod, `172.18.0.16:5432` (postgres) e
`172.18.0.1:5432` (gateway da bridge) dão **timeout** — embora o *host*
alcance o postgres normalmente. Isso vale para **qualquer** serviço que
migre e ainda precise falar com o que ficou em Compose.

Solução: `Service` sem selector + `EndpointSlice` apontando para o IP do
container. O kube-proxy faz DNAT na saída do pod, e o pacote passa por
`KUBE-SERVICES` em vez de `FORWARD`. Ver `gitops/apps/adminer/deployment.yaml`.

### 2. ArgoCD exclui EndpointSlice por padrão

O `argocd-cm` traz `Endpoints` e `EndpointSlice` em `resource.exclusions`
(recursos que o control plane recria sozinho). Efeito perverso: o `Service`
sobe, o `EndpointSlice` **não**, e as conexões caem em `connection refused`
— enquanto os 3 recursos aparecem **`Synced`/`Healthy`** no painel. Nenhum
erro visível.

Correção aplicada (remover só o bloco que exclui esses dois kinds):

```bash
sudo k3s kubectl get cm argocd-cm -n argocd -o jsonpath='{.data.resource\.exclusions}' > /tmp/excl.yaml
# edite removendo o bloco com "EndpointSlice" e "Endpoints"
sudo k3s kubectl patch cm argocd-cm -n argocd --type merge \
  -p "$(python3 -c 'import json;print(json.dumps({"data":{"resource.exclusions":open("/tmp/excl-new.yaml").read()}}))')"
sudo k3s kubectl rollout restart deploy/argocd-server deploy/argocd-repo-server \
  deploy/argocd-applicationset-controller -n argocd
sudo k3s kubectl rollout restart statefulset/argocd-application-controller -n argocd
```

Isso é **dívida**: o `argocd-cm` não está versionado. Se o ArgoCD for
reinstalado, a exclusão volta e o adminer quebra em silêncio. O caminho é
levar esse patch para `gitops/bootstrap/`.

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

Verificado em 2026-10-23, depois do bootstrap:

| serviço | Docker | k8s | tráfego |
| --- | --- | --- | --- |
| `excalidraw` | rodando | **rodando** (NodePort 30023, `Synced/Healthy`) | ainda no Docker (`draw.giomartins.dev` → `:8023`) |
| `adminer` | rodando | **rodando** (NodePort 30092, `Synced/Healthy`) | ainda no Docker (`adminer.giomartins.dev` → `:8092`) |
| demais 31 containers | rodando | — | Docker |
| 20 domínios do ingress | — | — | idênticos antes/depois (mesmo status HTTP) |

Plataforma no cluster: k3s, ArgoCD, ingress-nginx (NodePort), cert-manager,
metrics-server, Kubero (operator + UI em NodePort 30200).

Recursos: k3s + ArgoCD + ingress-nginx + cert-manager + Kubero ≈ 1,3 GB de
RAM. Sobram ~10 GB. Nenhuma porta do host foi disputada — o cluster usa
6443 (API), 10250 (kubelet), 8472 (VXLAN) e NodePorts em `30000-32767`.

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
- **Zero regressão**: 20/20 domínios com o mesmo status HTTP antes, depois
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

Depois de `adminer` (que estreou a ponte com o Docker via EndpointSlice), os
candidatos naturais são os stateless com tráfego (`hub`, `maus`, `9router`),
e só então os stateful.
