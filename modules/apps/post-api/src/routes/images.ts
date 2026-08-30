import { Hono } from "hono";
import type { Auth } from "../lib/auth.js";
import type { Uploader } from "../lib/minioClient.js";

// Upload endpoint backing the editor's cover/inline image buttons.
// Design notes that shaped it:
//
// - The bytes go straight to MinIO and the PUBLIC URL comes back; the
//   response is what gets pasted into `coverImageUrl` or markdown as
//   ![](url). Post-api never stores image bytes itself and never
//   serves them again -- the bucket is public-read by design (see
//   lib/minioClient.ts).
// - Auth-gated (only authors upload) and rate-limited in app.ts like
//   every other write surface here.
// - The content-type allowlist below IS the security boundary on what
//   lands in a public bucket: an <img> tag only ever renders
//   image/* responses and browsers refuse to sniff against a
//   Content-Type from S3, so an HTML/SVG file can't become stored XSS
//   by being uploaded and later linked.

const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

const MAX_BYTES = 8 * 1024 * 1024;
// Generous for a post graphic; bounded like every write here so one
// user can't hose the bucket or the memory of this process (the bytes
// are buffered whole into an arrayBuffer before the length check --
// the rate limiter bounds how often that can happen, this bounds how
// much one occurrence can cost).
const MAX_BYTES_LABEL = "8 MB";

export function createImagesRouter(auth: Auth, uploader: Uploader) {
  const router = new Hono();

  router.post("/upload", async (c) => {
    const userId = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!userId?.user.id) return c.json({ error: "unauthorized" }, 401);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "expected multipart/form-data with a 'file' field" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "field 'file' is required" }, 400);
    }

    const contentType = file.type;
    const ext = ALLOWED[contentType as keyof typeof ALLOWED];
    if (!ext) {
      return c.json({ error: "only jpeg, png, webp and gif images are allowed" }, 400);
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: `image too large (limit ${MAX_BYTES_LABEL})` }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: "empty file" }, 400);
    }

    // Author-scoped key: a human browsing the bucket sees per-user
    // folders, and filenames are never user-controlled (no traversal
    // or collision shape at all -- just a uuid).
    const key = `${userId.user.id}/${crypto.randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    try {
      const url = await uploader.upload(key, bytes, contentType);
      return c.json({ url });
    } catch {
      return c.json({ error: "upload failed -- try again" }, 502);
    }
  });

  return router;
}