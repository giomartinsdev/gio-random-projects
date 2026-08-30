# events-announcer

Announce worker: reads domain events off the durable
`domain.events.queue` list and posts fresh deals to a Discord webhook —
the announcing half the scrapers used to do inline, split into its own
process per the CQRS split (scrapers publish; this consumes).

- Pops batches of events (LPOP drain, BLPOP when idle), keeps
  `deal.created`, drops stale ones (> `ANNOUNCE_MAX_AGE_HOURS`, first
  post date), posts **one message per deal** — Discord caps a message
  at 2000 chars, so batched messages were always fiction.
- Oldest deals first, at most `ANNOUNCE_MAX_PER_FLUSH` per pass, with a
  pause between POSTs so a burst of first-seen deals doesn't trip
  Discord's rate limit; HTTP 429 honours `retry_after` and requeues.
- Failed postings requeue at the FRONT up to `ANNOUNCE_MAX_REQUEUES`
  attempts (the attempt count rides in the event envelope) before the
  event is dropped — announce is best-effort, never worth a DLQ.
- `DEALS_DISCORD_WEBHOOK_URL` blank = announcing is off but the queue
  still drains: the worker has to keep consuming no matter what,
  otherwise the list grows unbounded behind it.

Events arrive from domain-worker, which RPUSHes onto the queue before
publishing each event to pub/sub — this worker is the durable reader
that misses nothing when it restarts. `REDIS_ADDR` is required; every
other knob has a default.

Tests:

```bash
pip install modules/libs/deals_common . pytest
python -m pytest -q
```

Deployment: `python-ci-cd.yml` builds the image (**repo-root context**,
because this Dockerfile bakes the shared lib in), pushes
`registry.giomartins.dev:5000/events-announcer`, and redeploys via
`terraform apply -replace=module.compute_apps_events_announcer...`.