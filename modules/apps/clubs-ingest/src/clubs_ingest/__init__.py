"""clubs-ingest: EA Pro Clubs API -> domain-api.

No database of its own (same as every service in this repo). See cycle.py for
the loop and normalize.py for the single translation layer.
"""

__all__ = ["cycle", "normalize", "client", "source", "sync"]
