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
import re
import time
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx

log = logging.getLogger("prospecta-agent-worker")

# User-agent identificável: a web pode nos bloquear nominalmente, não por IP
# anônimo (research R3).
USER_AGENT = "ProspectaAgent/0.1 (+https://prospecta.giomartins.dev/bot)"

# CDNs (Akamai, Cloudflare) fingerprintam o handshake TLS/HTTP2: httpx leva 403
# mesmo com os headers certos. `curl_cffi` impersona o Chrome e passa -- a mesma
# técnica do `clubs-ingest` (fc27_api.py). É opcional: quando não está instalado,
# o transporte cai para httpx (páginas abertas seguem funcionando).
# `_HAS_CURL_CFFI` é cacheado; os testes o resetam para provar os dois ramos.
_HAS_CURL_CFFI: bool | None = None


def _has_curl_cffi() -> bool:
    global _HAS_CURL_CFFI
    if _HAS_CURL_CFFI is None:
        try:
            import importlib

            importlib.import_module("curl_cffi.requests")
            _HAS_CURL_CFFI = True
        except ImportError:
            _HAS_CURL_CFFI = False
    return _HAS_CURL_CFFI


def _curl_cffi():
    import curl_cffi.requests as cffi_requests

    return cffi_requests


class _ImpersonatedResponse:
    """Resposta do curl_cffi (síncrono) com a mesma cara da do httpx.

    O resto do código só toca ``status_code``/``text`` -- normalizar aqui evita
    espalhar o ramo do transporte por toda a tool.
    """

    __slots__ = ("status_code", "text")

    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text

    def json(self):
        import json as _json

        return _json.loads(self.text)


def _transport_error_types() -> tuple[type[BaseException], ...]:
    """As exceções de transporte que o fetch deve degradar (não levantar cru)."""
    errors: list[type[BaseException]] = [httpx.HTTPError, OSError]
    if _has_curl_cffi():
        errors.append(_curl_cffi().exceptions.CurlError)
    return tuple(errors)


