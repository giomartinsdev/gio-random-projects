"""Makes the vendored client importable as a top-level module, exactly as the
image installs it (see the Dockerfile)."""

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
