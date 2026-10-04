"""Golden tests do motor de gráfico PNG (§12.4).

O PNG é montado à mão (stdlib ``zlib``), então é reproduzível: o teste compara
as DIMENSÕES do header IHDR e a SÉRIE desenhada (``bars_for``), não bytes — a
mesma escolha da spec para não quebrar a cada versão de biblioteca.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_whatsapp_worker.rendering import chart


HISTORY = {
    "user_id": "55", "month": "2026-10", "currency": "BRL",
    "days": [
        {"date": "2026-10-02", "income": "100.00", "expense": "-10.00", "net": "90.00"},
        {"date": "2026-10-04", "income": "0.00", "expense": "-30.00", "net": "-30.00"},
    ],
}


def _ihdr_width_height(png: bytes) -> tuple[int, int]:
    # assinatura (8) + length (4) + "IHDR" (4) = 16; então width/height.
    width, height = struct.unpack(">II", png[16:24])
    return width, height


def test_png_is_a_valid_png_with_fixed_dimensions():
    png = chart.render_cash_flow_png(HISTORY)
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert _ihdr_width_height(png) == (chart.WIDTH, chart.HEIGHT)


def test_png_is_deterministic():
    assert chart.render_cash_flow_png(HISTORY) == chart.render_cash_flow_png(HISTORY)


def test_bars_series_is_the_daily_net_in_cents():
    assert chart.bars_for(HISTORY) == [9000, -3000]


def test_png_renders_without_data():
    # Mês sem dados continua sendo um PNG válido (borda §12.4).
    png = chart.render_cash_flow_png({"days": []})
    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert chart.bars_for({"days": []}) == []
