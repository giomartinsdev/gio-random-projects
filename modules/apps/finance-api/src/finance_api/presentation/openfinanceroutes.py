"""Rotas do Open Finance na ACL (§7 da spec).

- ``GET /openfinance/institutions`` — proxy à lista pública do provedor (cache curto).
- ``POST /openfinance/consents`` — conecta uma conta: cria no provedor, publica
  o comando e devolve a URL do banco.
- ``POST /openfinance/consents/{id}/refresh`` — relê o status (o SPA chama ao voltar do banco).
- ``DELETE /openfinance/consents/{id}`` — revoga.
- ``GET /openfinance/consents`` / ``accounts`` — leem o estado aplicado (§4.2).
- ``POST /openfinance/webhooks/polp`` (§2.6, fase 2) — recebe o push do provedor
  e dá um "poke" no conector (porta ``/tick``), que relê a API e publica os
  comandos de transação. Sem assinatura HMAC documentada no Polp: o webhook é
  *dica de frescor* — a validação é o segredo no caminho, e o dado real vem
  sempre da releitura da API (nunca do corpo do push).
"""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from finance_api.application.openfinance import OpenFinanceService
from finance_api.domain.errors import DomainApiError, ValidationError
from finance_api.presentation.dependencies import Container, get_container, require_session
from finance_api.presentation.session import Session


openfinance_router = APIRouter(prefix="/openfinance")


def get_of(container: Container = Depends(get_container)) -> OpenFinanceService:
    if container.openfinance is None:  # pragma: no cover - wiring bug
        raise RuntimeError("Open Finance não configurado")
    return container.openfinance


def user_id_of(session: Session = Depends(require_session)) -> str:
    if not session.phone:
        raise ValidationError("vincule seu número do WhatsApp antes de conectar")
    return session.phone


@openfinance_router.get("/institutions")
def list_institutions(
    q: str = "",
    _: str = Depends(user_id_of),
    of: OpenFinanceService = Depends(get_of),
) -> JSONResponse:
    try:
        items = of.institutions(query=q)
    except DomainApiError as exc:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})
    # Só os campos que o SPA usa — não repassar o corpo inteiro do provedor.
    lean = [
        {
            "id": str(i.get("id", "")),
            "name": str(i.get("name", "")),
            "logo_url": i.get("logo_url"),
            "status": str(i.get("status", "")),
            "type": str(i.get("type", "")),
        }
        for i in items
    ]
    return JSONResponse(status_code=200, content={"institutions": lean})


@openfinance_router.post("/consents")
def connect(
    body: dict,
    user_id: str = Depends(user_id_of),
    of: OpenFinanceService = Depends(get_of),
) -> JSONResponse:
    try:
        result = of.connect(
            user_id=user_id,
            institution_id=str(body.get("institution_id", "")),
            cpf=str(body.get("cpf", "")),
            cnpj=str(body.get("cnpj", "") or ""),
            institution_name=str(body.get("institution_name", "") or ""),
        )
    except ValidationError as exc:
        return JSONResponse(status_code=422, content={"error": exc.message})
    except DomainApiError as exc:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})
    return JSONResponse(
        status_code=201,
        content={
            "consent_id": result.consent_id,
            "status": result.status,
            "url_to_authenticate": result.url_to_authenticate,
            "institution_name": result.institution_name,
        },
    )


@openfinance_router.post("/consents/{consent_id}/refresh")
def refresh(
    consent_id: str,
    _: str = Depends(user_id_of),
    of: OpenFinanceService = Depends(get_of),
) -> JSONResponse:
    try:
        of.refresh(polp_consent_id=consent_id)
    except DomainApiError as exc:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})
    return JSONResponse(status_code=202, content={"status": "accepted"})


@openfinance_router.delete("/consents/{consent_id}")
def revoke(
    consent_id: str,
    _: str = Depends(user_id_of),
    of: OpenFinanceService = Depends(get_of),
) -> JSONResponse:
    try:
        of.revoke(polp_consent_id=consent_id)
    except DomainApiError as exc:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})
    return JSONResponse(status_code=202, content={"status": "accepted"})


@openfinance_router.post("/webhooks/polp/{secret_path}")
async def polp_webhook(
    secret_path: str,
    request: Request,
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Push do provedor (§2.6): *dica de frescor*, nunca dado — mesmo com HMAC.

    Duas camadas de validação:
    - Segredo no caminho (``OF_TICK_SECRET``, comparação constante) — quem não
      sabe recebe 404, sem vazar que a rota existe.
    - ``X-Webhook-Signature`` (HMAC-SHA256 do corpo cru) — a chave vem do cofre
      (``POLP_OF_WEBHOOK_SIGN_KEY``, ponte Vaultwarden). Header presente:
      assinatura é OBRIGATÓRIA e conferida com ``compare_digest``; push
      falsificado é 404 e não toca o conector. Header ausente (assim que o
      portal entrega docs de assinatura variável): aceito como frescor, porque
      o dado real vem da releitura da API.

    O corpo nunca alimenta o ledger: o "poke" manda o conector reler a API
    (mesma leitura do poll, acionada sob demanda — a compra chega em segundos).
    """
    import hashlib
    import hmac as _hmac
    from secrets import compare_digest as _timing_safe

    def _env(name: str) -> str:
        # variáveis de stack (não-cofre): só estas duas existem aqui
        import os

        return os.environ.get(name) or ""

    sign_key = container.of_webhook_sign_key or ""
    secret = container.of_webhook_secret or _env("OF_TICK_SECRET") or ""
    if (not secret) or (not secret_path) or (not _timing_safe(secret, secret_path)):
        return JSONResponse(status_code=404, content={"error": "not found"})

    signature = (request.headers.get("x-webhook-signature") or "").strip()
    if signature:
        if not sign_key:
            # assinatura chegou sem chave configurada: não validar é aceitar
            # FALSIFICAÇÃO. O provedor documentou que assina; sem chave a
            # entrega é recusada (o poll cobre).
            return JSONResponse(status_code=404, content={"error": "not found"})
        body_bytes = await request.body()
        expected = _hmac.new(sign_key.encode(), body_bytes, hashlib.sha256).hexdigest()
        if not _timing_safe(expected, signature.lower()):
            return JSONResponse(status_code=404, content={"error": "not found"})

    base = container.of_tick_base_url or _env("OF_TICK_BASE_URL") or ""
    if not base:
        return JSONResponse(status_code=202, content={"status": "accepted", "mode": "poll-only"})
    try:
        r = httpx.post(f"{base}/tick/{secret}", timeout=10.0)
        if r.status_code == 200:
            return JSONResponse(status_code=202, content={"status": "accepted", "mode": "tick"})
        return JSONResponse(status_code=202, content={"status": "accepted", "mode": "poll-fallback"})
    except httpx.HTTPError:
        return JSONResponse(status_code=202, content={"status": "accepted", "mode": "poll-fallback"})
