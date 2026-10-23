#!/bin/bash
# valida-layout.sh — roda ANTES de commitar. Falha se o repo for inconsistente.
#
# ## Por que isto existe
#
# O ArgoCD não reclama de inconsistência de namespace entre a Application e o
# manifesto: ele aplica o que o kustomize produziu, e o `prune` apaga o que sumiu.
# Um `namespace:` errado num kustomization faz o pod nascer no lugar errado, o
# objeto antigo ser podado — e no caso de PVC, o dado ir junto.
#
# Este script é a rede que transforma esse erro de silencioso em barulhento.
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RAIZ" || exit 1
FALHAS=0
falha() { echo "  FALHA: $*"; FALHAS=$((FALHAS+1)); }

echo "=== 1. a árvore é exatamente gitops/apps/<namespace>/<serviço>/ ==="
# O diretório do namespace é legítimo e vazio; o que não pode é arquivo solto nele
# (seria um serviço invisível ao ApplicationSet, que só olha dois níveis).
for d in gitops/apps/*/; do
  soltos=$(find "$d" -maxdepth 1 -type f 2>/dev/null)
  [ -n "$soltos" ] && falha "arquivo solto em $d: $(echo $soltos) — o ApplicationSet não o veria"
  [ -z "$(find "$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)" ] && \
    falha "$d não tem nenhum serviço dentro"
done

echo
echo "=== 1b. nenhum serviço ficou no nível antigo (gitops/apps/<serviço>/) ==="
for d in gitops/apps/*/; do
  [ -f "$d/kustomization.yaml" ] && falha "$d ainda é um serviço no nível de cima (sem namespace no caminho)"
done

echo
echo "=== 2. o namespace do kustomization bate com o do caminho ==="
for k in gitops/apps/*/*/kustomization.yaml; do
  [ -f "$k" ] || continue
  caminho_ns=$(echo "$k" | sed -E 's|gitops/apps/([^/]+)/.*|\1|')
  declarado=$(grep -m1 '^namespace:' "$k" | awk '{print $2}')
  # dns-aliases é a exceção documentada: cada recurso declara o próprio namespace.
  if [ "$(basename "$(dirname "$k")")" = "dns-aliases" ]; then
    [ -n "$declarado" ] && falha "$k não deve declarar namespace (cada alias declara o seu)"
    continue
  fi
  [ "$declarado" = "$caminho_ns" ] || \
    falha "$k declara '$declarado', mas o caminho diz '$caminho_ns'"
done

echo
echo "=== 3. todo kustomization renderiza ==="
for k in gitops/apps/*/*/kustomization.yaml; do
  d=$(dirname "$k")
  if ! kubectl kustomize "$d" >/dev/null 2>&1; then
    falha "$d não renderiza"
  fi
done

echo
echo "=== 4. nenhum nome de serviço duplicado entre namespaces ==="
# Dois namespaces podem ter o mesmo nome (é o ponto do alias), mas a Application
# não: `metadata.name` é o basename do diretório, e colidiria no ArgoCD.
dup=$(find gitops/apps -mindepth 2 -maxdepth 2 -type d -exec basename {} \; | sort | uniq -d)
[ -n "$dup" ] && falha "diretórios de serviço com nome repetido: $(echo $dup)"

echo
echo "=== 4b. a lista de cada namespace no LAYOUT.yaml bate com o disco ==="
# ## Por que isto faltava, e o que custou
#
# As checagens 1-4 olham o Disco; a 5 olha os aliases. Nenhuma comparava o
# LAYOUT.yaml com a árvore. Resultado: `dns-aliases` e `ingress` existiam em
# `gitops/apps/support/` e **não** apareciam na lista do LAYOUT, e o validador
# dizia "LAYOUT CONSISTENTE" havia commits. O LAYOUT é o mapa que
# `sync-app-secrets.sh` e quem escolhe a próxima fatia leem -- um mapa que omite
# dois serviços é pior que mapa nenhum, porque dá confiança.
#
# A comparação é de CONJUNTO: ordem no LAYOUT é legível, não contratual.
python3 - gitops/LAYOUT.yaml <<'PY' || FALHAS=$((FALHAS+1))
import os, re, sys

txt = open(sys.argv[1]).read().splitlines()
layout = {}
for linha in txt:
    # Só o bloco de namespaces: `namespace:  svc svc svc`, antes de `aliases:`.
    if linha.startswith("aliases:"):
        break
    m = re.match(r"^([a-z][a-z0-9-]*):\s+(.*\S)\s*$", linha)
    if m:
        layout[m.group(1)] = set(m.group(2).split())

