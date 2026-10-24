#!/bin/bash
# copia-secrets.sh — replica os Secrets de giomartins para o namespace de destino.
#
# ## Por que copiar em vez de rodar sync-app-secrets.sh
#
# O `sync-app-secrets.sh` deriva os valores de `docker inspect` dos containers
# legados. Depois que o container é aposentado, essa fonte some. Aqui a fonte é o
# próprio Secret que já está no cluster e já funcionava -- nenhum valor passa por
# este script, por stdout ou por arquivo.
#
# ## Por que a cópia preserva o dado, e não o `resourceVersion`
#
# O Secret novo é um objeto diferente: mesmo nome, outro namespace. Só `metadata`
# muda. Levo `data` e `type` intactos, descarto identidade do objeto antigo, e
# aplico. Se já existir no destino, o `apply` atualiza (idempotente).
set -uo pipefail || exit 1

K="k3s kubectl"
ORIGEM=giomartins

# par: <secret> <namespace-destino>
PARES="
domain-api applications
domain-worker applications
finance-api applications
finance-customersupport-worker applications
finance-openfinance-worker applications
vaultwarden-api applications
evolution-api applications
9router applications
postgres persistence
rabbitmq persistence
minio persistence
vaultwarden persistence
grafana observability
db-mcp support
db-mcp-gateway support
"

echo "=== copiando Secrets ==="
# Diretório privado e novo a cada execução: os arquivos intermediários contêm
# Secrets completos, e usar um nome fixo em /tmp deu "Permission denied" quando
# já havia um arquivo de outro dono — o redirect falhava e o script reportava
# "AUSENTE", escondendo a causa real.
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

echo "$PARES" | while read -r secret ns; do
  [ -z "$secret" ] && continue

  # O redirect vem ANTES do `if`: se ele falhar, quero o erro do shell, não um
  # falso "Secret ausente".
  if ! $K get secret "$secret" -n "$ORIGEM" -o json > "$TMPD/s.json" 2>"$TMPD/err.txt"; then
    echo "  FALHOU ao ler $ORIGEM/$secret: $(cat "$TMPD/err.txt")"
    continue
  fi

  # Reescreve só o metadata. `data` e `type` passam intactos, e nenhum valor é
  # impresso em lugar nenhum.
  python3 - "$ns" "$secret" "$TMPD/s.json" <<'PY' > "$TMPD/s-ns.json"
import json, sys
ns, nome, origem = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(origem))
d["metadata"] = {
    "name": nome,
    "namespace": ns,
    "labels": {"app.kubernetes.io/part-of": "giomartins"},
}
json.dump(d, sys.stdout)
PY

  if $K apply -f "$TMPD/s-ns.json" >/dev/null 2>&1; then
    chaves=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1])).get("data") or {}))' "$TMPD/s-ns.json")
    echo "  ok: $ns/$secret ($chaves chaves)"
  else
    echo "  FALHOU: $ns/$secret"
    $K apply -f "$TMPD/s-ns.json" 2>&1 | sed 's/^/      /'
  fi
done

echo
echo "=== conferência: todo Secret esperado existe no destino? ==="
FALTA=0
echo "$PARES" | while read -r secret ns; do
  [ -z "$secret" ] && continue
  $K get secret "$secret" -n "$ns" >/dev/null 2>&1 || echo "  FALTA: $ns/$secret"
done
echo "  (silêncio acima = todos presentes)"
