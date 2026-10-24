#!/usr/bin/env python3
# Valida a action composta `.github/actions/build-push-cluster/action.yml`.
#
# Por que existe: a action é o único ponto por onde 4 workflows publicam
# imagem. Um input renomeado lá e não aqui (ou o contrário) não falha no PR —
# falha no meio de um deploy, depois do build ter rodado. Este check é o que
# transforma isso em erro de CI.
import json
import subprocess
import sys

PATH = ".github/actions/build-push-cluster/action.yml"

REQUIRED_INPUTS = {"vps-host", "vps-ssh-key", "app", "dockerfile"}
# `context` e `cache-scope` têm default; os demais não têm.
OPTIONAL_INPUTS = {"context", "cache-scope"}

def main() -> int:
    # `ruby -ryaml` em vez de PyYAML: o runner tem os dois, mas a máquina de
    # quem roda na mão pode não ter PyYAML (foi o caso). Ruby vem no macOS e
    # na imagem do Ubuntu runner.
    raw = subprocess.run(
        ["ruby", "-ryaml", "-rjson", "-e",
         "puts JSON.generate(YAML.load_file(ARGV[0]) || {})", PATH],
        check=True, capture_output=True, text=True,
    ).stdout
    d = json.loads(raw)

    errs = []

    inputs = d.get("inputs") or {}
    missing = REQUIRED_INPUTS - set(inputs)
    if missing:
        errs.append(f"faltam inputs obrigatórios: {sorted(missing)}")

    unknown = set(inputs) - REQUIRED_INPUTS - OPTIONAL_INPUTS
    if unknown:
        errs.append(f"inputs não previstos: {sorted(unknown)}")

    for name in REQUIRED_INPUTS & set(inputs):
        if not inputs[name].get("required"):
            errs.append(f"input `{name}` deveria ser required: true")

    outputs = d.get("outputs") or {}
    if not outputs.get("digest"):
        errs.append("falta o output `digest`")
    elif outputs["digest"].get("value") != "${{ steps.build.outputs.digest }}":
        errs.append("`digest` deve vir de steps.build.outputs.digest")

    runs = d.get("runs") or {}
    if runs.get("using") != "composite":
        errs.append("a action deve ser `using: composite`")

    steps = runs.get("steps") or []
    if not steps:
        errs.append("a action não tem steps")
    for s in steps:
        if s.get("uses") and s.get("shell"):
            errs.append(f"step `{s.get('uses')}` não pode ter `shell`")

    if errs:
        for e in errs:
            print(f"::error::{PATH}: {e}")
        return 1

    print(f"ok: {PATH} ({len(inputs)} inputs, {len(steps)} steps)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
