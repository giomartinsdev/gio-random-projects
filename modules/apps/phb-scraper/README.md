# phb-scraper

Headless deal-scraper worker: polls source "phb"'s public offers API
and pushes each offer through domain-api (`POST /deals` -- see
`modules/libs/deals_common` for the shared contract; this app is only
endpoint + mapping).

- Every `poll_seconds` (env `POLL_SECONDS`, terraform sets 1800): up
  to 3 offset-paginated pages, then one `POST /deals` per offer.
  Persistence happens in the Go domain-worker (raw_deals + audit +
  `deal.created` event); announcing happens downstream in the
  events-announcer worker. Same shape as the pld-scraper's main.
- Brazilian price strings ("88,22", "8.834,07"), unix-seconds
  createdAt shipped as a string, `status: "true"` gate.
- Required env, all wired by terraform/CI: `DOMAIN_API_URL`
  (+ `DOMAIN_API_KEY` from secrets.tf's `deals_domain_key`),
  `SOURCE_BASE_URL` (Vaultwarden item -- the repo ships no scraped-site
  hostnames on purpose). Blank makes the process exit at boot.

Tests:

```bash
pip install modules/libs/deals_common . pytest
python -m pytest -q
```

Deployment: `python-ci-cd.yml` builds the image (**repo-root context**,
because this Dockerfile bakes the shared lib in), pushes
`registry.giomartins.dev:5000/phb-scraper`, and redeploys via
`terraform apply -replace=module.compute_apps_phb_scraper...`.