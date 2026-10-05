"""Runtime configuration, read once from the environment.

Env names come from the stack file in the spec (§10.2), which is what the
container actually gets: ``DOMAIN_API_BASE_URL``, ``DOMAIN_API_KEY``,
``HTTP_ADDR``, ``FINANCE_API_KEYS``, ``RATE_LIMIT_RPS``/``_BURST``,
``OTEL_EXPORTER_OTLP_ENDPOINT``, ``OTEL_SERVICE_NAME``.

There is deliberately **no** ``DATABASE_URL`` here and no broker URL: this
app is the ACL of the finance context and persists nothing (§1.1). A
missing or malformed required setting is a **startup** failure, not a
request failure -- the same choice ``domain-api`` makes in its
``config.Load``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

from finance_api.infrastructure import secrets_bridge

DEFAULT_SERVICE_NAME = "finance-api"
# domain-api holds /sync open for 10s by design; the client must outlast it,
# or every slow-but-successful write would surface as a transport error
# instead of the documented 504-with-a-body.
DEFAULT_DOMAIN_TIMEOUT_S = 12.0
DEFAULT_RATE_LIMIT_RPS = 5
DEFAULT_RATE_LIMIT_BURST = 20
# The SPA that calls this API cross-origin. Comma-separated; empty disables
# CORS (a machine-to-machine deploy that never gets a browser). Kept as a
# setting rather than hard-coded so a local dev origin can be added without
# a rebuild.
DEFAULT_CORS_ORIGINS = "https://finance.giomartins.dev"

# Sessão do SPA (§5): mesmo desenho do clubs-api — cookie HttpOnly/Secure com
# um JWT HS256 assinado por FINANCE_SESSION_SECRET.
DEFAULT_SESSION_TTL_S = 30 * 24 * 3600  # 30 dias


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


@dataclass(frozen=True, slots=True)
class Settings:
    domain_api_base_url: str
    domain_api_key: str
    finance_api_keys: Mapping[str, str]
    http_host: str
    http_port: int
    rate_limit_rps: int
    rate_limit_burst: int
    domain_timeout_s: float
    otlp_endpoint: str
    service_name: str
    cors_origins: tuple[str, ...]
    # SSO do SPA. Vazios = login desabilitado (só o worker com X-API-Key passa),
    # o que mantém o boot possível antes de os segredos existirem no stack.
    google_client_id: str = ""
    session_secret: str = ""
    session_ttl_s: int = DEFAULT_SESSION_TTL_S
    # Open Finance (Polp/Celcoin). Vazios = integração desligada; as rotas de OF
    # respondem 503 e o resto do app segue (§7 da spec de Open Finance).
    polp_client_id: str = ""
    polp_client_secret: str = ""
    polp_base_url: str = ""
    polp_sandbox: bool = False
    # Webhook do provedor (§2.6, fase 2). of_webhook_sign_key = chave HMAC
    # (X-Webhook-Signature) que o cofre entrega como POLP_OF_WEBHOOK_SIGN_KEY.
    # Vazia = verificação por assinatura desligada (o segredo do caminho
    # OF_TICK_SECRET continua valendo como segunda camada).
    of_webhook_sign_key: str = ""
    of_webhook_secret: str = ""
    of_tick_base_url: str = ""


def parse_api_keys(raw: str) -> dict[str, str]:
    """Parse ``key:label,key2:label2`` into ``{key: label}``.

    Mirrors domain-api's ``ParseAPIKeys``: each caller gets its own key so
    the audit log can name it, and the label -- never the key -- is what
    gets logged. A malformed entry is a config error rather than a
    silently dropped key, because a dropped key is a production 401 that
    nobody can explain from the config file.
    """
    keys: dict[str, str] = {}
    for chunk in raw.split(","):
        entry = chunk.strip()
        if not entry:
            continue
        if ":" not in entry:
            raise ConfigError(
                "FINANCE_API_KEYS entry is missing its ':label' part; "
                "expected 'key:label' pairs separated by commas"
            )
        key, label = entry.split(":", 1)
        key, label = key.strip(), label.strip()
        if not key or not label:
            raise ConfigError("FINANCE_API_KEYS has an empty key or label")
        if key in keys:
            raise ConfigError("FINANCE_API_KEYS has a duplicate key")
        keys[key] = label
    if not keys:
        raise ConfigError("FINANCE_API_KEYS is empty: at least one caller key is required")
    return keys


def parse_http_addr(raw: str) -> tuple[str, int]:
    """``":8000"`` / ``"0.0.0.0:8000"`` -> ``("0.0.0.0", 8000)``."""
    text = raw.strip()
    if not text or ":" not in text:
        raise ConfigError(f"HTTP_ADDR must be 'host:port', got {raw!r}")
    host, _, port_text = text.rpartition(":")
    try:
        port = int(port_text)
    except ValueError as exc:
        raise ConfigError(f"HTTP_ADDR has a non-numeric port: {raw!r}") from exc
    if not 0 < port < 65536:
        raise ConfigError(f"HTTP_ADDR port out of range: {raw!r}")
    # An empty host (":8000") means every interface inside the container.
    return (host or "0.0.0.0", port)


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    base_url = source.get("DOMAIN_API_BASE_URL", "").strip()
    if not base_url:
        raise ConfigError("DOMAIN_API_BASE_URL is required")
    api_key = source.get("DOMAIN_API_KEY", "").strip()
    if not api_key:
        # Fail loudly and early: an unauthenticated finance-api gets a 401
        # from domain-api on every single request (spec §10.3 -- the
        # cross-stack dependency nobody notices until production).
        raise ConfigError("DOMAIN_API_KEY is required")

    host, port = parse_http_addr(source.get("HTTP_ADDR", ":8000"))

    # Os SEGREDOS passam pela ponte do Vaultwarden quando ela está configurada
    # (SECRETS_BRIDGE_URL/API_KEY) — é o que faz um item do cofre chegar ao
    # container sem cadastrar variável de stack. Sem ponte, lê do ambiente.
    resolve = secrets_bridge.resolver(source)

    # Segredo do cookie de sessão. Se nem o cofre nem o env tiverem, deriva um
    # do DOMAIN_API_KEY (que já é um segredo do stack) via HKDF. Assim o login
    # funciona sem cadastrar mais nenhuma variável, e o cookie nunca é assinado
    # com uma chave pública/conhecida.
    session_secret = (
        resolve("FINANCE_SESSION_SECRET")
        or resolve("SESSION_SECRET")
        or derive_session_secret(api_key)
    )
    # Open Finance (Polp). Nomes do cofre: POLP_OF_CLIENT_ID/SECRET. Vazios =
    # integração desligada (503), o resto do app segue.
    polp_client_id = resolve("POLP_OF_CLIENT_ID")
    polp_client_secret = resolve("POLP_OF_CLIENT_SECRET")
    of_webhook_sign_key = resolve("POLP_OF_WEBHOOK_SIGN_KEY")
    of_webhook_secret = (source.get("OF_TICK_SECRET") or "").strip()
    of_tick_base_url = (source.get("OF_TICK_BASE_URL") or "").strip()

    return Settings(
        domain_api_base_url=base_url.rstrip("/"),
        domain_api_key=api_key,
        finance_api_keys=parse_api_keys(source.get("FINANCE_API_KEYS", "")),
        http_host=host,
        http_port=port,
        rate_limit_rps=int(source.get("RATE_LIMIT_RPS") or DEFAULT_RATE_LIMIT_RPS),
        rate_limit_burst=int(source.get("RATE_LIMIT_BURST") or DEFAULT_RATE_LIMIT_BURST),
        domain_timeout_s=float(source.get("DOMAIN_API_TIMEOUT_S") or DEFAULT_DOMAIN_TIMEOUT_S),
        otlp_endpoint=source.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip(),
        service_name=source.get("OTEL_SERVICE_NAME", DEFAULT_SERVICE_NAME).strip()
        or DEFAULT_SERVICE_NAME,
        cors_origins=parse_cors_origins(
            source.get("FINANCE_CORS_ORIGINS", DEFAULT_CORS_ORIGINS)
        ),
        google_client_id=source.get("FINANCE_GOOGLE_CLIENT_ID", "").strip(),
        session_secret=session_secret,
        session_ttl_s=int(source.get("FINANCE_SESSION_TTL_S") or DEFAULT_SESSION_TTL_S),
        polp_client_id=polp_client_id,
        polp_client_secret=polp_client_secret,
        polp_base_url=source.get("POLP_API_BASE_URL", "").strip(),
        of_webhook_sign_key=of_webhook_sign_key,
        of_webhook_secret=of_webhook_secret,
        of_tick_base_url=of_tick_base_url,
        polp_sandbox=source.get("POLP_OF_SANDBOX", "").strip().lower() in ("1", "true", "yes"),
    )


def derive_session_secret(seed: str) -> str:
    """Deriva a chave de assinatura da sessão do segredo que já existe.

    HKDF-SHA256 separado por rótulo (``finance.session.v1``): a mesma semente
    (a key do domain-api) nunca é reusada como chave de outro propósito. O
    resultado tem 32 bytes — acima do mínimo do HS256. Uma semente vazia devolve
    vazio, e aí o login fica desabilitado em vez de assinar com chave previsível.
    """
    if not seed:
        return ""
    import hashlib
    import hmac

    return hmac.new(
        b"finance.session.v1", seed.encode(), hashlib.sha256
    ).hexdigest()


def parse_cors_origins(raw: str) -> tuple[str, ...]:
    """``"a,b"`` -> ``("a", "b")``. Whitespace-trimmed, blanks dropped.

    A blank list is valid and means "no browser origin is allowed" -- a
    machine-only deploy. Each entry is kept verbatim (scheme included):
    Starlette matches the ``Origin`` header exactly, so a trailing slash or
    a missing scheme would silently never match.
    """
    return tuple(part.strip() for part in raw.split(",") if part.strip())
