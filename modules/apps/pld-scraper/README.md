# pld-scraper

Headless deal-scraper worker: polls source "pld"'s public feed API and
pushes each deal through domain-api (`POST /deals` -- see
`modules/libs/deals_common` for the shared contract; this app is only
endpoint + mapping).

- Every `poll_seconds` (env `POLL_SECONDS`, terraform sets 1800): one
  cursor-paginated recents page, then one `POST /deals` per deal.
  Persistence happens in the Go domain-worker (raw_deals + audit +
  `deal.created` event); announcing happens downstream in the
  events-announcer worker -- this container has no database or
  webhook.
- Required env, all wired by terraform/CI: `DOMAIN_API_URL`
  (+ `DOMAIN_API_KEY` from secrets.tf's `deals_domain_key`),
  `SOURCE_BASE_URL`. `SOURCE_BASE_URL` lives only in Vaultwarden (CI
  injects it at apply time) -- the repo ships no scraped-site
  hostnames on purpose. Blank makes the process exit at boot.
- `payload` rides along verbatim and lands in `raw_deals.payload`
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