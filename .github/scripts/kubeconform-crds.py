#!/usr/bin/env python3
# kubeconform-crds.py — regenera os schemas de CRD que o kubeconform usa no
# gitops-validate (`.github/schemas/k8s.nginx.org_*.json`).
#
# ## Por que existe
#
# O kubeconform valida contra schemas de um catálogo externo (kubernetes-json-
# schema), que só tem recursos nativos do Kubernetes. CRDs\n— como os
# VirtualServers do NIC — não aparecem nele, e todo app que declarasse um
# falharia no CI com `could not find schema`. A fonte de verdade correta aqui
# é o PRÓPRIO cluster: o CRD instalado pelo helm do NIC é o schema exato que
# o API server aceita, na versão exata que está no ar.
#
# ## Quando rodar
#
# Depois de um upgrade de versão do NIC. O CRD novo (se houver) substitui o
# schema no repositório, e o CI volta a validar com a API da versão instalada.
# Saída: sobrescreve os JSONs de `.github/schemas/` — commitar junto com o
# upgrade.
#
# ## Uso
#
#   ssh -o BatchMode=yes ubuntu@168.138.135.6 \
#     'sudo kubectl get crds -o json' \
#     > /tmp/all-crds.json
#   python3 .github/scripts/kubeconform-crds.py /tmp/all-crds.json
#
# (sem argumento, lê stdin — com a mesma pipe acima).
import json
import pathlib
import sys

SCHEMAS_DIR = pathlib.Path(__file__).resolve().parent.parent / "schemas"

raw = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
crds = json.loads(raw)["items"]

nic = [c for c in crds if ".k8s.nginx.org" in c["metadata"]["name"]]
if not nic:
    sys.exit("nenhum CRD k8s.nginx.org no dump — cluster sem o NIC?")

SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)
for crd in nic:
    group = crd["spec"]["group"]
    kind = crd["spec"]["names"]["kind"]
    version = next(v for v in crd["spec"]["versions"] if v["name"] == "v1")
    schema = version["schema"]["openAPIV3Schema"]
    schema["$schema"] = "http://json-schema.org/draft-07/schema#"
    # O template do kubeconform (`{{.Group}}_{{.ResourceKind}}.json`) baixa o
    # kind para minúsculas (strings.ToLower no código dele). O nome do ARQUIVO
    # tem que bater: `k8s.nginx.org_virtualserver.json`. E em filesystem
    # case-sensitive (Linux CI) não há 'caso feliz': nome capitalizado = schema
    # não encontrado no CI, enquanto no mac (APFS case-insensitive) passava —
    # a armadilha clássica de dev em mac.
    out = SCHEMAS_DIR / f"{group.lower()}_{kind.lower()}.json"
    out.write_text(json.dumps(schema, indent=2) + "\n")
    print(f"gerado {out} ({out.stat().st_size} bytes)")
