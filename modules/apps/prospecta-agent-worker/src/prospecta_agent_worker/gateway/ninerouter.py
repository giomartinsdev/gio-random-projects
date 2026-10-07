"""Cliente do 9router -- a ÚNICA porta de IA do worker (research R2).

Interface OpenAI-compatible: ``POST {base}/chat/completions``, base
``https://ai.giomartins.dev/v1``. O corpo é ``{"model","messages","stream":false}``
e o header ``Authorization: Bearer {key}`` só vai se a chave estiver
configurada (``REQUIRE_API_KEY=false`` hoje, mas o cliente respeita o Vault).

Política de falha: timeout curto + retry com backoff exponencial em 5xx e erro
de transporte. Um 5xx **persistente** esgota as tentativas e levanta -- o run
decide a falha e a fila não trava (nunca loop infinito). 4xx não é retentável:
um pedido malformado/credencial errada repetido falha igual.

Um 4xx/5xx e um corpo sem ``choices`` nunca viram um completion "vazio" que
parece sucesso: levantam ``NineRouterError``.
"""

from __future__ import annotations

import asyncio
import time

import httpx


class NineRouterError(RuntimeError):
    """O 9router não devolveu um completion utilizável (esgotou retries ou 4xx)."""


class NineRouterClient:
    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        *,
        timeout: float = 15.0,
        max_attempts: int = 3,
        backoff: float = 0.5,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff = backoff

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        return headers

    async def complete(self, model: str, messages: list[dict], *, stream: bool = False) -> dict:
        """Pede um completion. Levanta ``NineRouterError`` em falha persistente."""
        url = f"{self._base}/chat/completions"
        body = {"model": model, "messages": messages, "stream": stream}
        last_error = "sem tentativa"
        for attempt in range(self._max_attempts):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(url, headers=self._headers(), json=body)
            except httpx.HTTPError as exc:
                last_error = f"transporte: {exc}"
            else:
                if resp.status_code < 300:
                    return _completion(resp)
                if resp.status_code < 500:
                    raise NineRouterError(f"9router {resp.status_code}: {resp.text[:200]}")
                last_error = f"{resp.status_code}: {resp.text[:200]}"
            if attempt < self._max_attempts - 1:
                await asyncio.sleep(self._backoff * (2**attempt))
        raise NineRouterError(f"9router esgotou {self._max_attempts} tentativas: {last_error}")

    def complete_sync(self, model: str, messages: list[dict], *, stream: bool = False) -> dict:
        return asyncio.run(self.complete(model, messages, stream=stream))


def _completion(resp: httpx.Response) -> dict:
    try:
        parsed = resp.json()
    except ValueError as exc:
        raise NineRouterError(f"9router devolveu corpo não-JSON: {resp.text[:200]}") from exc
    if not isinstance(parsed, dict) or not parsed.get("choices"):
        raise NineRouterError(f"9router devolveu completion sem choices: {str(parsed)[:200]}")
    return parsed
