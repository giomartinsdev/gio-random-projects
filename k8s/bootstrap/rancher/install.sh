#!/bin/bash
# install.sh — instala/atualiza o Rancher de forma idempotente.
#
# ## Por que um script e não só o `helm install` colado no README
#
# O comando de instalação existia apenas em `/tmp/rancher-values.yaml` no host.
# Um `helm install` digitado à mão não é reproduzível: se o nó for recriado,
# ninguém sabe qual versão, quais valores, nem qual senha foi usada. Aqui os
# valores são versionados e a instalação vira consequência do repositório —
# o mesmo tratamento que o `argocd-cm` recebeu.
#
# ## Por que a senha NÃO fica no repositório
#
# Este repositório é público. A senha de bootstrap é gerada aqui, na primeira
# execução, e gravada em `/root/.rancher-bootstrap-password` (mode 600). O
# `helm` a recebe por variável, nunca por arquivo versionado.
#
# ## Idempotência
#
# Rodar duas vezes seguidas: na segunda, o `helm upgrade` reaplica os mesmos
# valores e a senha existente é reaproveitada (não há rotação silenciosa de
# credencial a cada bootstrap, o que quebraria um login em andamento).
set -uo pipefail

NS="cattle-system"
RELEASE="rancher"
VERSAO="2.15.2"
REPO_URL="https://releases.rancher.com/server-charts/stable"
REPO_NOME="rancher-stable"
VALORES="$(dirname "$0")/values.yaml"
SENHA_ARQUIVO="/root/.rancher-bootstrap-password"

# O chart NÃO expõe nodePort em values: ele declara as portas 80/443 sem
# `nodePort` e deixa o k8s sortear. Sortear é aceitável uma vez, mas torna o
# comando de túnel documentado uma mentira depois de qualquer reinstall. Estes
# dois números são fixados por patch logo após o install (ver abaixo) e
# documentados no README.
NODEPORT_HTTP="31198"
NODEPORT_HTTPS="31844"

if [ ! -f "$VALORES" ]; then
  echo "erro: $VALORES não encontrado" >&2
  exit 1
fi

# O `helm` não conhece o kubeconfig do k3s (que é 600 e vive em
# /etc/rancher/k3s/k3s.yaml). Sem isto o script só funcionaria por acidente,
# se alguém já tivesse copiado o arquivo para /root/.kube/config à mão.
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

if ! command -v helm >/dev/null 2>&1; then
  echo "erro: helm não está instalado (o Rancher exige Helm v3)" >&2
  exit 1
fi

# --- senha de bootstrap -----------------------------------------------------
# Só gera se ainda não existe. `openssl rand -base64 24` dá 32 caracteres.
if sudo test -s "$SENHA_ARQUIVO"; then
  echo "[ok] senha de bootstrap já existe (não será rotacionada)"
else
  echo "[gen] gerando senha de bootstrap"
  P=$(openssl rand -base64 24 | tr -d '\n')
  printf '%s' "$P" | sudo tee "$SENHA_ARQUIVO" >/dev/null
  sudo chmod 600 "$SENHA_ARQUIVO"
fi
SENHA=$(sudo cat "$SENHA_ARQUIVO")

# --- repositório ------------------------------------------------------------
if ! helm repo list 2>/dev/null | awk '{print $1}' | grep -qx "$REPO_NOME"; then
  echo "[repo] adicionando $REPO_NOME"
  helm repo add "$REPO_NOME" "$REPO_URL" >/dev/null
fi
helm repo update >/dev/null

# --- namespace --------------------------------------------------------------
if ! k3s kubectl get ns "$NS" >/dev/null 2>&1; then
  echo "[ns] criando $NS"
  k3s kubectl create namespace "$NS" >/dev/null
fi

