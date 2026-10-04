"""Gateway de saída do WhatsApp: a Evolution API.

A resposta sai por ``POST {base}/message/sendText/{instance}`` com header
``apikey`` e corpo ``{"number": "<E.164 sem +>", "text": ...}`` (Evolution
v2.3.7 — ver spec §5.3). O ``number`` é o ``remoteJid`` sem o sufixo
``@s.whatsapp.net``.
"""

from __future__ import annotations

import httpx


def jid_to_number(remote_jid: str, *, instance_owner_jid: str = "") -> str:
    """``"5521981962914@s.whatsapp.net"`` -> ``"5521981962914"``.

    O ``number`` que o Evolution aceita é o E.164 sem ``+`` e sem o domínio do
    JID. Um grupo (``@g.us``) não é um número e devolve o próprio JID sem
    sufixo — o envio é recusado pelo gateway, não aqui.
    """
    return remote_jid.split("@", 1)[0]


class EvolutionClient:
    def __init__(self, base_url: str, api_key: str, instance: str, *, timeout: float = 15.0) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._instance = instance
        self._timeout = timeout

    async def send_text(self, remote_jid: str, text: str) -> dict:
        """Envia um texto. Levanta em falha para o chamador decidir (§12.9)."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base}/message/sendText/{self._instance}",
                headers={"apikey": self._key, "Content-Type": "application/json"},
                json={"number": jid_to_number(remote_jid), "text": text},
            )
        if resp.status_code >= 300:
            raise RuntimeError(f"evolution sendText {resp.status_code}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError:
            return {}
