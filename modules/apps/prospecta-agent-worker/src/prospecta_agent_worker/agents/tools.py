"""Tools de busca, raspagem e enriquecimento (research R3, tasks T036).

Cada tool é um **adapter isolado**: um contrato fixo por dentro, um provedor
trocável por trás. O provedor concreto (SerpAPI vs Brave, Clearbit vs Apollo vs
CNPJ) é decisão de orçamento (T036); aqui a interface é o que fica travado e o
adapter é o que absorve a diferença.

Três regras de guardrail, todas no caminho da tool e não do chamador:

1. **`web.search`** fala HTTP com o provedor e **normaliza** para
   ``[{title,url,snippet}]``. Um 5xx persistente levanta ``ToolError`` -- nunca
   devolve lista vazia que parece "zero resultados".
2. **`web.scrape`** só lê página **pública**: consulta o ``robots.txt`` do
   domínio e recusa o que é proibido (``RobotsDisallowed``). Respeita rate-limit
   por domínio e manda user-agent identificável.
3. **`enrich.company`** normaliza o provedor para um ``enriched{}`` estável.

Cada um é testável contra um upstream HTTP real em container: o que se prova é a
travessia de rede, a normalização e a regra de robots.
"""

from __future__ import annotations

import asyncio
import logging
import time
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

log = logging.getLogger("prospecta-agent-worker")

# User-agent identificável: a web pode nos bloquear nominalmente, não por IP
# anônimo (research R3).
USER_AGENT = "ProspectaAgent/0.1 (+https://prospecta.giomartins.dev/bot)"


class ToolError(RuntimeError):
    """A tool não devolveu um resultado utilizável (upstream esgotou/negou)."""


class RobotsDisallowed(ToolError):
    """O ``robots.txt`` do domínio proíbe a leitura pedida."""


