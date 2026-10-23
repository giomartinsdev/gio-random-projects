#!/bin/bash
# cutover-service.sh — vira um Service de ponte para selector, com seguranca.
#
# ## O que este script existe para impedir
#
# Em 2026-10-23, no cutover do `evolution-redis`, um `kubectl apply` falhou
# (manifesto com `apiVersion` cortado) DEPOIS de o EndpointSlice manual ja ter
# sido apagado. O script seguinte dizia `set -uo pipefail`, que NAO aborta em
# comando que falha: ele seguiu, e o Service ficou ~2 min sem endpoint nenhum.
# O `evolution-api` nao quebrou porque a conexao ja estabelecida sobreviveu no
# conntrack -- falha invisivel, que so apareceria no proximo reconnect.
#
# Por isso aqui:
#
#   - `set -euo pipefail` de verdade;
#   - o manifesto e validado (`--dry-run=client`) ANTES de qualquer passo
#     destrutivo;
#   - o EndpointSlice manual so e apagado depois disso;
#   - e o resultado e conferido no fim, nao assumido.
#
# ## Uso
#
#   sudo ./cutover-service.sh <servico> <manifesto-do-service.yaml>
#
# O manifesto deve ser o Service com `selector`, ja renderizado (o mesmo que o
# ArgoCD vai reconciliar depois). O arquivo do repo continua sendo a fonte.
set -euo pipefail

SVC="${1:?uso: $0 <servico> <manifesto-do-service.yaml>}"
MANIFEST="${2:?uso: $0 <servico> <manifesto-do-service.yaml>}"
NS="giomartins"
K="k3s kubectl"

[ -f "$MANIFEST" ] || { echo "erro: manifesto $MANIFEST nao existe" >&2; exit 1; }

echo "[1/6] validando o manifesto (antes de tocar em qualquer coisa)"
$K apply --dry-run=client -f "$MANIFEST" >/dev/null

echo "[2/6] conferindo que o manifesto tem selector"
if ! grep -q '^  selector:' "$MANIFEST"; then
  echo "erro: o manifesto nao tem selector -- isso recriaria a ponte, nao a substituiria" >&2
  exit 1
fi

echo "[3/6] estado antes"
$K get endpointslice -n "$NS" -l "kubernetes.io/service-name=$SVC" \
  -o custom-columns='  N:.metadata.name,M:.metadata.labels.endpointslice\.kubernetes\.io/managed-by,A:.endpoints[*].addresses[*]' \
  --no-headers || true

echo "[4/6] aplicando o Service com selector"
$K apply -f "$MANIFEST"

echo "[5/6] apagando o EndpointSlice manual remanescente"
# Só o que NAO tem `managed-by`: os do controller precisam ficar.
for es in $($K get endpointslice -n "$NS" -l "kubernetes.io/service-name=$SVC" \
              -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.metadata.labels.endpointslice\.kubernetes\.io/managed-by}{"\n"}{end}' \
            | awk '$2==""{print $1}'); do
  echo "  removendo $es (sem managed-by)"
  $K delete endpointslice "$es" -n "$NS"
done

echo "[6/6] verificando"
sleep 3
sel=$($K get svc "$SVC" -n "$NS" -o jsonpath='{.spec.selector}')
[ -n "$sel" ] || { echo "erro: Service $SVC ficou sem selector" >&2; exit 1; }
n=$($K get endpointslice -n "$NS" -l "kubernetes.io/service-name=$SVC" --no-headers | wc -l)
echo "  selector=$sel"
echo "  endpointslices=$n"
[ "$n" -ge 1 ] || { echo "erro: nenhum EndpointSlice -- o Service esta sem destino" >&2; exit 1; }

$K get endpointslice -n "$NS" -l "kubernetes.io/service-name=$SVC" \
  -o custom-columns='  N:.metadata.name,A:.endpoints[*].addresses[*]' --no-headers
echo "OK"
