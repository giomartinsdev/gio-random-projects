"""Entrypoint: own the event queue and drain it into Discord until
SIGTERM.

REDIS_ADDR is the only required env — without an endpoint to listen on
there's nothing this worker can safely pretend to do. Everything else
(the webhook included) has a default: announcing off just keeps the
queue drained, so a missing Discord secret can never turn the durable
list into unbounded growth.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import sys
import threading

import redis

from deals_common import telemetry

from .announcer import Announcer
from .queue import EventQueue

REQUIRED = ("REDIS_ADDR",)

log = logging.getLogger("events_announcer")


def _int_env(name: str, default: float) -> float:
    raw = os.environ.get(name, "")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        raise SystemExit(f"{name} is not parseable: {raw!r}") from None


def main() -> int:
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        log.error("missing required env: %s", ", ".join(missing))
        return 2

    shutdown = telemetry.init(os.environ.get("OTEL_SERVICE_NAME", "events-announcer"))
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    telemetry.configure_logging(getattr(logging, level_name, logging.INFO))

    try:
        host, _, port = os.environ["REDIS_ADDR"].rpartition(":")
        client = redis.Redis(
            host=host or socket.gethostbyname(os.environ["REDIS_ADDR"]),
            port=int(port or 6379),
            decode_responses=True,
        )
        client.ping()
    except Exception:
        log.exception("redis unreachable at %s", os.environ.get("REDIS_ADDR"))
        return 2

    queue = EventQueue(client, os.environ.get("DOMAIN_EVENTS_QUEUE", "domain.events.queue"))
    announcer = Announcer(
        queue,
        os.environ.get("DEALS_DISCORD_WEBHOOK_URL"),
        event_names=("deal.created",),
        max_per_flush=int(_int_env("ANNOUNCE_MAX_PER_FLUSH", 10)),
        max_age_s=_int_env("ANNOUNCE_MAX_AGE_HOURS", 48) * 3600,
        min_interval_s=_int_env("ANNOUNCE_MIN_INTERVAL_S", 2.0),
        max_requeues=int(_int_env("ANNOUNCE_MAX_REQUEUES", 3)),
    )

    running = threading.Event()
    running.set()
    signal.signal(signal.SIGTERM, lambda *_: running.clear())
    signal.signal(signal.SIGINT, lambda *_: running.clear())

    code = 0
    try:
        announcer.run_forever(running, idle_timeout_s=int(_int_env("ANNOUNCE_IDLE_TIMEOUT_S", 5)))
    except Exception:
        log.exception("announcer loop died")
        code = 1
    finally:
        log.info("draining: flushing telemetry and exiting")
        shutdown()
    return code


if __name__ == "__main__":
    sys.exit(main())