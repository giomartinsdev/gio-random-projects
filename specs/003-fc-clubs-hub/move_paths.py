#!/usr/bin/env python3
"""Renomeia os caminhos/arquivos Go do app clubs de pt para en, numa passada só.

Renomear o CONTEÚDO (codemod.py) e o CAMINHO separadamente faz o build quebrar
entre os dois passos e convida a reverter. Aqui os dois andam juntos: move o
diretório/arquivo e ajusta todo import que apontava para ele.
"""

from __future__ import annotations

import os
import subprocess

# diretório pt -> en (caminho relativo à raiz do repo)
DIR_MOVES = [
    ("modules/apps/domain-worker/internal/domain/partida",
     "modules/apps/domain-worker/internal/domain/match"),
    ("modules/apps/domain-worker/internal/domain/preferencia",
     "modules/apps/domain-worker/internal/domain/preference"),
    ("modules/apps/domain-worker/internal/domain/anuncio",
     "modules/apps/domain-worker/internal/domain/announcement"),
    ("modules/apps/domain-worker/internal/domain/clubesnapshot",
     "modules/apps/domain-worker/internal/domain/clubsnapshot"),
    ("modules/apps/domain-worker/internal/domain/clubetotais",
     "modules/apps/domain-worker/internal/domain/clubtotals"),
    ("modules/apps/domain-worker/internal/application/partida",
     "modules/apps/domain-worker/internal/application/match"),
    ("modules/apps/domain-worker/internal/application/preferencia",
     "modules/apps/domain-worker/internal/application/preference"),
    ("modules/apps/domain-worker/internal/application/anuncio",
     "modules/apps/domain-worker/internal/application/announcement"),
    ("modules/apps/domain-worker/internal/application/clubesnapshot",
     "modules/apps/domain-worker/internal/application/clubsnapshot"),
]

# arquivo pt -> en
FILE_MOVES = [
    "modules/apps/domain-worker/internal/infrastructure/postgres/preferencia_repository.go|preference_repository.go",
    "modules/apps/domain-worker/internal/infrastructure/postgres/ingestestado_repository.go|ingeststatus_repository.go",
    "modules/apps/domain-worker/internal/infrastructure/postgres/anuncio_repository.go|announcement_repository.go",
    "modules/apps/domain-worker/internal/infrastructure/postgres/partida_repository.go|match_repository.go",
    "modules/apps/domain-worker/internal/infrastructure/postgres/clubesnapshot_repository.go|clubsnapshot_repository.go",
    "modules/apps/domain-worker/internal/infrastructure/postgres/clubetotais_repository.go|clubtotals_repository.go",
]

# (de, para) aplicado em TODO import/uso depois do move -- caminhos e aliases
IMPORT_FIXES = [
    ("domain-worker/internal/domain/partida", "domain-worker/internal/domain/match"),
    ("domain-worker/internal/domain/preferencia", "domain-worker/internal/domain/preference"),
    ("domain-worker/internal/domain/anuncio", "domain-worker/internal/domain/announcement"),
    ("domain-worker/internal/domain/clubetotais", "domain-worker/internal/domain/clubtotals"),
    ("domain-worker/internal/application/partida", "domain-worker/internal/application/match"),
    ("domain-worker/internal/application/preferencia", "domain-worker/internal/application/preference"),
    ("domain-worker/internal/application/anuncio", "domain-worker/internal/application/announcement"),
    ("application/clubesnapshot", "application/clubsnapshot"),
    ("domain/clubesnapshot", "domain/clubsnapshot"),
    # aliases (o nome local no import) -- alinhados com o corpo já renomeado
    ("apppartida ", "appmatch "),
    ("apppreferencia ", "apppreference "),
    ("appanuncio ", "appannouncement "),
    ("appclubesnapshot ", "appclubsnapshot "),
    ("domainpartida ", "domainmatch "),
    ("domainanuncio ", "domainannouncement "),
    ("domaintotais ", "domainclubtotals "),
    # uso do alias no corpo
    ("apppartida.", "appmatch."),
    ("apppreferencia.", "apppreference."),
    ("appanuncio.", "appannouncement."),
    ("appclubesnapshot.", "appclubsnapshot."),
    ("domainpartida.", "domainmatch."),
    ("domainanuncio.", "domainannouncement."),
    ("domaintotais.", "domainclubtotals."),
]


def sh(*args: str) -> None:
    subprocess.run(args, check=True)


def go_files() -> list[str]:
    out = []
    for root, dirs, files in os.walk("modules/apps"):
        dirs[:] = [d for d in dirs if d not in
                   ("node_modules", ".venv", "__pycache__", "dist", ".git", "fc27-clubs-api")]
        for f in files:
            if f.endswith(".go"):
                out.append(os.path.join(root, f))
    return out


def main() -> int:
    for src, dst in DIR_MOVES:
        if os.path.exists(src):
            sh("git", "mv", src, dst)
    for pair in FILE_MOVES:
        src, name = pair.split("|")
        if os.path.exists(src):
            sh("git", "mv", src, os.path.join(os.path.dirname(src), name))

    n = 0
    for path in go_files():
        src = open(path, encoding="utf-8").read()
        out = src
        for a, b in IMPORT_FIXES:
            out = out.replace(a, b)
        if out != src:
            open(path, "w", encoding="utf-8").write(out)
            n += 1
    print(f"caminhos movidos e {n} arquivos com imports ajustados")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
