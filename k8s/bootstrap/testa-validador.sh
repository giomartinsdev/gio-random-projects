#!/bin/bash
# O validador tem que FALHAR quando o layout está errado.
#
# Um validador que passa sempre é pior que nenhum: dá confiança sem cobertura.
# Este teste sabota uma CÓPIA do repo, confirma que o validador acusa, e restaura.
#
# Usa cópia, não `git checkout`: o trabalho em andamento não está commitado, e
# `git checkout -- .` apagaria exatamente o que está sendo validado.
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

FALHOU=0

prepara() {
  rm -rf "$TMP/repo"
  mkdir -p "$TMP/repo"
  cp -R "$RAIZ/k8s" "$TMP/repo/k8s"
}

teste() {
  local nome="$1" comando="$2"
  prepara
  ( cd "$TMP/repo" && bash -c "$comando" ) >/dev/null 2>&1
  if ( cd "$TMP/repo" && ./k8s/bootstrap/valida-layout.sh ) >/tmp/v.out 2>&1; then
    echo "  NAO DETECTOU: $nome"
    FALHOU=1
  else
    echo "  detectou: $nome"
  fi
}

# O validador calcula a raiz a partir do próprio caminho, então precisa estar
# dentro da cópia.
echo "=== sabotagens ==="

teste "namespace do kustomization diverge do caminho" \
  "sed -i.bak 's/^namespace: persistence$/namespace: giomartins/' k8s/apps/persistence/postgres/kustomization.yaml && rm -f k8s/apps/persistence/postgres/kustomization.yaml.bak"

teste "serviço no nível antigo (fora de namespace)" \
  "mkdir -p k8s/apps/novo-servico && cp k8s/apps/support/adminer/kustomization.yaml k8s/apps/novo-servico/kustomization.yaml && cp k8s/apps/support/adminer/deployment.yaml k8s/apps/novo-servico/ && cp k8s/apps/support/adminer/service.yaml k8s/apps/novo-servico/"

teste "diretório de namespace sem serviço dentro" \
  "mkdir -p k8s/apps/namespace-vazio-dir"

teste "alias com namespace errado" \
  "python3 -c \"
p='k8s/apps/support/dns-aliases/aliases.yaml'
t=open(p).read()
t=t.replace('  namespace: applications\n  labels:\n    app.kubernetes.io/part-of: giomartins\n    giomartins.dev/role: alias\n  annotations:\n    giomartins.dev/alias-of: alloy', '  namespace: support\n  labels:\n    app.kubernetes.io/part-of: giomartins\n    giomartins.dev/role: alias\n  annotations:\n    giomartins.dev/alias-of: alloy', 1)
open(p,'w').write(t)
\""

echo
[ "$FALHOU" = "0" ] && echo "### VALIDADOR TEM DENTES" || echo "### VALIDADOR É DECORATIVO"
exit $FALHOU
