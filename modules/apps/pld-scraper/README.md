# pld-scraper

Headless deal-Scraper worker: polls source "pld"'s public feed API
and turns its recents feed into `raw_deals` rows (see
`modules/libs/deals_common` for the shared contract -- this app is
only endpoint + mapping).

- Every `poll_seconds` (env `POLL_SECONDS`, terraform sets 1800): one
  cursor-paginated recents page, upsert, announce INSERTED deals when
  `DISCORD_DEALS_WEBHOOK_URL` is set.
- `SOURCE_BASE_URL` is required and lives in Vaultwarden (CI injects
  it at apply time) -- the repo ships no scraped-site hostnames on
  purpose. Blank makes the process exit at boot.
- `payload` keeps the source's JSON verbatim in `raw_deals.payload`
  (jsonb), so new fields never need a re-scrape.

Tests:

```bash
pip install modules/libs/deals_common . pytest
python -m pytest -q
```

Deployment: `python-ci-cd.yml` builds the image (**repo-root context**,
because this Dockerfile bakes the shared lib in), pushes
`registry.giomartins.dev:5000/pld-scraper`, and redeploys via
`terraform apply -replace=module.compute_apps_pld_scraper...`.