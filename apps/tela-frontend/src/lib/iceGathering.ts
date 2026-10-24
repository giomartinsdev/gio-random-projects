// Wait until ICE gathering finishes (or a cap). The WHIP/WHEP HTTP APIs
// have no trickle endpoint, so the SDP we POST must already carry the
// gathered candidates. STUN-only gathering resolves in well under a
// second; the cap keeps a broken network from hanging the flow.
export function waitIceComplete(pc: RTCPeerConnection, capMs = 5000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(cap);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const cap = setTimeout(done, capMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}
