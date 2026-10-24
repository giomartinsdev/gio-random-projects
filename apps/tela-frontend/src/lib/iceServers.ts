// Where the browsers get their ICE configuration. The server owns it
// (STUN, and a TURN relay when the direct path can't carry media), so
// every peer asks it rather than carrying a hardcoded copy. The result
// is fetched once and memoized for the tab's life -- credentials are
// long-lived (TURN mints a 24h credential) and the join path is hot.
const API_URL = import.meta.env.VITE_TELA_API_URL ?? "";

export type IceConfig = {
  iceServers: RTCIceServer[];
  // "relay" pins the browser to the TURN relay -- the server sets it when
  // a relay is configured, which is the fix for a path that drops the
  // large DTLS handshake packets.
  iceTransportPolicy: RTCIceTransportPolicy;
};

// A plain STUN fallback so a failed fetch still lets a healthy path
// connect.
const FALLBACK: IceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceTransportPolicy: "all",
};

let cached: Promise<IceConfig> | null = null;

export function fetchIceConfig(): Promise<IceConfig> {
  if (!cached) {
    cached = fetch(`${API_URL}/api/rtc/ice`, { headers: { "content-type": "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`falha ao buscar ICE (${res.status})`);
        return res.json() as Promise<IceConfig>;
      })
      .catch(() => FALLBACK);
    // A failed attempt must not be cached forever -- clear it so a later
    // share can retry (the fallback keeps the current one working).
    cached.then((cfg) => {
      if (cfg === FALLBACK) cached = null;
    });
  }
  return cached;
}