disco = {}
base = "gitops/apps"
for ns in sorted(os.listdir(base)):
    p = os.path.join(base, ns)
    if not os.path.isdir(p):
        continue
    disco[ns] = {d for d in os.listdir(p) if os.path.isdir(os.path.join(p, d))}

falhas = 0
for ns in sorted(set(layout) | set(disco)):
    no_mapa = layout.get(ns, set())
    no_disco = disco.get(ns, set())
    if no_mapa != no_disco:
        so_mapa = sorted(no_mapa - no_disco)
        so_disco = sorted(no_disco - no_mapa)
        if so_mapa:
            print("  FALHA: LAYOUT.yaml lista em %s, mas não existe no disco: %s"
                  % (ns, " ".join(so_mapa)))
        if so_disco:
            print("  FALHA: existe em gitops/apps/%s/ e o LAYOUT.yaml não lista: %s"
                  % (ns, " ".join(so_disco)))
        falhas += 1

print("  %d namespaces, %d serviços conferidos" % (len(disco), sum(len(v) for v in disco.values())))
sys.exit(1 if falhas else 0)
PY

echo
echo "=== 5. o conjunto de aliases do repo bate com o LAYOUT.yaml ==="
# ## O que esta checagem NÃO consegue provar
#
# As referências que cruzam namespace vivem nos SECRETS, não nos YAML do git:
#
#   postgres://usuario:senha@postgres:5432/domain
#
# e os Secrets não estão no repo (repositório público). Então o repo não tem como
# saber que `applications` precisa de `postgres`.
#
# O que o repo PODE provar: que todo alias que o desenho declara existe, com o
# namespace e o alvo certos. A prova de que o consumidor realmente alcança o nome
# é feita no cluster por `verifica-dns.sh` — ler Secret é privilégio que só quem
# roda dentro do cluster tem.
LAYOUT="gitops/LAYOUT.yaml"
ALIASES="gitops/apps/support/dns-aliases/aliases.yaml"

# Extrai de LAYOUT.yaml as linhas `- nome -> alvo`, agrupadas por namespace.
python3 - "$LAYOUT" "$ALIASES" <<'PY' || FALHAS=$((FALHAS+1))
import re, sys

layout_txt = open(sys.argv[1]).read()
alias_txt = open(sys.argv[2]).read()

esperado = []
em_aliases = False
ns_atual = None
for linha in layout_txt.splitlines():
    if linha.startswith("aliases:"):
        em_aliases = True
        continue
    if em_aliases and linha and not linha.startswith(" "):
        break
    if not em_aliases:
        continue
    m = re.match(r"^  ([a-z-]+):\s*$", linha)
    if m:
        ns_atual = m.group(1)
        continue
    m = re.match(r"^    - ([a-z0-9-]+)\s*->\s*(\S+)\s*$", linha)
    if m and ns_atual:
        esperado.append((ns_atual, m.group(1), m.group(2)))

real = []
for doc in alias_txt.split("\n---\n"):
    if "kind: Service" not in doc:
        continue
    if "type: ExternalName" not in doc:
        continue
    nome = re.search(r"^\s+name: *(\S+)\s*$", doc, re.M)
    ns = re.search(r"^\s+namespace: *(\S+)\s*$", doc, re.M)
    alvo = re.search(r"^\s+externalName: *(\S+)\s*$", doc, re.M)
    if nome and ns and alvo:
        real.append((ns.group(1), nome.group(1), alvo.group(1)))

falhas = 0
for item in esperado:
    if item not in real:
        print("  FALHA: alias declarado no LAYOUT.yaml mas ausente no aliases.yaml: %s/%s -> %s" % item)
        falhas += 1
for item in real:
    if item not in esperado:
        print("  FALHA: alias no cluster sem declaração no LAYOUT.yaml: %s/%s -> %s" % item)
        falhas += 1

print("  %d aliases conferidos" % len(esperado))
sys.exit(1 if falhas else 0)
PY

echo
echo "=== 6. nenhuma referência a 'giomartins' como namespace ==="
if grep -rn '^namespace: giomartins$\|namespace: giomartins$' gitops/apps/ 2>/dev/null | grep -v alias; then
  falha "ainda há manifesto apontando para o namespace antigo"
fi

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "### LAYOUT CONSISTENTE"
  exit 0
else
  echo "### $FALHAS FALHA(S)"
  exit 1
fi
