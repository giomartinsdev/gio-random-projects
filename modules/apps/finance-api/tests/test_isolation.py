"""§12.6 isolation, proved structurally instead of promised (§1.1).

The static check: neither this app's source nor its declared dependencies
may reach a database driver or a broker client, no ``DATABASE_URL`` may
appear anywhere in the app, and the shared contract must be *imported* from
``finance_contracts`` rather than copied into this app's ``src/``.

This is deliberately a source-level assertion and not a behavioural one: a
behavioural test only covers the code paths it happens to run, while a
connection opened from an untested branch would still break the rule.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = APP_ROOT.parents[2]
SRC = APP_ROOT / "src"
PKG = SRC / "finance_api"

# Drivers/clients that would mean this process owns persistence it must not
# own. Matched against import statements and against the declared
# dependencies in pyproject.toml.
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
        "aio_pika",
        "kombu",
        "aiokafka",
        "kafka",
        "celery",
        "mysql",
        "pymysql",
        "mysqlclient",
    }
)

# Substrings that must not appear in this app's source at all. A commented
# DATABASE_URL is still a config someone will wire up at 2am.
FORBIDDEN_SUBSTRINGS = ("DATABASE_URL", "RABBITMQ_URL", "POSTGRES_", "AMQP_URL")


def python_files() -> list[Path]:
    return sorted(p for p in SRC.rglob("*.py"))


def _module_docstrings(tree: ast.Module) -> set[int]:
    """Line numbers of docstring constants, which are prose, not behaviour.

    The checks below must fire on **code** -- a docstring that explains
    "there is no DATABASE_URL here" is the opposite of a violation, and a
    test that cannot tell the difference would force the comment away.
    """
    lines: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", [])
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            lines.add(first.lineno)
    return lines


def _code_text(path: Path) -> str:
    """The file's executable code: no docstrings, no comments.

    Comments are dropped by reading the source through the AST rather than
    by regex, so an explanation of *why* a forbidden name is absent does not
    read as the name being present.
    """
    tree = ast.parse(path.read_text(), filename=str(path))
    skip_lines = _module_docstrings(tree)
    pieces: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if node.lineno in skip_lines:
                continue
            pieces.append(node.value)
        elif isinstance(node, ast.Name):
            pieces.append(node.id)
        elif isinstance(node, ast.Attribute):
            pieces.append(node.attr)
    return "\n".join(pieces)


def test_source_tree_is_not_empty() -> None:
    assert python_files(), "expected the app source to exist"


def test_no_forbidden_database_or_broker_import() -> None:
    offenders: list[str] = []
    for path in python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            for name in names:
                root = name.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    offenders.append(f"{path.relative_to(APP_ROOT)} imports {name}")
    assert offenders == [], (
        "finance-api must not import a database driver or a broker client "
        f"(§1.1): {offenders}"
    )


def test_no_forbidden_environment_variable_is_referenced() -> None:
    offenders: list[str] = []
    for path in python_files():
        code = _code_text(path)
        for needle in FORBIDDEN_SUBSTRINGS:
            if needle in code:
                offenders.append(f"{path.relative_to(APP_ROOT)} uses {needle}")
    assert offenders == [], (
        "finance-api has no database and no broker, so none of these may be "
        f"read at runtime (§1.1): {offenders}"
    )


def test_every_environment_variable_read_is_an_allowed_one() -> None:
    """A whitelist, so a *new* persistence setting cannot slip in unnoticed."""
    allowed = {
        "DOMAIN_API_BASE_URL",
        "DOMAIN_API_KEY",
        "DOMAIN_API_TIMEOUT_S",
        "HTTP_ADDR",
        "FINANCE_API_KEYS",
        "RATE_LIMIT_RPS",
        "RATE_LIMIT_BURST",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_SERVICE_NAME",
    }
    read: set[str] = set()
    for path in python_files():
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.attr
                if isinstance(func, ast.Attribute)
                else func.id
                if isinstance(func, ast.Name)
                else ""
            )
            if name not in {"get", "getenv"}:
                continue
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    # Only count it if this is an environ lookup.
                    module = getattr(getattr(func, "value", None), "attr", "") or getattr(
                        getattr(func, "value", None), "id", ""
                    )
                    if module == "environ" or name == "getenv":
                        read.add(arg.value)
    unexpected = read - allowed
    assert unexpected == set(), (
        "these environment variables are read but not part of the finance stack "
        f"(§10.2) -- check none of them is a persistence setting: {sorted(unexpected)}"
    )


def test_declared_dependencies_are_free_of_drivers_and_brokers() -> None:
    pyproject = (APP_ROOT / "pyproject.toml").read_text()
    offenders = [
        name for name in FORBIDDEN_IMPORTS if re.search(rf'"{name}[<>=~!]', pyproject)
    ]
    assert offenders == [], f"pyproject declares a driver/broker dependency: {offenders}"


def test_ports_mention_no_persistence() -> None:
    """The application layer's interface is where §1.1 is cheapest to break."""
    code = _code_text(PKG / "application" / "ports.py").lower()
    for needle in ("database", "session", "repository", "cursor", "broker"):
        assert needle not in code, (
            f"application/ports.py uses {needle!r} in code: the ACL persists "
            "nothing and its ports must not suggest otherwise (§1.1)"
        )