class _TextExtractor(HTMLParser):
    """Extrai texto visível e o ``<title>`` de um HTML, sem dependência externa."""

    _SKIP = frozenset({"script", "style", "noscript", "template"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self.title = ""

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self._chunks.append(text)

    def text(self) -> str:
        return " ".join(self._chunks)


def _extract_html(html: str) -> dict:
    parser = _TextExtractor()
    parser.feed(html)
    return {"text": parser.text(), "meta": {"title": parser.title.strip()}}


class WebSearch:
    """`web.search`: `query → [{title,url,snippet}]`."""

    def __init__(
        self,
        *,
        base_url: str,
        provider: str = "brave",
        api_key: str = "",
        timeout: float = 15.0,
        max_attempts: int = 3,
        backoff: float = 0.5,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._provider = provider.lower()
        self._key = api_key
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff = backoff

    async def search(self, query: str, *, limit: int = 10) -> list[dict]:
        # Sem chave o provedor não tem como autenticar: degrada honesto para
        # zero resultados, com WARN, em vez de bater numa API que negará (T036).
        # Não inventa resultado nenhum.
        if not self._key:
            log.warning("busca não configurada (SEARCH_API_KEY vazia); devolvendo 0 resultados")
            return []
        url, params, headers = self._request(query, limit)
        last_error = "sem tentativa"
        for attempt in range(self._max_attempts):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.get(url, params=params, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"transporte: {exc}"
            else:
                if resp.status_code < 300:
                    return self._normalize(resp)
                if resp.status_code < 500:
                    raise ToolError(f"web.search {resp.status_code}: {resp.text[:200]}")
                last_error = f"{resp.status_code}: {resp.text[:200]}"
            if attempt < self._max_attempts - 1:
                await asyncio.sleep(self._backoff * (2**attempt))
        raise ToolError(f"web.search esgotou {self._max_attempts} tentativas: {last_error}")

    def _request(self, query: str, limit: int):
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if self._provider == "serpapi":
            params = {"q": query, "num": limit, "api_key": self._key}
            return f"{self._base}/search", params, headers
        headers["X-Subscription-Token"] = self._key
        params = {"q": query, "count": limit}
        return f"{self._base}/res/v1/web/search", params, headers

    def _normalize(self, resp: httpx.Response) -> list[dict]:
        try:
            body = resp.json()
        except ValueError as exc:
            raise ToolError(f"web.search devolveu corpo não-JSON: {resp.text[:200]}") from exc
        if self._provider == "serpapi":
            raw = body.get("organic_results") or []
            return [
                {"title": r.get("title", ""), "url": r.get("link", ""), "snippet": r.get("snippet", "")}
                for r in raw
                if isinstance(r, dict)
            ]
        raw = (body.get("web") or {}).get("results") or []
        return [
            {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("description", "")}
            for r in raw
            if isinstance(r, dict)
        ]


class WebScrape:
    """`web.scrape`: `url → {text, meta}` -- só página pública."""

    def __init__(
        self,
        *,
        timeout: float = 15.0,
        min_interval: float = 0.0,
        user_agent: str = USER_AGENT,
    ) -> None:
        self._timeout = timeout
        self._min_interval = min_interval
        self._ua = user_agent
        self._last_request: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def fetch(self, url: str) -> dict:
        origin = _origin(url)
        await self._throttle(origin)
        await self._check_robots(url)
        await self._throttle(origin)
        async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": self._ua, "Accept": "text/html"})
        if resp.status_code >= 300:
            raise ToolError(f"web.scrape {resp.status_code}: {resp.text[:200]}")
        return _extract_html(resp.text)

    async def _check_robots(self, url: str) -> None:
        robots_url = f"{_origin(url)}/robots.txt"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.get(robots_url, headers={"User-Agent": self._ua})
            except httpx.HTTPError:
                return  # robots.txt inacessível não vira proibição inventada
        if resp.status_code == 404:
            return
        if resp.status_code >= 300:
            raise ToolError(f"robots.txt {resp.status_code}: {resp.text[:200]}")
        parser = RobotFileParser()
        parser.parse(resp.text.splitlines())
        if not parser.can_fetch(self._ua, url):
            raise RobotsDisallowed(f"robots.txt proíbe {url}")

    async def _throttle(self, origin: str) -> None:
        if self._min_interval <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            last = self._last_request.get(origin, 0.0)
            wait = self._min_interval - (now - last)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request[origin] = time.monotonic()


class EnrichCompany:
    """`enrich.company`: `domain/name → enriched{}` (normalizado, estável)."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        timeout: float = 15.0,
        max_attempts: int = 3,
        backoff: float = 0.5,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff = backoff

    async def enrich(self, domain: str) -> dict:
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        url = f"{self._base}/v1/companies/find"
        last_error = "sem tentativa"
        for attempt in range(self._max_attempts):
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.get(url, params={"domain": domain}, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"transporte: {exc}"
            else:
                if resp.status_code < 300:
                    return self._normalize(resp, domain)
                if resp.status_code < 500:
                    raise ToolError(f"enrich.company {resp.status_code}: {resp.text[:200]}")
                last_error = f"{resp.status_code}: {resp.text[:200]}"
            if attempt < self._max_attempts - 1:
                await asyncio.sleep(self._backoff * (2**attempt))
        raise ToolError(f"enrich.company esgotou {self._max_attempts} tentativas: {last_error}")

    def _normalize(self, resp: httpx.Response, domain: str) -> dict:
        try:
            body = resp.json()
        except ValueError as exc:
            raise ToolError(f"enrich.company devolveu corpo não-JSON: {resp.text[:200]}") from exc
        return {
            "domain": body.get("domain") or domain,
            "company_name": body.get("name") or body.get("company_name") or "",
            "decisor": body.get("decision_maker") or body.get("decisor") or "",
            "email": body.get("email") or "",
            "cnpj": body.get("cnpj") or "",
            "segment": body.get("segment") or "",
        }


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"
