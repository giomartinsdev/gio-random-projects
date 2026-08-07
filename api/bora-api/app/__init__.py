from shared.auto_trace import install

# Runs once, the moment anything under `app.*` is first imported — every
# function/method in this service's own trip-planning/caching/geocoding
# code gets auto-traced from then on, nested under whichever request
# span FastAPI's own auto-instrumentation is holding open. See
# api/README.md.
install(["app"])
