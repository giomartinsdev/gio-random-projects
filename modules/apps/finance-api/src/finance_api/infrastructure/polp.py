"""Cliente HTTP do provedor de Open Finance (Polp / Celcoin v2).

Único lugar que fala com o Polp. Espelha o desenho do ``domain_api.py``: um
``httpx.Client`` injetável (os testes passam um ``MockTransport``), tradução de
erros do provedor para erros da casa, e a chave nunca aparece em mensagem.

Contrato conferido em polp.com.br/docs/celcoin (2026-10-04):
- auth por header ``x-api-client`` (client id) + ``x-api-secret``;
- ``GET /institutions`` é pública;
- 401 credenciais · 402 plano/fatura (inclui ``payment_url``) · 403 conta pendente.
- sandbox: mesmo contrato, prefixo ``/sandbox``.
"""

from __future__ import annotations

from typing import Any, Final, Mapping

import httpx

from finance_api.domain.errors import DomainApiError

CLIENT_HEADER: Final = "x-api-client"
SECRET_HEADER: Final = "x-api-secret"
DEFAULT_BASE_URL: Final = "https://api.polp.com.br/api/v2"


class PolpError(DomainApiError):
    """O provedor recusou o pedido (4xx/5xx documentado). 502: não é o chamador."""

    status = 502


class PolpNotConfigured(DomainApiError):
    """Sem credenciais do Polp, o Open Finance fica desligado."""

    status = 503


class PolpClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 15.0,
        sandbox: bool = False,
        client: httpx.Client | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        # sandbox usa o MESMO contrato sob o prefixo /sandbox (dados fictícios,
        # sem plano) — é como os testes rodam sem tocar dinheiro real. O prefixo
        # entra no CAMINHO (não no base_url) para valer também quando um client
        # injetado já tem base_url.
        self._base = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._prefix = "/sandbox" if sandbox else ""
        self._timeout = timeout_s
        self._client = client or httpx.Client(base_url=self._base, timeout=timeout_s)

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def _headers(self) -> dict[str, str]:
        return {CLIENT_HEADER: self._client_id, SECRET_HEADER: self._client_secret}

    # ------------------------------------------------------------ leituras

    def institutions(self, page: int = 1) -> list[Mapping[str, Any]]:
        """GET /institutions (pública). Devolve a lista de instituições."""
        body = self._request("GET", "/institutions", params={"page": page})
        return _data_list(body)

    def consents(self) -> list[Mapping[str, Any]]:
        body = self._request("GET", "/consents")
        return _data_list(body)

    def consent(self, consent_id: str) -> Mapping[str, Any]:
        return self._request("GET", f"/consents/{consent_id}")

    def consent_accounts(self, consent_id: str) -> list[Mapping[str, Any]]:
        body = self._request("GET", f"/consents/{consent_id}/accounts")
        return _data_list(body)

    def account_transactions(self, account_id: str, params: Mapping[str, str] | None = None) -> list[Mapping[str, Any]]:
        body = self._request("GET", f"/accounts/{account_id}/transactions", params=dict(params or {}))
        return _data_list(body)

    # ------------------------------------------------------------- escritas

    def create_consent(self, *, institution_id: str, cpf: str, cnpj: str = "", user_id: str = "", products: list[str] | None = None) -> Mapping[str, Any]:
        payload: dict[str, Any] = {
            "institution_id": institution_id,
            "cpf": cpf,
            "cliente_user_id": user_id or None,
            "products": products or ["ACCOUNT"],
            "avoidDuplicates": True,
        }
        if cnpj:
            payload["cnpj"] = cnpj
        return self._request("POST", "/consents", json=payload)

    def revoke_consent(self, consent_id: str) -> None:
        self._request("DELETE", f"/consents/{consent_id}")

    # ------------------------------------------------------------- helpers

    def _request(self, method: str, path: str, **kwargs: Any) -> Mapping[str, Any]:
        if not self.configured:
            raise PolpNotConfigured("Open Finance não configurado (POLP_OF_CLIENT_ID/SECRET)")
        try:
            resp = self._client.request(method, f"{self._prefix}{path}", headers=self._headers(), **kwargs)
        except httpx.TimeoutException as exc:
            raise DomainApiError("o provedor de Open Finance não respondeu a tempo") from exc
        except httpx.HTTPError as exc:
            raise DomainApiError(f"não consegui falar com o provedor de Open Finance: {type(exc).__name__}") from exc

        if resp.status_code >= 300:
            raise PolpError(_provider_error(resp))
        try:
            parsed = resp.json()
        except ValueError:
            return {}
        if not isinstance(parsed, Mapping):
            return {}
        # O Polp embrulha objetos em ``{"data": {...}}`` (o show do consentimento
        # e o create devolvem o objeto lá dentro; as listagens também usam
        # ``data`` como array). Desembrulha o objeto para o chamador não precisar
        # saber do envelope — foi exatamente o que fez o create não achar o `id`.
        inner = parsed.get("data")
        if isinstance(inner, Mapping):
            return inner
        return parsed


def _provider_error(resp: httpx.Response) -> str:
    """Mensagem do provedor SEM vazar o secret (só o corpo, que nunca o contém)."""
    try:
        body = resp.json()
    except ValueError:
        return f"provedor de Open Finance respondeu {resp.status_code}"
    if isinstance(body, Mapping):
        msg = body.get("message") or body.get("error")
        if msg:
            return f"provedor de Open Finance: {msg}"
    return f"provedor de Open Finance respondeu {resp.status_code}"


def _data_list(body: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    data = body.get("data")
    if isinstance(data, list):
        return [d for d in data if isinstance(d, Mapping)]
    return []
