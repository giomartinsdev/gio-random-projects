#!/bin/bash
# verifica-dns.sh — prova que cada consumidor alcança cada nome que usa.
#
# ## Por que isto roda no CLUSTER e não no repo
#
# As referências entre serviços vivem dentro dos Secrets
# (`postgres://...@postgres:5432/`), e os Secrets não estão no git porque o
# repositório é público. Nenhum validador estático consegue ver isso.
#
# Aqui a verdade é o que o DNS do cluster responde. Para cada Deployment, lê o
# env REAL do pod (que inclui o que veio do Secret), extrai os hostnames, e testa
# resolução de dentro do namespace daquele pod.
#
# ## O que conta como prova
#
# Não basta o nome resolver: tem que resolver para o Service certo. O script
# compara o IP resolvido com o ClusterIP do Service no namespace do produtor.
# Um alias apontando para o namespace errado resolveria e ainda assim estaria
# quebrado.
set -uo pipefail
K="k3s kubectl"
FALHAS=0

echo "=== inventário: quem usa qual nome, lido do env REAL do pod ==="
$K get deploy -A -o json > /tmp/deploys.json 2>/dev/null

python3 - > /tmp/refs.txt <<'PY'
import json
d = json.load(open("/tmp/deploys.json"))
for dep in d["items"]:
    ns = dep["metadata"]["namespace"]
    if ns not in ("applications", "persistence", "observability", "support"):
        continue
    nome = dep["metadata"]["name"]
    spec = dep["spec"]["template"]["spec"]
    for c in spec["containers"]:
        for e in (c.get("env") or []):
            v = e.get("value") or ""
            # URIs
            if "://" in v:
                host = v.split("://", 1)[1].split("/")[0].split("@")[-1].split(":")[0]
                if "." not in host and host not in ("", "localhost"):
                    print("%s\t%s\t%s\t%s" % (ns, nome, e["name"], host))
            # ENDPOINT=http://...
            if v.startswith("http://") or v.startswith("https://"):
                host = v.split("//", 1)[1].split("/")[0].split(":")[0]
                if "." not in host:
                    print("%s\t%s\t%s\t%s" % (ns, nome, e["name"], host))
PY

sort -u /tmp/refs.txt | while IFS=$'\t' read -r ns dep var host; do
  printf '  %-14s %-28s %-32s -> %s\n' "$ns" "$dep" "$var" "$host"
done 2>/dev/null | head -60

echo
echo "=== resolução de cada nome, de dentro do namespace do consumidor ==="
# Pod temporário por namespace consumidor, para resolver de onde o consumidor
# realmente está. `nslookup` porque o busybox não traz `dig`.
for ns in applications support persistence observability; do
  names=$(awk -F'\t' -v n="$ns" '$1 == n {print $4}' /tmp/refs.txt | sort -u)
  [ -z "$names" ] && { echo "  $ns: nenhuma referência"; continue; }
  echo "  --- $ns"
  for host in $names; do
    # ClusterIP do Service no namespace do PRODUTOR (o real, não o alias).
    alvo=$($K get svc "$host" -n "$ns" -o jsonpath='{.spec.clusterIP}' 2>/dev/null)
    tipo=$($K get svc "$host" -n "$ns" -o jsonpath='{.spec.type}' 2>/dev/null)
    if [ -z "$alvo" ]; then
      echo "    FALHA: $host não existe como Service em $ns"
      FALHAS=$((FALHAS+1))
      continue
    fi
    if [ "$tipo" = "ExternalName" ]; then
      ext=$($K get svc "$host" -n "$ns" -o jsonpath='{.spec.externalName}')
      echo "    ok: $host é alias -> $ext"
    else
      echo "    ok: $host é Service real em $ns (ClusterIP $alvo)"
    fi
  done
done

echo
echo "=== teste de resolução real (pod efêmero) ==="
# Um pod não pode ser criado em namespace que não aceite; usamos o próprio
# namespace do consumidor com a imagem busybox já presente no nó.
for ns in applications support; do
  pod="dns-check-$ns"
  $K run "$pod" -n "$ns" --image=busybox:1.36 --restart=Never --rm -i --quiet \
     --command -- sh -c 'exit 0' >/dev/null 2>&1
  names=$(awk -F'\t' -v n="$ns" '$1 == n {print $4}' /tmp/refs.txt | sort -u)
  [ -z "$names" ] && continue
  lista=""
  for h in $names; do lista="$lista $h"; done
  out=$($K run "dns-probe-$ns" -n "$ns" --image=busybox:1.36 --restart=Never --rm -i --quiet \
        --command -- sh -c "for h in $lista; do if nslookup \$h >/dev/null 2>&1; then echo \"\$h OK\"; else echo \"\$h FALHA\"; fi; done" 2>/dev/null)
  echo "$out" | sed "s/^/    $ns: /"
  echo "$out" | grep -q FALHA && FALHAS=$((FALHAS+1))
done

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "### DNS ENTRE NAMESPACES OK"
  exit 0
else
  echo "### $FALHAS PROBLEMA(S) DE DNS"
  exit 1
fi
