"""Gateway de saída do WhatsApp: a Evolution API.

**Porta fiel** do ``EvolutionClient`` de
``finance-customersupport-worker/gateway/evolution.py`` (research R5, tasks
T043): a resposta sai por ``POST {base}/message/sendText/{instance}`` com header
``apikey`` e corpo ``{"number": "<E.164 sem +>", "text": ...}`` (Evolution
v2.3.7). O ``number`` é o ``remoteJid`` sem o sufixo ``@s.whatsapp.net``.

Não reescrever semântica: as funções e o formato são os mesmos do worker
financeiro, que é a referência canônica. A diferença é o método *síncrono*
``send_text_sync`` -- o worker do Prospecta roda em loop síncrono (o bootstrap
fala com o broker por fora), então o envio é bloqueante para o chamador;
``asyncio.run`` sobre o mesmo ``send_text`` mantém uma única montagem de
request, sem duplicar URL/header/corpo.
"""

from __future__ import annotations

import asyncio
import base64

import httpx


def jid_to_number(remote_jid: str, *, instance_owner_jid: str = "") -> str:
    """``"5521981962914@s.whatsapp.net"`` -> ``"5521981962914"``.

    O ``number`` que o Evolution aceita é o E.164 sem ``+`` e sem o domínio do
    JID. Um grupo (``@g.us``) não é um número e devolve o próprio JID sem
    sufixo -- o envio é recusado pelo worker (guardrail), não aqui.
    """
    return remote_jid.split("@", 1)[0]


def phone_to_jid(number: str) -> str:
    """``"5521981962914"`` -> ``"5521981962914@s.whatsapp.net"``.

    Um JID já montado passa intacto; o inverso exato de ``jid_to_number`` para
    o caminho de resposta (recebemos o número, respondemos para o JID).
    """
    if "@" in number:
        return number
    return f"{number}@s.whatsapp.net"


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

    def send_text_sync(self, remote_jid: str, text: str) -> dict:
        """``send_text`` bloqueante -- o chamador (loop síncrono) espera o envio."""
        return asyncio.run(self.send_text(remote_jid, text))

    async def send_media(
        self, remote_jid: str, png: bytes, *, caption: str = "", filename: str = "grafico.png"
    ) -> dict:
        """Envia uma imagem (PNG) como mídia.

        ``POST /message/sendMedia/{instance}`` com a imagem em base64, header
        ``apikey``. Levanta em falha para o chamador decidir (§12.9).
        """
        encoded = base64.b64encode(png).decode("ascii")
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base}/message/sendMedia/{self._instance}",
                headers={"apikey": self._key, "Content-Type": "application/json"},
                json={
                    "number": jid_to_number(remote_jid),
                    "mediatype": "image",
                    "mimetype": "image/png",
                    "caption": caption,
                    "media": encoded,
                    "fileName": filename,
                },
            )
        if resp.status_code >= 300:
            raise RuntimeError(f"evolution sendMedia {resp.status_code}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError:
            return {}

    def send_media_sync(self, remote_jid: str, png: bytes, *, caption: str = "", filename: str = "grafico.png") -> dict:
        return asyncio.run(self.send_media(remote_jid, png, caption=caption, filename=filename))
