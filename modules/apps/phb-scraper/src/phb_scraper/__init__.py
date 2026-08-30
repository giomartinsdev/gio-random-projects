"""Scraper worker for source "phb".

A Nuxt SPA whose UI calls offers API endpoints on the same origin --
/api/offers answered 200 unauthenticated, 10 offers per page,
offset-paginated by ?page=N (spike, 2026-08-30). No SSR payload needed.
"""

__all__ = ["client", "main"]