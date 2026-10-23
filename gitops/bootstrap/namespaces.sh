#!/bin/bash
# namespaces.sh — cria os namespaces do fatiamento e o que cada um precisa para
# que um pod consiga subir. Idempotente: pode rodar de novo.
#
# ## Por que isto não está no git
#
# O `imagePullSecret` contém credencial do registry — e o repositório é PÚBLICO.
# O ArgoCD cria os namespaces via `CreateNamespace=true`, mas ele NÃO cria o
# Secret: isso é bootstrap manual, como já era com `giomartins`.
#
# ## A ordem importa
#
# Namespace → imagePullSecret → primeiro pod. Invertido, o pod falha em
# `ImagePullBackOff` num registry privado que responde 200 no `curl` do host.
set -uo pipefail || exit 1

K="k3s kubectl"
ORIGEM="${ORIGEM:-giomartins}"

NAMESPACES=(persistence observability applications support)

echo "=== namespaces ==="
for ns in "${NAMESPACES[@]}"; do
  if $K create ns "$ns" >/dev/null 2>&1; then
    echo "  criado: $ns"
  else
    echo "  já existe: $ns"
  fi
  # A label é o que permite `kubectl get pods -A -l app.kubernetes.io/part-of=giomartins`
  # continuar funcionando depois do fatiamento — antes o namespace fazia esse papel.
  $K label ns "$ns" app.kubernetes.io/part-of=giomartins --overwrite >/dev/null 2>&1
done

echo
echo "=== imagePullSecret em cada namespace ==="
# O Secret é idêntico em conteúdo; só o namespace do metadata muda.
$K get secret registry-credentials -n "$ORIGEM" -o json > /tmp/regcred.json 2>/dev/null || {
  echo "  ERRO: não consegui ler registry-credentials de $ORIGEM"; exit 1; }

for ns in "${NAMESPACES[@]}"; do
  python3 - "$ns" > /tmp/regcred-ns.json <<'PY'
import json, sys
ns = sys.argv[1]
d = json.load(open("/tmp/regcred.json"))
d["metadata"] = {"name": "registry-credentials", "namespace": ns}
for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields", "selfLink"):
    d["metadata"].pop(k, None)
json.dump(d, sys.stdout)
PY
  if $K apply -f /tmp/regcred-ns.json >/dev/null 2>&1; then
    echo "  ok: $ns"
  else
    echo "  FALHOU: $ns"
  fi
done

echo
echo "=== estado ==="
$K get ns persistence observability applications support \
  -o custom-columns='NAME:.metadata.name,STATUS:.status.phase,AGE:.metadata.creationTimestamp' \
  --no-headers 2>/dev/null | sed 's/^/  /'
