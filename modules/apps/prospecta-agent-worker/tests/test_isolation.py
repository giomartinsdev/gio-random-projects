"""§12.6 isolamento, do lado do worker: prova estrutural, não promessa.

O `prospecta-agent-worker` consome eventos (Evolution e, nas próximas user
stories, `domain.events`) e **nunca** abre banco e **nunca** carrega driver de
banco -- a persistência é do par de domínio (§1.1). A checagem é sobre o
código-fonte lido via AST (comentários/docstrings não disparam), então uma
explicação em prosa continua permitida e uma violação real é pega.

Diferente do worker financeiro, este worker **publica** os eventos do Prospecta
(`ReplyReceived`, `MessageBlocked`) -- é o contrato (worker.md §Saídas). A prova
aqui é que ele só fala nos exchange da casa: `domain.events` (fanout do domínio)
e `evolution` (o que consome). Nenhum broker próprio, nenhum exchange inventado.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
SRC = APP_ROOT / "src"
PKG = SRC / "prospecta_agent_worker"

FORBIDDEN_IMPORTS = frozenset(
    {
        "psycopg",
        "psycopg2",
        "asyncpg",
        "sqlalchemy",
        "aiosqlite",
        "sqlite3",
        "pymongo",
        "redis",
        "pika",
        "kombu",
        "aiokafka",
        "kafka",
        "celery",
        "mysql",
        "pymysql",
        "mysqlclient",
    }
)

FORBIDDEN_SUBSTRINGS = ("DATABASE_URL", "POSTGRES_", "PGHOST", "PGUSER")

ALLOWED_EXCHANGES = frozenset({"domain.events", "evolution"})


def python_files() -> list[Path]:
    return sorted(p for p in SRC.rglob("*.py"))


def _docstring_lines(tree: ast.Module) -> set[int]:
    lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            lines.add(body[0].lineno)
    return lines


def _code_text(path: Path) -> str:
    tree = ast.parse(path.read_text(), filename=str(path))
    skip = _docstring_lines(tree)
    pieces: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.lineno not in skip:
            pieces.append(node.value)
        elif isinstance(node, ast.Name):
            pieces.append(node.id)
        elif isinstance(node, ast.Attribute):
            pieces.append(node.attr)
    return "\n".join(pieces)


def test_source_tree_is_not_empty() -> None:
    assert python_files(), "expected the worker source to exist"


def test_no_database_driver_is_imported() -> None:
    offenders: list[str] = []
    for path in python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                if name.split(".")[0] in FORBIDDEN_IMPORTS:
                    offenders.append(f"{path.relative_to(APP_ROOT)} imports {name}")
    assert offenders == [], f"worker must not import a database driver (§1.1): {offenders}"


def test_no_database_env_var_is_referenced() -> None:
    offenders: list[str] = []
    for path in python_files():
        code = _code_text(path)
        for needle in FORBIDDEN_SUBSTRINGS:
            if needle in code:
                offenders.append(f"{path.relative_to(APP_ROOT)} uses {needle}")
    assert offenders == [], f"worker must not read a database setting (§1.1): {offenders}"


def test_declared_dependencies_have_no_database_driver() -> None:
    pyproject = (APP_ROOT / "pyproject.toml").read_text()
    offenders = [n for n in FORBIDDEN_IMPORTS if re.search(rf'"{n}[<>=~!]', pyproject)]
    # `pika` casa como substring de `aio-pika`? A regex casa `"pika` -- não, o
    # nome real é `"aio-pika`. Guarda mesmo assim:
    assert offenders == [], f"pyproject declares a driver: {offenders}"


def test_only_house_exchanges_are_referenced() -> None:
    """O worker só fala nos exchange da casa: `domain.events` e `evolution`."""
    found: set[str] = set()
    for path in python_files():
        text = path.read_text()
        for match in re.finditer(r'EXCHANGE\s*=\s*"([^"]+)"', text):
            found.add(match.group(1))
        for match in re.finditer(r'declare_exchange\(\s*"([^"]+)"', text):
            found.add(match.group(1))
    invented = found - ALLOWED_EXCHANGES
    assert invented == set(), f"worker invented an exchange/broker (§1.1): {invented}"
    assert {"domain.events", "evolution"} <= found, f"missing a house exchange: {ALLOWED_EXCHANGES - found}"
