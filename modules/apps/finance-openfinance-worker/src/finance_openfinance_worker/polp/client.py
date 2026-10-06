"""Cliente HTTP do provedor de Open Finance (Polp / Celcoin v2) para o conector.

Cópia deliberada do cliente da ACL (não há pacote compartilhado de HTTP neste
repo, como o clubs-api/clubs-ingest também duplicam o seu): o conector é um
processo separado e não deve importar o código da ACL. O contrato é o mesmo —
headers ``x-api-client``/``x-api-secret`` e os endpoints de leitura.
"""

from __future__ import annotations

from typing import Any, Mapping

import httpx

DEFAULT_BASE_URL = "https://api.polp.com.br/api/v2"


class PolpError(RuntimeError):
    """O provedor recusou o pedido."""


class PolpClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 20.0,
        sandbox: bool = False,
        client: httpx.Client | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._prefix = "/sandbox" if sandbox else ""
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout_s)

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def _get(self, path: str, params: Mapping[str, str] | None = None) -> Mapping[str, Any]:
        resp = self._client.get(
            f"{self._prefix}{path}",
            headers={"x-api-client": self._client_id, "x-api-secret": self._client_secret},
            params=dict(params or {}),
        )
        if resp.status_code >= 300:
            raise PolpError(f"polp {resp.status_code}: {_short(resp)}")
        body = resp.json()
        return body if isinstance(body, Mapping) else {}

    def consents(self) -> list[Mapping[str, Any]]:
        return _data(self._get("/consents"))

    def consent_accounts(self, consent_id: str) -> list[Mapping[str, Any]]:
        return _data(self._get(f"/consents/{consent_id}/accounts"))

    def account_transactions(self, account_id: str, params: Mapping[str, str] | None = None) -> list[Mapping[str, Any]]:
        return _data(self._get(f"/accounts/{account_id}/transactions", params))

    # As cinco famílias de investimento do Open Finance (webhooks
    # ``investments``/``investments.transactions`` chegam por aqui). Ausência
    # (404 — consent sem o product, Sandbox sem rota) é lista vazia honesta.
    INVESTMENT_FAMILIES: tuple = (
        "bank-fixed-incomes",      # CDB, RDB, LCI, LCA
        "credit-fixed-incomes",    # Debêntures, CRI, CRA
        "funds",                   # Fundos de investimento
        "treasure-titles",         # Tesouro Direto
        "variable-incomes",        # Ações/BDR
    )

    def investments(self, consent_id: str, *, family: str | None = None) -> list[Mapping[str, Any]]:
        """Posições do consentimento, todas as famílias (ou uma específica)."""
        out: list[Mapping[str, Any]] = []
        families = (family,) if family else self.INVESTMENT_FAMILIES
        for fam in families:
            try:
                for item in _data(self._get(f"/consents/{consent_id}/{fam}")):
                    tagged = dict(item)
                    tagged["_family"] = fam
                    out.append(tagged)
            except PolpError as exc:
                if "404" in str(exc):
                    continue
                raise
        return out

    def investment_transactions(self, invest_id: str, *, family: str) -> list[Mapping[str, Any]]:
        """Movimentações de um ativo (aplicação/resgate/rendimento)."""
        try:
            return _data(self._get(f"/{family}/{invest_id}/transactions"))
        except PolpError as exc:
            if "404" in str(exc):
                return []
            raise

    # ----------------------------------------------------- "pegar tudo"
    # Cada recurso tem sua rota sob o consentimento. Ausência (404 — consent
    # sem o product, Sandbox sem rota) é lista vazia honesta, nunca erro.
    def _optional(self, path: str) -> list[Mapping[str, Any]]:
        try:
            return _data(self._get(path))
        except PolpError as exc:
            if "404" in str(exc):
                return []
            raise

    def credit_cards(self, consent_id: str) -> list[Mapping[str, Any]]:
        return self._optional(f"/consents/{consent_id}/credit-cards")

    def bills(self, credit_card_id: str) -> list[Mapping[str, Any]]:
        """Faturas de um cartão (a doc põe as faturas sob o cartão)."""
        return self._optional(f"/credit-cards/{credit_card_id}/bills")

    def loans(self, consent_id: str) -> list[Mapping[str, Any]]:
        return self._optional(f"/consents/{consent_id}/loans")

    def financings(self, consent_id: str) -> list[Mapping[str, Any]]:
        return self._optional(f"/consents/{consent_id}/financings")

    def exchanges(self, consent_id: str) -> list[Mapping[str, Any]]:
        return self._optional(f"/consents/{consent_id}/exchanges")

    # Saldos reservados por conta (nem toda conta tem; 404 é vazio).
    def account_reserved_balances(self, account_id: str) -> list[Mapping[str, Any]]:
        return self._optional(f"/accounts/{account_id}/reserved-balances")


def _short(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, Mapping):
            return str(body.get("message") or body.get("error") or resp.status_code)
    except ValueError:
        pass
    return str(resp.status_code)


def _data(body: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    data = body.get("data")
    if isinstance(data, list):
        return [d for d in data if isinstance(d, Mapping)]
    return []