# --- install ou upgrade -----------------------------------------------------
# `helm upgrade --install` cobre os dois casos. A senha vai por `--set` para
# não ser escrita em disco no repositório; no cluster ela termina em
# `cattle-system/bootstrap-secret`, que é onde o Rancher a lê.
if helm status "$RELEASE" -n "$NS" >/dev/null 2>&1; then
  echo "[upgrade] $RELEASE já existe — reaplicando valores"
  ACAO="upgrade"
else
  echo "[install] instalando $RELEASE $VERSAO"
  ACAO="install"
fi

helm "$ACAO" "$RELEASE" "$REPO_NOME/rancher" \
  --version "$VERSAO" \
  --namespace "$NS" \
  -f "$VALORES" \
  --set bootstrapPassword="$SENHA" \
  --timeout 10m >/dev/null || {
    echo "erro: helm $ACAO falhou" >&2
    exit 1
  }

# --- espera -----------------------------------------------------------------
# O `helm install` retorna quando os objetos foram criados, não quando o pod
# serve. Sem esta espera, o próximo passo do bootstrap falha por corrida.
echo "[wait] aguardando o Deployment ficar disponível"
k3s kubectl rollout status "deploy/$RELEASE" -n "$NS" --timeout=300s >/dev/null || {
  echo "erro: o pod do Rancher não ficou Ready" >&2
  exit 1
}

# --- NodePorts fixos --------------------------------------------------------
# O patch usa JSON Patch, que é posicional: por isso os índices são descobertos
# pelos nomes `http`/`https` em vez de assumir 0 e 1. Se o chart reordenar as
# portas num upgrade futuro, índice fixo trocaria a porta errada — e o túnel
# documentado apontaria para o serviço errado.
PORTA_HTTP_IDX=$(k3s kubectl get svc "$RELEASE" -n "$NS" -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' 2>/dev/null | grep -nx "http" | cut -d: -f1)
PORTA_HTTPS_IDX=$(k3s kubectl get svc "$RELEASE" -n "$NS" -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' 2>/dev/null | grep -nx "https" | cut -d: -f1)

if [ -z "$PORTA_HTTP_IDX" ] || [ -z "$PORTA_HTTPS_IDX" ]; then
  echo "erro: o Service não tem as portas nomeadas http/https" >&2
  exit 1
fi

ATUAL_HTTP=$(k3s kubectl get svc "$RELEASE" -n "$NS" -o jsonpath="{.spec.ports[$((PORTA_HTTP_IDX-1))].nodePort}" 2>/dev/null)
ATUAL_HTTPS=$(k3s kubectl get svc "$RELEASE" -n "$NS" -o jsonpath="{.spec.ports[$((PORTA_HTTPS_IDX-1))].nodePort}" 2>/dev/null)

if [ "$ATUAL_HTTP" != "$NODEPORT_HTTP" ] || [ "$ATUAL_HTTPS" != "$NODEPORT_HTTPS" ]; then
  echo "[port] fixando NodePorts em $NODEPORT_HTTP/$NODEPORT_HTTPS (estavam $ATUAL_HTTP/$ATUAL_HTTPS)"
  k3s kubectl patch svc "$RELEASE" -n "$NS" --type=json -p "[
    {\"op\":\"replace\",\"path\":\"/spec/ports/$((PORTA_HTTP_IDX-1))/nodePort\",\"value\":$NODEPORT_HTTP},
    {\"op\":\"replace\",\"path\":\"/spec/ports/$((PORTA_HTTPS_IDX-1))/nodePort\",\"value\":$NODEPORT_HTTPS}
  ]" >/dev/null || {
    echo "erro: não foi possível fixar os NodePorts (colisão?)" >&2
    exit 1
  }
else
  echo "[port] NodePorts já fixos em $NODEPORT_HTTP/$NODEPORT_HTTPS"
fi

echo "[ok] Rancher $VERSAO no ar"
echo "     senha de bootstrap: sudo cat $SENHA_ARQUIVO"
echo "     acesso: ssh -N -L $NODEPORT_HTTPS:127.0.0.1:$NODEPORT_HTTPS ubuntu@<host>"
