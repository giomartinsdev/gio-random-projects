// The ring buffer behind the "clip dos últimos 5 minutos". The
// publisher's OWN browser records its capture with MediaRecorder and
// keeps only the tail in memory -- the server never sees media until
// someone asks for a clip, at which point the buffered chunks are
// assembled and uploaded as one finished WebM.
//
// The shape of the buffer matters: MediaRecorder's very first chunk
// carries the WebM header (EBML init segment) -- without it, no
// player can parse what follows. So the header is kept apart and
// prepended at assembly time, while ordinary chunks age out on a
// rolling window.
export const CLIP_WINDOW_MS = 5 * 60_000;

// How often MediaRecorder hands over a chunk. Small enough that the
// 5-minute window is cut finely (a clip starts mid-chunk at worst 2 s
// earlier than requested), large enough that the array stays tiny.
const TIMESLICE_MS = 2_000;

// Whether this browser can record the WebM the ring buffer is built
// from. Safari (iPhone included) ships a MediaRecorder that produces
// only MP4: recording would start fine and makeClip() would hand back
// a blob no player can parse. The clip feature simply doesn't exist
// there -- callers gate the button on this instead of offering a
// recorder that dies on save.
export const clipSupported =
  typeof window !== "undefined" &&
  typeof window.MediaRecorder === "function" &&
  (window.MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ||
    window.MediaRecorder.isTypeSupported("video/webm"));

export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private header: Blob | null = null;
  private chunks: { blob: Blob; at: number }[] = [];

  get recording(): boolean {
    return this.recorder !== null;
  }

  start(stream: MediaStream) {
    // A fresh share is a fresh buffer: chunks from the previous
    // capture's codecs would be glued onto an incompatible header.
    this.stop();
    this.header = null;
    this.chunks = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      if (!this.header) {
        this.header = e.data;
        return;
      }
      const at = Date.now();
      this.chunks.push({ blob: e.data, at });
      const cutoff = at - CLIP_WINDOW_MS;
      while (this.chunks.length > 0 && this.chunks[0].at < cutoff) this.chunks.shift();
    };
    recorder.start(TIMESLICE_MS);
    this.recorder = recorder;
  }

  stop() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
  }

  // Assembles the last ~5 minutes as one playable Blob: header chunk
  // first, then every buffered chunk still inside the window. Null
  // means nothing was recorded long enough to have a header yet.
  makeClip(): Blob | null {
    if (!this.header) return null;
    const cutoff = Date.now() - CLIP_WINDOW_MS;
    const parts: BlobPart[] = [this.header, ...this.chunks.filter((c) => c.at >= cutoff).map((c) => c.blob)];
    return new Blob(parts, { type: "video/webm" });
  }
}