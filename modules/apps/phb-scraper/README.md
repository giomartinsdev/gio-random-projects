# phb-scraper

Headless deal-scraper worker: polls source "phb"'s public offers API
and turns its offers into `raw_deals` rows (see
`modules/libs/deals_common` for the shared contract -- this app is
only endpoint + mapping).

- Every `poll_seconds` (env `POLL_SECONDS`, terraform sets 1800): up
  to 3 offset-paginated pages, upsert, announce INSERTED offers when
  `DISCORD_DEALS_WEBHOOK_URL` is set.
- Brazilian price strings ("88,22", "8.834,07"), unix-seconds
  createdAt shipped as a string, `status: "true"` gate.
- `SOURCE_BASE_URL` is required and lives in Vaultwarden (CI injects
  it at apply time) -- the repo ships no scraped-site hostnames on
  purpose. Blank makes the process exit at boot.

Tests:

```bash
pip install modules/libs/deals_common . pytest
python -m pytest -q
```

Deployment: `python-ci-cd.yml` builds the image (**repo-root context**,
because this Dockerfile bakes the shared lib in), pushes
`registry.giomartins.dev:5000/phb-scraper`, and redeploys via
`terraform apply -replace=module.compute_apps_phb_scraper...`.