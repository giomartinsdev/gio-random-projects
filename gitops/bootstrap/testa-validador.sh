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
  cp -R "$RAIZ/gitops" "$TMP/repo/gitops"
  cp -R "$RAIZ/gitops/bootstrap" "$TMP/repo/gitops/bootstrap" 2>/dev/null || true
}

teste() {
  local nome="$1" comando="$2"
  prepara
  ( cd "$TMP/repo" && bash -c "$comando" ) >/dev/null 2>&1
  if ( cd "$TMP/repo" && ./gitops/bootstrap/valida-layout.sh ) >/tmp/v.out 2>&1; then
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
  "sed -i.bak 's/^namespace: persistence$/namespace: giomartins/' gitops/apps/persistence/postgres/kustomization.yaml && rm -f gitops/apps/persistence/postgres/kustomization.yaml.bak"

teste "serviço no nível antigo (fora de namespace)" \
  "mkdir -p gitops/apps/novo-servico && cp gitops/apps/support/adminer/kustomization.yaml gitops/apps/novo-servico/kustomization.yaml && cp gitops/apps/support/adminer/deployment.yaml gitops/apps/novo-servico/ && cp gitops/apps/support/adminer/service.yaml gitops/apps/novo-servico/"

teste "diretório de namespace sem serviço dentro" \
  "mkdir -p gitops/apps/namespace-vazio-dir"

teste "alias com namespace errado" \
  "python3 -c \"
p='gitops/apps/support/dns-aliases/aliases.yaml'
t=open(p).read()
t=t.replace('  namespace: applications\n  labels:\n    app.kubernetes.io/part-of: giomartins\n    giomartins.dev/role: alias\n  annotations:\n    giomartins.dev/alias-of: alloy', '  namespace: support\n  labels:\n    app.kubernetes.io/part-of: giomartins\n    giomartins.dev/role: alias\n  annotations:\n    giomartins.dev/alias-of: alloy', 1)
open(p,'w').write(t)
\""

echo
[ "$FALHOU" = "0" ] && echo "### VALIDADOR TEM DENTES" || echo "### VALIDADOR É DECORATIVO"
exit $FALHOU
