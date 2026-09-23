#!/usr/bin/env python3
"""Aplica o glossário pt→en mecanicamente nas camadas do app clubs.

Renomear 17k linhas à mão garante inconsistência -- uma camada traduz "nota"
para "rating", outra para "score", e o contrato quebra sem aviso. Este codemod
deriva TODAS as formas do mesmo mapa (snake_case, PascalCase, camelCase) e
aplica em SQL, Go, Python e TypeScript de uma vez.

Uso:
    python3 codemod.py --dry-run     # mostra o que mudaria
    python3 codemod.py --apply       # escreve

Não toca em `fc27-clubs-api/` (é o repo de terceiro, vendorizado) nem em
`node_modules`/`.venv`.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glossary import ALL  # noqa: E402


def snake_to_pascal(s: str) -> str:
    return "".join(p.capitalize() for p in s.split("_"))


def snake_to_camel(s: str) -> str:
    p = snake_to_pascal(s)
    return p[0].lower() + p[1:] if p else p


def build_maps() -> list[tuple[re.Pattern, str]]:
    """Um par (regex, substituição) por forma de identificador.

    A ORDEM importa: o mais específico primeiro, senão `gols` casaria dentro de
    `gols_sofridos` e produziria `goals_conceded` errado.
    """
    pairs = []
    for pt in sorted(ALL, key=len, reverse=True):
        en = ALL[pt]
        # snake_case (colunas, json tags, chaves de dict)
        pairs.append((re.compile(rf"(?<![A-Za-z0-9_]){re.escape(pt)}(?![A-Za-z0-9_])"), en))
        # PascalCase (tipos e campos Go)
        pc_pt, pc_en = snake_to_pascal(pt), snake_to_pascal(en)
        if pc_pt != pt:
            pairs.append((re.compile(rf"(?<![A-Za-z0-9_]){pc_pt}(?![A-Za-z0-9_])"), pc_en))
            # A convenção Go deste repo escreve a sigla em caixa alta (`RegiaoID`,
            # `EscudoAssetID`), que `snake_to_pascal` não gera. Sem estas duas
            # variantes, metade dos campos de id ficaria em português no meio de
            # um struct já traduzido.
            pairs.append((re.compile(rf"(?<![A-Za-z0-9_]){pc_pt}ID(?![A-Za-z0-9_])"), pc_en + "ID"))
            pairs.append((re.compile(rf"(?<![A-Za-z0-9_]){pc_pt}Id(?![A-Za-z0-9_])"), pc_en + "ID"))
        # camelCase (campos TS)
        cc_pt, cc_en = snake_to_camel(pt), snake_to_camel(en)
        if cc_pt != pt and cc_pt != pc_pt:
            pairs.append((re.compile(rf"(?<![A-Za-z0-9_]){cc_pt}(?![A-Za-z0-9_])"), cc_en))
    return pairs


SKIP_DIRS = {"node_modules", ".venv", "__pycache__", "dist", ".git", ".pytest_cache", "fc27-clubs-api"}
TARGETS = {
    "modules/apps/domain-api/internal",
    "modules/apps/domain-worker/internal",
    "modules/apps/clubs-api/internal",
    "modules/apps/clubs-ingest/src",
    "modules/apps/clubs-ingest/tests",
    "modules/apps/clubs-frontend/src",
}


def files_to_touch() -> list[str]:
    out = []
    for target in TARGETS:
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if os.path.splitext(f)[1] in (".go", ".py", ".ts", ".tsx", ".sql"):
                    out.append(os.path.join(root, f))
    return sorted(out)


# Linhas que NÃO são código: comentário, prosa de docstring, texto de UI. A
# renomeação é mecânica em identificador; traduzir texto é decisão de redação,
# e passar o codemod aqui corromperia "falha de X" em "falha from X".
COMMENT_PREFIXES = ("//", "#", "*", "/*", "--")


def is_comment(line: str) -> bool:
    return line.lstrip().startswith(COMMENT_PREFIXES)


def rename_code_only(src: str, pairs: list[tuple[re.Pattern, str]]) -> str:
    """Aplica o glossário só nas linhas de código, preservando comentários."""
    out = []
    for line in src.split("\n"):
        if is_comment(line):
            out.append(line)
        else:
            for rx, repl in pairs:
                line = rx.sub(repl, line)
            out.append(line)
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="filtra por substring do caminho")
    args = ap.parse_args()

    pairs = build_maps()
    changed = []
    for path in files_to_touch():
        if args.only and args.only not in path:
            continue
        src = open(path, encoding="utf-8").read()
        out = rename_code_only(src, pairs)
        if out != src:
            changed.append(path)
            if args.apply:
                open(path, "w", encoding="utf-8").write(out)

    print(f"{'aplicado' if args.apply else 'mudaria'}: {len(changed)} arquivos")
    for p in changed:
        print("  ", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
