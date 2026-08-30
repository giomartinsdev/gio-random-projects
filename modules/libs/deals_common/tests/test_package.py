"""The package's import contract: deals_common (and the announcer's
announce/telemetry paths through it) import fine in an env whose only
extras are opentelemetry — scrapling stays scrapers-only. The CI env
caught this live: a non-lazy `from .fetch import HttpClient` in
__init__ exploded the events-announcer's test env."""

import subprocess
import sys

# `None` in sys.modules makes `import scrapling` raise ImportError —
# a stand-in for an env where the package was never installed.
_BLOCK = (
    "import sys; "
    "sys.modules['scrapling'] = None; "
    "sys.modules['curl_cffi'] = None; "
    "import deals_common; "
    "from deals_common.announce import render; "  # noqa: F401  (import is the assertion)
    "from deals_common.telemetry import counter; "  # noqa: F401
    "assert deals_common.DealsClient; "
    "print('import-ok')\n"
)


def test_package_imports_without_scrapling():
    proc = subprocess.run(
        [sys.executable, "-c", _BLOCK],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "import-ok" in proc.stdout


def test_httpclient_still_resolves_through_the_package():
    import deals_common
    from deals_common.fetch import HttpClient

    # both spellings keep working: submodule import and __getattr__
    assert deals_common.HttpClient is HttpClient