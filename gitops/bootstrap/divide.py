#!/bin/bash
# divide.py — quebra o render do kustomize em "sem Service" e "só Service".
#
# Uso: ./divide.py <render.yaml> <saida-sem-svc> <saida-so-svc>
#
# Corte por linha, não por regex multi-linha: o `$` do awk ancora no fim da string
# quando o buffer tem várias linhas, e as duas tentativas anteriores com awk
# produziram documentos sem `apiVersion` que o `apply` recusou.
import sys

render, saida_sem, saida_com = sys.argv[1], sys.argv[2], sys.argv[3]

docs, atual = [], []
for linha in open(render).read().splitlines():
    if linha.strip() == "---":
        if atual:
            docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual:
    docs.append(atual)


def eh_service(doc):
    # Comparação da linha inteira: `kind: ServiceAccount` não conta.
    return any(l.strip() == "kind: Service" for l in doc)


sem = [d for d in docs if not eh_service(d)]
com = [d for d in docs if eh_service(d)]

for caminho, lista in ((saida_sem, sem), (saida_com, com)):
    with open(caminho, "w") as f:
        for i, d in enumerate(lista):
            if i:
                f.write("---\n")
            f.write("\n".join(d).rstrip("\n") + "\n")

print("  %s: %d documentos" % (saida_sem, len(sem)))
print("  %s: %d documentos" % (saida_com, len(com)))
