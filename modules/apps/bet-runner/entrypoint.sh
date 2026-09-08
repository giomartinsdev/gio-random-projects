#!/bin/sh
# xvfb-run has a startup race: Xvfb's "I'm ready" SIGUSR1 can arrive
# before the script's shell enters `wait`, which then blocks until Xvfb
# exits — i.e. forever. Seen live in this container: Xvfb up, node never
# started, no output. Same job without the race: start Xvfb, wait for
# its socket, exec node. If the socket never appears, exec anyway so
# the failure shows up as a browser error instead of a silent hang.
# Xvfb won't create /tmp/.X11-unix itself when not root; pre-made, it
# just uses it.
mkdir -p /tmp/.X11-unix 2>/dev/null || true
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
i=0
while [ $i -lt 100 ] && [ ! -S /tmp/.X11-unix/X99 ]; do
  sleep 0.1
  i=$((i + 1))
done
exec env DISPLAY=:99 node dist/index.js