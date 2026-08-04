from flows.shared.auto_trace import install

# Runs once, the moment anything under `flows.*` is first imported —
# every function/method in every flow's modules gets auto-traced from
# then on, with nothing to register per flow. See flows/README.md#tracing.
install(["flows"])
