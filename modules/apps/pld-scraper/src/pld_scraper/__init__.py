"""Scraper worker for source "pld".

An Astro storefront whose feed is a plain JSON API -- it answered 200
unauthenticated from a cold fetch (spike, 2026-08-30), cursor-paginated
page by page via pageInfo.endCursor.
"""

__all__ = ["client", "main"]