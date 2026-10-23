#!/bin/bash
# apply-resource-exclusions.sh — aplica a lista de exclusões do ArgoCD sem
# EndpointSlice/Endpoints.
#
# ## Por que um script e não um `kubectl apply`
#
# O `argocd-cm` tem outras chaves que não são nossas e não estão versionadas
# (`url`, `server.insecure`, `timeout.reconciliation`, ...). Aplicar o
# ConfigMap inteiro apagaria essas chaves e mudaria comportamento do ArgoCD
# fora do escopo desta correção.
#
# Aqui é patch de UMA chave, com a lista lida de um arquivo versionado. O
# arquivo é a fonte da verdade; o cluster é consequência.
#
# ## Por que reiniciar componentes
#
# O `argocd-cm` é lido no boot dos componentes, não recarregado a quente. Sem o
# restart, o patch fica aplicado mas sem efeito — o que é pior que não aplicar,
# porque parece resolvido.
#
# ## Idempotência
#
# Rodar duas vezes seguidas não faz nada na segunda além de reaplicar o mesmo
# patch. Detectar "mudou" evita restart desnecessário do ArgoCD a cada execução
# do bootstrap.
set -uo pipefail

NS="argocd"
CM="argocd-cm"
ARQUIVO="$(dirname "$0")/resource-exclusions.yaml"

if [ ! -f "$ARQUIVO" ]; then
  echo "erro: $ARQUIVO não encontrado" >&2
  exit 1
fi

# O conteúdo vai como JSON string para o patch; python3 faz o escape em vez de
# tentar montar JSON com heredoc e aspas aninhadas.
novo=$(python3 -c "import json,sys; print(json.dumps(open(sys.argv[1]).read()))" "$ARQUIVO")

atual=$(k3s kubectl get cm "$CM" -n "$NS" -o jsonpath='{.data.resource\.exclusions}' 2>/dev/null)

# Comparação tolerante a newline final. O `jsonpath` devolve o valor sem o
# newline que o arquivo tem (editores terminam arquivo com `\n`), então uma
# comparação direta nunca casa e o script reinicia o ArgoCD toda vez — no
# bootstrap isso significaria derrubar o ArgoCD sem motivo a cada execução.
if python3 -c "
import sys
a = open(sys.argv[1]).read().rstrip('\n')
b = sys.argv[2].rstrip('\n')
sys.exit(0 if a == b else 1)
" "$ARQUIVO" "$atual"; then
  echo "[ok] $CM já está com a lista versionada — nada a fazer"
  exit 0
fi

echo "[patch] atualizando resource.exclusions de $CM"
k3s kubectl patch cm "$CM" -n "$NS" --type merge \
  -p "{\"data\":{\"resource.exclusions\":$novo}}" >/dev/null || {
    echo "erro: falha ao aplicar o patch" >&2
    exit 1
  }

# Os quatro componentes que leem resource.exclusions. O
# argocd-application-controller é StatefulSet, não Deployment — usar
# `rollout restart deploy/...` nele falha silenciosamente com "not found".
echo "[restart] argocd-server, repo-server, applicationset-controller, application-controller"
k3s kubectl rollout restart deploy/argocd-server -n "$NS" >/dev/null
k3s kubectl rollout restart deploy/argocd-repo-server -n "$NS" >/dev/null
k3s kubectl rollout restart deploy/argocd-applicationset-controller -n "$NS" >/dev/null
k3s kubectl rollout restart statefulset/argocd-application-controller -n "$NS" >/dev/null

echo "[ok] aplicado; os componentes estão reiniciando"
