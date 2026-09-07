import { useEffect } from "react";

// Keeps a phone from dimming and locking while it's showing (or
// capturing) a live stream -- without this, watching a share on a
// phone means tapping the screen every 30 seconds.
//
// Screen Wake Lock isn't available everywhere (notably older iOS), and
// the browser drops the lock on its own whenever the tab is
// backgrounded, so it has to be re-acquired when the tab becomes
// visible again. Everything here fails quietly: a phone that dims is
// worse, not broken.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied, or the tab lost focus mid-request.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
