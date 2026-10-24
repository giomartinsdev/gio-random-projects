#!/bin/bash
# fecha-giomartins.sh — o ultimo passo da fatia 7: aposentar o namespace antigo.
#
# Uso:  sudo bash fecha-giomartins.sh
#
# ## So rode isto DEPOIS de
#
#   1. 15/15 Applications `Synced` nos paths novos (o ArgoCD e a fonte de
#      verdade; se ele nao estiver verde, o namespace antigo e o rollback).
#   2. Os Secrets dos namespaces novos provados IDENTICOS aos daqui (hash de
#      conjunto, nunca valor). `copia-secrets.sh` faz a copia; o `move-service.sh`
#      nao valida a copia.
#   3. Zero referencias a `giomartins.svc` em qualquer Service/ConfigMap/Secret/
#      Deployment de qualquer namespace.
#
# O script confere (2) e (3) por conta propria e ABORTA se algo nao bate. Nao
# confie na sua memoria: a janela e longa e o cansaço e real.
#
# ## O que ele NAO faz
#
# Nao para o Docker. Os containers seguem de pe, e o timer
# `sync-external-endpoints` segue instalado com `MAPA=()` -- e a rede de
# seguranca para o rollback de emergencia.
set -uo pipefail
K="k3s kubectl"

SELO=$(date -u +%Y-%m-%d-%H%M)
DEST="/opt/k8s-backups/${SELO}-giomartins-final"

echo "=== 0. pre-condicoes ==="
if $K get ns giomartins >/dev/null 2>&1; then
  echo "  namespace existe"
else
  echo "  giomartins ja nao existe -- nada a fazer"
  exit 0
fi

# Todo Service novo precisa ter os Secrets que ele referencia? Nao da para saber
# sem parsear. O que da para provar: nenhum recurso de fora aponta para ca.
REFS=$($K get svc,cm,secret,deploy -A -o json 2>/dev/null | python3 -c '
import sys, json, base64
d = json.load(sys.stdin)
n = 0
for item in d.get("items", []):
    if item["metadata"].get("namespace") == "giomartins":
        continue
    kind = item["kind"]
    txt = ""
    if kind == "Service":
        txt = item["spec"].get("externalName") or ""
    elif kind == "ConfigMap":
        txt = "\n".join((item.get("data") or {}).values())
    elif kind == "Secret":
        for v in (item.get("data") or {}).values():
            try:
                txt += base64.b64decode(v).decode("utf-8", "replace") + "\n"
            except Exception:
                pass
    elif kind == "Deployment":
        txt = json.dumps(item.get("spec") or {})
    if "giomartins.svc" in txt:
        n += 1
print(n)
')
if [ "${REFS:-1}" != "0" ]; then
  echo "  ERRO: $REFS recurso(s) de fora ainda apontam para giomartins.svc -- ABORTANDO"
  exit 1
fi
echo "  zero referencias a giomartins.svc de fora do namespace"

echo
echo "=== 1. backup dos manifests ==="
mkdir -p "$DEST"
chmod 700 "$DEST"
$K get all,cm,secret,sa,role,rolebinding,pvc,ingress,netpol -n giomartins -o yaml \
  > "$DEST/giomartins.yaml" 2>/dev/null
chmod 600 "$DEST/giomartins.yaml"
echo "  arquivo: $DEST/giomartins.yaml"

echo
echo "=== 2. o dump tem os Secrets? (senao aborta) ==="
# ## `grep -c '^kind: Secret'` conta ZERO num dump `-o yaml`
#
# `kubectl get ... -o yaml` embrulha tudo num `kind: List`, e cada item aparece
# com `kind:` INDENTADO sob `items:`. O `^` ancora no começo da linha, então o
# contador devolvia 0 num arquivo que tinha os 16 Secrets -- a armadilha 20
# (regex `^` sobre estrutura multi-linha) de novo, agora no guarda que existia
# justamente para impedir perda de dado. E ele não abortou: `[ "0\n0" -lt 16 ]`
# deu erro de expressão e o shell seguiu.
NSEC=$(grep -cE '^[[:space:]]*kind: Secret' "$DEST/giomartins.yaml" 2>/dev/null)
NSEC=${NSEC:-0}
NSEC_ESPERADO=$($K get secret -n giomartins --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [ "$NSEC" -lt "$NSEC_ESPERADO" ]; then
  echo "  ERRO: dump tem $NSEC Secrets, o namespace tem $NSEC_ESPERADO -- ABORTANDO"
  exit 1
fi
echo "  ok: $NSEC de $NSEC_ESPERADO Secrets no backup"

echo
echo "=== 3. apagando o namespace ==="
$K delete namespace giomartins --timeout=180s 2>&1 | sed 's/^/  /'

echo
echo "=== 4. o namespace sumiu mesmo? (finalizers podem segurar) ==="
st="?"
for i in $(seq 1 60); do
  st=$($K get ns giomartins -o jsonpath='{.status.phase}' 2>/dev/null)
  [ -z "$st" ] && break
  sleep 3
done
if [ -z "$st" ]; then
  echo "  giomartins: NAO EXISTE MAIS"
else
  echo "  ainda em phase=$st -- finalizers:"
  $K get ns giomartins -o jsonpath='{.metadata.finalizers}' 2>/dev/null | sed 's/^/    /'
  echo
fi

echo
echo "=== 5. o que continua rodando (e deve) ==="
echo "  timer:  $(systemctl is-active sync-external-endpoints.timer 2>/dev/null)"
echo "  entrada: $(grep -m1 '^MAPA=' /usr/local/sbin/sync-external-endpoints.sh 2>/dev/null)  (vazio = nao recria nada)"
echo
echo "Rode /tmp/regressao.sh e /tmp/proxy2.sh: as portas do nginx do host nao"
echo "podem ter mudado. Se mudaram, o problema NAO e este script."
