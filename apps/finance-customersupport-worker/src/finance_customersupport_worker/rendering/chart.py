"""Motor de gráfico PNG do worker (§5.2/§12.4).

Render determinístico e SEM dependência de plotagem: um PNG é escrito à mão
(assinatura + IHDR + IDAT via ``zlib`` da stdlib + IEND), o que mantém o worker
leve e o resultado reproduzível — o golden test compara as dimensões e as
séries desenhadas, não bytes de uma lib que muda de versão.

O gráfico é o fluxo de caixa do mês: uma barra por dia, verde para o saldo do
dia >= 0 e vermelho para < 0, normalizadas pelo maior valor absoluto. Sem
aleatoriedade: a mesma projeção produz sempre a mesma imagem.
"""

from __future__ import annotations

import struct
import zlib
from typing import Mapping, Sequence

# Dimensões fixas (§12.4): o teste de golden compara estas com o header IHDR.
WIDTH = 720
HEIGHT = 320
_BG = (255, 255, 255)
_AXIS = (180, 184, 190)
_POS = (16, 163, 74)      # verde: saldo do dia >= 0
_NEG = (220, 38, 38)      # vermelho: saldo do dia < 0
_PAD = 24


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _png(width: int, height: int, pixels: Sequence[bytearray]) -> bytes:
    """Monta um PNG RGB de 8 bits a partir de scanlines (uma por linha)."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filtro "None" em cada scanline
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


def _canvas(width: int, height: int) -> list[bytearray]:
    row = bytearray()
    for _ in range(width):
        row.extend(_BG)
    return [bytearray(row) for _ in range(height)]


def _fill_rect(canvas: list[bytearray], x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int]) -> None:
    x0, x1 = max(0, x0), min(len(canvas[0]) // 3, x1)
    y0, y1 = max(0, y0), min(len(canvas), y1)
    for y in range(y0, y1):
        row = canvas[y]
        for x in range(x0, x1):
            base = x * 3
            row[base] = color[0]
            row[base + 1] = color[1]
            row[base + 2] = color[2]


def _as_cents(value: object) -> int:
    """``"1.234,50"``/``"-95.00"`` -> centavos (int). Nunca float (§3.4)."""
    from decimal import Decimal

    return int((Decimal(str(value)) * 100).to_integral_value())


def bars_for(history: Mapping[str, object]) -> list[int]:
    """A série desenhada: o saldo (``net``) de cada dia, em centavos.

    Público porque o golden test compara a SÉRIE, não os pixels.
    """
    days = history.get("days") or []
    if not isinstance(days, (list, tuple)):
        return []
    out: list[int] = []
    for day in days:
        if isinstance(day, Mapping):
            out.append(_as_cents(day.get("net", "0")))
    return out


def render_cash_flow_png(history: Mapping[str, object]) -> bytes:
    """Desenha o fluxo de caixa do mês e devolve os bytes do PNG."""
    series = bars_for(history)
    canvas = _canvas(WIDTH, HEIGHT)

    plot_top, plot_bottom = _PAD, HEIGHT - _PAD
    plot_left, plot_right = _PAD, WIDTH - _PAD
    mid = (plot_top + plot_bottom) // 2
    # Linha do zero (base de comparação).
    _fill_rect(canvas, plot_left, mid, plot_right, mid + 1, _AXIS)

    if not series:
        return _png(WIDTH, HEIGHT, canvas)

    peak = max((abs(v) for v in series), default=0) or 1
    half = (plot_bottom - plot_top) // 2 - 4
    n = len(series)
    gap = 4
    slot = max(1, (plot_right - plot_left) // n)
    bar_w = max(1, slot - gap)

    for i, value in enumerate(series):
        x0 = plot_left + i * slot + gap // 2
        x1 = x0 + bar_w
        span = int(half * min(abs(value), peak) / peak)
        if value >= 0:
            y0, y1 = mid - span, mid
            color = _POS
        else:
            y0, y1 = mid, mid + span
            color = _NEG
        _fill_rect(canvas, x0, y0, x1, max(y1, y0 + 1), color)

    return _png(WIDTH, HEIGHT, canvas)
