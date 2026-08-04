"""Standard logging setup shared by every ETL base class."""

from __future__ import annotations

import logging


def get_logger(name: str) -> logging.Logger:
    """Standard logger config — same format for every ETL class in every flow."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


class Loggable:
    """Mixin giving a class a `self.logger` named after its own module + class name."""

    def __init__(self) -> None:
        self.logger: logging.Logger = get_logger(
            f"{self.__class__.__module__}.{self.__class__.__qualname__}"
        )