def test_the_only_outbound_port_is_the_domain_api() -> None:
    """Every dependency of the use case points at domain-api, nothing else."""
    commands = (PKG / "application" / "commands.py").read_text()
    tree = ast.parse(commands)
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
        elif isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
    infrastructure = [i for i in imports if "infrastructure" in i]
    assert infrastructure == [], (
        "the application layer must not import infrastructure directly: it "
        f"talks to the DomainApiPort only, got {infrastructure}"
    )


# ------------------------------------------------- single source of truth

def test_contract_is_imported_and_not_copied_into_the_app() -> None:
    """§12.6: the envelope/events live in packages/, never duplicated here."""
    assert (REPO_ROOT / "packages" / "finance-contracts" / "pyproject.toml").is_file(), (
        "packages/finance-contracts must exist: it is the single source of truth"
    )
    for path in python_files():
        text = path.read_text()
        assert "class CommandEnvelope" not in text, (
            f"{path.relative_to(APP_ROOT)} redefines the envelope; import it "
            "from finance_contracts instead (§7)"
        )
        assert "class SyncResult" not in text, (
            f"{path.relative_to(APP_ROOT)} redefines the /sync result"
        )


def test_installed_contract_is_not_a_copy_inside_the_app() -> None:
    """The contract is installed from packages/, not vendored under src/.

    It legitimately lands in site-packages (that is what the CI's
    ``pip install .../packages/finance-contracts`` does), so the assertion is
    that it does **not** come from this app's own tree -- a copy there is the
    duplication §7 forbids and the drift it causes is silent.
    """
    import finance_contracts

    location = Path(finance_contracts.__file__).resolve()
    assert SRC.resolve() not in location.parents, (
        f"finance_contracts was imported from inside the app ({location}); it "
        "must come from packages/finance-contracts"
    )


def test_installed_contract_matches_the_vendored_source() -> None:
    """A stale installed contract must fail here, not in production.

    This is the §11 risk ("build verde com contrato velho") caught locally:
    if someone edits packages/ and does not reinstall, the app is testing
    against a contract nobody ships.
    """
    import finance_contracts

    installed = sorted(Path(finance_contracts.__file__).resolve().parent.glob("*.py"))
    vendored_dir = REPO_ROOT / "packages" / "finance-contracts" / "src" / "finance_contracts"
    vendored = sorted(vendored_dir.glob("*.py"))
    assert [p.name for p in installed] == [p.name for p in vendored]
    for installed_file, vendored_file in zip(installed, vendored):
        assert installed_file.read_bytes() == vendored_file.read_bytes(), (
            f"the installed {installed_file.name} differs from "
            f"{vendored_file}: reinstall packages/finance-contracts"
        )


def test_no_action_string_literal_is_redefined_in_the_app() -> None:
    """Action names come from the contract, so a rename cannot half-land."""
    offenders: list[str] = []
    for path in python_files():
        text = path.read_text()
        # A literal "finance.<family>.<verb>" outside the shared package is a
        # private copy of the action namespace.
        for match in re.finditer(r'"finance\.[a-zA-Z.]+"', text):
            offenders.append(f"{path.relative_to(APP_ROOT)}: {match.group(0)}")
    assert offenders == [], (
        f"action names must be imported from finance_contracts: {offenders}"
    )
