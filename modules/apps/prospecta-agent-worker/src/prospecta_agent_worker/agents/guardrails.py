"""Guardrails de LGPD e política de envio (research R7, tasks T046/T064).

Três regras, todas aplicadas **antes** das ações que protegem:

1. **PII scrubbing antes do 9router.** Telefone e e-mail nunca viajam ao
   provider (nem aparecem completos em log/trace). ``scrub_text``/``scrub_payload``
   substituem por marcadores, recursivamente.
2. **Opt-out antes de todo envio.** ``check_send`` recusa quando o lead está na
   lista; o chamador publica ``MessageBlocked`` e **nunca contorna**.
3. **``policy.approval=human`` no MVP.** Sem ``MessageApproved``, nenhum envio
   automático sai -- ``check_send`` recusa.

O bloqueio é um ``SendBlocked`` (com ``code``), não um booleano: o chamador
distingue o motivo e o publica, em vez de silenciar.
"""

from __future__ import annotations

import re
from typing import Any

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# Um telefone brasileiro formatado pode ter +, espaços, parênteses, hífens.
# O que define é a contagem de DÍGITOS (>= 8): um ano ou um valor em reais não
# vira "[PHONE]".
_CANDIDATE_RE = re.compile(r"\+?\d[\d\s().\-]{7,}\d")


def _scrub_string(value: str) -> str:
    value = _EMAIL_RE.sub("[EMAIL]", value)

    def _replace(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        return "[PHONE]" if len(digits) >= 8 else match.group(0)

    return _CANDIDATE_RE.sub(_replace, value)


def scrub_text(value: str) -> str:
    """Redige telefone/e-mail completos de um texto."""
    return _scrub_string(value)


def scrub_payload(value: Any) -> Any:
    """Redige telefone/e-mail de um payload arbitrário, recursivamente.

    Dicts e listas são reconstruídos (não mutados) para o chamador nunca logar
    a estrutura original por engano.
    """
    if isinstance(value, str):
        return _scrub_string(value)
    if isinstance(value, dict):
        return {k: scrub_payload(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_payload(v) for v in value]
    return value


class SendBlocked(RuntimeError):
    """O envio não pode sair: opt-out ou falta de aprovação humana."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def check_send(*, approved: bool, opted_out: bool, approval_policy: str = "human") -> None:
    """Valida um envio. Levanta ``SendBlocked`` (nunca retorna um booleano).

    A ordem importa: com ``approval_policy=human`` e sem aprovação, o envio não
    sai nem para consultar opt-out. Com ``auto`` (Fase 2), a aprovação é
    dispensada, mas o opt-out continua valendo -- ele nunca é contornado.
    """
    if approval_policy == "human" and not approved:
        raise SendBlocked("approval_required", "policy.approval=human e a mensagem não está aprovada")
    if opted_out:
        raise SendBlocked("opt_out", "lead está na lista de opt-out")