async def _transport_get(
    url: str, *, headers: dict, timeout: float, follow_redirects: bool = True
):
    """GET com o melhor transporte disponível.

    Com ``curl_cffi`` instalado, impersona um Chrome (síncrono, via
    ``asyncio.to_thread`` -- nunca a API async do curl_cffi, que muda entre
    versões). Sem ele, usa httpx (async).
    """
    if _has_curl_cffi():
        cffi_requests = _curl_cffi()

        def _sync():
            resp = cffi_requests.get(
                url, headers=headers, timeout=timeout, impersonate="chrome"
            )
            return _ImpersonatedResponse(resp.status_code, resp.text)

        return await asyncio.to_thread(_sync)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=follow_redirects) as client:
        return await client.get(url, headers=headers)


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
        # Não inventa resultado nenhum. `searxng` é LOCAL e não exige chave --
        # mas exige uma base configurada; sem base, também degrada com WARN.
        if self._provider == "searxng":
            if not self._base:
                log.warning("busca searxng sem SEARCH_API_URL; devolvendo 0 resultados")
                return []
        elif not self._key:
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
        if self._provider == "searxng":
            # SearXNG próprio: GET /search?q=...&format=json&safesearch=0.
            params = {"q": query, "format": "json", "safesearch": "0"}
            return f"{self._base}/search", params, headers
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
        if self._provider == "searxng":
            raw = body.get("results") or []
            return [
                {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")}
                for r in raw
                if isinstance(r, dict)
            ]
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
        resp = await _transport_get(
            url, headers={"User-Agent": self._ua, "Accept": "text/html"}, timeout=self._timeout
        )
        if resp.status_code >= 300:
            raise ToolError(f"web.scrape {resp.status_code}: {resp.text[:200]}")
        return _extract_html(resp.text)

    async def _check_robots(self, url: str) -> None:
        robots_url = f"{_origin(url)}/robots.txt"
        try:
            resp = await _transport_get(
                robots_url, headers={"User-Agent": self._ua}, timeout=self._timeout
            )
        except _transport_error_types():
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
    """`enrich.company`: `domain/name → enriched{}` (normalizado, estável).

    Dois provedores, escolhidos por ``provider``:

    - ``http`` (default antigo): fala um ``/v1/companies/find?domain=`` genérico.
    - ``cnpj`` (LOCAL, sem chave): baixa o site do domínio (mesmo transporte do
      ``web.scrape``: curl_cffi/httpx), extrai e-mail e CNPJ por regex e o
      ``<title>`` como nome provável; com CNPJ em mãos, consulta a Receita
      (``publica.cnpj.ws``) por razão social, situação, CNAE, município/UF e
      sócios. O que não veio fica ``""`` -- nunca inventa.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        provider: str = "http",
        cnpj_url: str = "https://publica.cnpj.ws/cnpj",
        timeout: float = 15.0,
        max_attempts: int = 3,
        backoff: float = 0.5,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._provider = provider.lower()
        self._cnpj_url = cnpj_url.rstrip("/")
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff = backoff

    async def enrich(self, domain: str) -> dict:
        if self._provider == "cnpj":
            return await self._enrich_cnpj(domain)
        return await self._enrich_http(domain)

    # ---------------------------------------------------------------- http
    async def _enrich_http(self, domain: str) -> dict:
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

    # ---------------------------------------------------------------- cnpj
    async def _enrich_cnpj(self, domain: str) -> dict:
        """Enriquecimento LOCAL por domínio, sem chave.

        Tolerante por construção: site fora do ar ou sem CNPJ não levanta --
        devolve o que conseguiu (vazio quando nada) e loga em INFO. Nunca
        inventa um campo.
        """
        enriched = {
            "domain": domain,
            "company_name": "",
            "decisor": "",
            "email": "",
            "cnpj": "",
            "segment": "",
        }
        if not domain:
            log.info("enrich.cnpj sem domínio; nada a enriquecer")
            return enriched

        html = await self._fetch_text(self._company_url(domain))
        if html is None:
            log.info("enrich.cnpj: site de %s indisponível; devolvendo parcial", domain)
            return enriched

        parsed = enrich_from_site(html, domain)
        enriched["company_name"] = parsed["company_name"]
        enriched["email"] = parsed["email"]
        enriched["cnpj"] = parsed["cnpj"]

        cnpj_digits = parsed["cnpj_digits"]
        if not cnpj_digits:
            log.info("enrich.cnpj: %s sem CNPJ no site; devolvendo parcial", domain)
            return enriched

        receita = await self._fetch_receita(cnpj_digits)
        if receita is None:
            log.info("enrich.cnpj: Receita não respondeu para %s; devolvendo parcial", domain)
            return enriched
        # Só o que a Receita trouxe de fato sobrescreve o site -- um campo vazio
        # da Receita não apaga o que o site já deu (e nada é inventado).
        for key, value in receita.items():
            if value:
                enriched[key] = value
        return enriched

    def _company_url(self, domain: str) -> str:
        if domain.startswith(("http://", "https://")):
            return domain
        return f"https://{domain}"

    async def _fetch_text(self, url: str) -> str | None:
        """Baixa texto com o mesmo transporte do scrape; ``None`` se indisponível."""
        try:
            resp = await _transport_get(
                url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}, timeout=self._timeout
            )
        except _transport_error_types() as exc:
            log.info("enrich.cnpj transporte falhou em %s: %s", url, exc)
            return None
        if resp.status_code >= 300:
            log.info("enrich.cnpj %s devolveu %s", url, resp.status_code)
            return None
        return resp.text

    async def _fetch_receita(self, cnpj_digits: str) -> dict | None:
        try:
            resp = await _transport_get(
                f"{self._cnpj_url}/{cnpj_digits}",
                headers={"Accept": "application/json", "User-Agent": USER_AGENT},
                timeout=self._timeout,
            )
        except _transport_error_types() as exc:
            log.info("enrich.cnpj Receita inacessível: %s", exc)
            return None
        if resp.status_code >= 300:
            log.info("enrich.cnpj Receita devolveu %s", resp.status_code)
            return None
        try:
            body = resp.json()
        except ValueError:
            log.info("enrich.cnpj Receita devolveu corpo não-JSON")
            return None
        return normalize_receita(body)


_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_CNPJ_RE = re.compile(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}")
_CNPJ_DIGITS_RE = re.compile(r"\b\d{14}\b")


def normalize_domain(domain: str) -> str:
    """Tira esquema, path, porta e ``www.`` -- a chave de dedup é o host puro."""
    value = (domain or "").strip().lower()
    value = re.sub(r"^[a-z][a-z0-9+.\-]*://", "", value)
    value = value.split("/", 1)[0].split("@", 1)[-1].split(":", 1)[0]
    if value.startswith("www."):
        value = value[4:]
    return value


def enrich_from_site(html: str, domain: str) -> dict:
    """Extrai o que dá de um HTML de site: nome, e-mail e CNPJ. Nunca inventa."""
    extracted = _extract_html(html)
    title = (extracted["meta"].get("title") or "").strip() or normalize_domain(domain)
    text = extracted["text"]

    email = ""
    match = _EMAIL_RE.search(text)
    if match:
        email = match.group(0)
    else:
        match = _EMAIL_RE.search(html)  # e-mail escondido em <a href="mailto:...">
        if match:
            email = match.group(0)

    cnpj = ""
    cnpj_digits = ""
    match = _CNPJ_RE.search(text) or _CNPJ_RE.search(html)
    if match:
        cnpj = match.group(0)
        cnpj_digits = re.sub(r"\D", "", cnpj)
    else:
        # 14 dígitos corridos, como no texto -- nunca a concatenação dos dígitos
        # soltos do HTML (isso colaria números que não formam um CNPJ).
        match = _CNPJ_DIGITS_RE.search(text) or _CNPJ_DIGITS_RE.search(html)
        if match:
            cnpj_digits = match.group(0)
            cnpj = f"{cnpj_digits[:2]}.{cnpj_digits[2:5]}.{cnpj_digits[5:8]}/{cnpj_digits[8:12]}-{cnpj_digits[12:]}"

    return {"company_name": title, "email": email, "cnpj": cnpj, "cnpj_digits": cnpj_digits}


def normalize_receita(body: dict) -> dict:
    """Normaliza a resposta do publica.cnpj.ws para os campos do ``enriched{}``.

    Aceita o formato plano e o aninhado do ``publica.cnpj.ws`` (``estabelecimento``
    com CNAE/município/UF/situação, sócios em ``qsa`` ou ``socios``). Os sócios
    viram ``decisor`` (nomes, na ordem da Receita); CNAE + situação + município/UF
    viram ``segment``. Campos ausentes ficam ``""``.
    """
    if not isinstance(body, dict):
        return {}
    estabelecimento = body.get("estabelecimento") or {}
    if not isinstance(estabelecimento, dict):
        estabelecimento = {}

    cnpj_raw = re.sub(r"\D", "", str(body.get("cnpj") or ""))
    cnpj = ""
    if len(cnpj_raw) == 14:
        cnpj = f"{cnpj_raw[:2]}.{cnpj_raw[2:5]}.{cnpj_raw[5:8]}/{cnpj_raw[8:12]}-{cnpj_raw[12:]}"

    socios = body.get("qsa") or body.get("socios") or []
    nomes: list[str] = []
    for socio in socios:
        if not isinstance(socio, dict):
            continue
        nome = socio.get("nome_socio") or socio.get("nome")
        if nome:
            nomes.append(nome)

    cnae = body.get("cnae_fiscal_descricao") or estabelecimento.get("cnae_fiscal_descricao") or body.get("cnae_fiscal") or ""
    situacao = (
        body.get("descricao_situacao_cadastral")
        or estabelecimento.get("situacao_cadastral")
        or estabelecimento.get("descricao_situacao_cadastral")
        or ""
    )
    segment_parts = [cnae, situacao]
    segment = " - ".join(p for p in segment_parts if p)

    municipio = body.get("municipio") or estabelecimento.get("municipio") or ""
    if isinstance(municipio, dict):
        municipio = municipio.get("descricao") or municipio.get("nome") or ""
    uf = body.get("uf") or ""
    if not uf:
        estado = estabelecimento.get("estado")
        if isinstance(estado, dict):
            uf = estado.get("sigla") or ""
        elif isinstance(estado, str):
            uf = estado
    location = "/".join(p for p in (municipio, uf) if p)
    if location:
        segment = f"{segment} ({location})" if segment else location

    return {
        "company_name": body.get("razao_social") or body.get("nome_fantasia") or "",
        "decisor": ", ".join(nomes),
        "cnpj": cnpj,
        "segment": segment,
    }


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"
