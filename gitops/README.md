# gitops/

O plano de controle declarativo do cluster, paralelo ao `stacks/` do
Docker Compose. **Nada aqui está em produção ainda**: os dois mundos
rodam lado a lado na mesma VPS, e a migração é serviço a serviço.

```
gitops/
  bootstrap/appset.yaml        # o ÚNICO manifesto aplicado à mão, 1x por cluster
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

# 5. o único apply manual do GitOps
sudo k3s kubectl apply -f gitops/bootstrap/appset.yaml
```

Do passo 5 em diante, **nada mais é `kubectl apply`**: adicionar uma
pasta em `gitops/apps/` cria o Application sozinho.

### Acessar o ArgoCD

Ele não tem Ingress (a 80 é do nginx). O acesso é por túnel SSH:

```bash
ssh -L 8088:127.0.0.1:8080 ubuntu@168.138.135.6 \
  'sudo k3s kubectl -n argocd port-forward svc/argocd-server 8080:443'
# depois: https://localhost:8088  (usuário: admin)
```

Senha inicial:

```bash
sudo k3s kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
```

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
| demais 32 containers | rodando | — | Docker |
| 20 domínios do ingress | — | — | idênticos antes/depois (mesmo status HTTP) |

Recursos: k3s + ArgoCD ≈ 700 MB de RAM. Sobram ~11 GB. Nenhuma porta
existente foi disputada — o cluster usa 6443 (API), 10250 (kubelet),
8472 (VXLAN) e o NodePort 30023.

### O que foi provado, não assumido

- **Pull do registry privado**: pod puxou `excalidraw` em 1,4 s pelo mirror
  `127.0.0.1:5000` com `imagePullSecret`.
- **Conteúdo idêntico**: `:30023` e `:8023` devolvem 6605 bytes e o mesmo
  `<title>`.
- **`selfHeal`**: `kubectl scale --replicas=2` à mão foi revertido para 1
  sozinho.
- **git → cluster**: mudar `replicas` para 2 no git e dar push fez o
  cluster subir a segunda réplica sem nenhum `kubectl`.
- **Zero regressão**: 20/20 domínios com o mesmo status HTTP antes, depois
  e após reiniciar o k3s.

## Próximo serviço a migrar

`adminer` é o candidato seguinte: stateless, sem volume, e quase ninguém
usa — se cair por alguns minutos, o custo é ~zero. Depois dele, os
stateless com tráfego (`excalidraw` de fato, `hub`, `maus`), e só então os
stateful.
