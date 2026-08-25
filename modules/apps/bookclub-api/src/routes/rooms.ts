import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Auth } from "../lib/auth.js";
import type { Db } from "../db/index.js";
import type { MinioClient } from "../lib/minioClient.js";
import { bookclubDocument } from "../db/schema.js";
import { DomainApiError, NotFoundError, type DomainApiClient, type DomainRoom } from "../lib/domainApiClient.js";

// Generous for a book chapter or a short book.
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function requireUser(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

function serializeRoom(r: DomainRoom) {
  return {
    id: r.id,
    title: r.title,
    hostId: r.host_id,
    documentId: r.document_id,
    currentPage: r.current_page,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function createRoomsRouter(auth: Auth, db: Db, domainApi: DomainApiClient, minio: MinioClient) {
  const router = new Hono();

  router.get("/", async (c) => {
    const { rooms } = await domainApi.listRooms();
    return c.json({ rooms: rooms.map(serializeRoom) });
  });

  router.post("/", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const pdf = body.pdf;

    if (!title) return c.json({ error: "title is required" }, 400);
    if (!(pdf instanceof File)) return c.json({ error: "pdf file is required" }, 400);
    if (pdf.size > MAX_PDF_BYTES) {
      return c.json({ error: `pdf must be under ${Math.floor(MAX_PDF_BYTES / 1024 / 1024)}MB` }, 400);
    }

    const bytes = Buffer.from(await pdf.arrayBuffer());
    // The client-supplied `pdf.type` is just whatever Content-Type the
    // browser/attacker chose to send -- a renamed non-PDF with a
    // spoofed header sailed through the old `pdf.type !==
    // "application/pdf"` check (and an EMPTY type skipped it
    // entirely, since `pdf.type &&` short-circuits on falsy). Every
    // real PDF starts with this 5-byte magic number regardless of
    // what header claims; sniff the actual bytes instead.
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return c.json({ error: "file must be a PDF" }, 400);
    }

    const documentId = randomUUID();
    const objectKey = `${documentId}.pdf`;

    await minio.upload(objectKey, bytes, "application/pdf");
    await db.insert(bookclubDocument).values({
      id: documentId,
      uploadedBy: user.id,
      filename: pdf.name || "documento.pdf",
      sizeBytes: bytes.byteLength,
      objectKey,
    });

    // 202: the room itself is created asynchronously by domain-worker,
    // same as every other write through domain-api -- unlike post-api,
    // there's no synchronous "here's the created row" response to give
    // back yet. The front navigates to the room page on success
    // regardless, which re-fetches once it's actually there.
    const accepted = await domainApi.createRoom({ host_id: user.id, title, document_id: documentId });
    return c.json(accepted, 202);
  });

  router.get("/:id", async (c) => {
    try {
      const room = await domainApi.getRoom(c.req.param("id"));
      return c.json(serializeRoom(room));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }
  });

  // Auth-gated (not a public static asset) -- this is the only way the
  // front's <Document file={...}> (react-pdf) gets the bytes, via an
  // authenticated fetch + ArrayBuffer rather than a plain <iframe src>
  // that couldn't carry the session cookie's SameSite=None constraints
  // consistently across every browser. Bytes are proxied straight
  // through from MinIO, not handed out as a presigned URL -- keeps the
  // same auth check in front of them either way.
  router.get("/:id/pdf", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    let room: DomainRoom;
    try {
      room = await domainApi.getRoom(c.req.param("id"));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }

    const [doc] = await db.select().from(bookclubDocument).where(eq(bookclubDocument.id, room.document_id));
    if (!doc) return c.json({ error: "not found" }, 404);

    const bytes = await minio.getBytes(doc.objectKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(doc.sizeBytes),
        "content-disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
      },
    });
  });

  router.delete("/:id", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    let room: DomainRoom;
    try {
      room = await domainApi.getRoom(c.req.param("id"));
    } catch (err) {
      if (err instanceof NotFoundError) return c.json({ error: "not found" }, 404);
      throw err;
    }
    if (room.host_id !== user.id) return c.json({ error: "forbidden" }, 403);

    try {
      const accepted = await domainApi.deleteRoom(room.id, user.id);
      const [doc] = await db.select().from(bookclubDocument).where(eq(bookclubDocument.id, room.document_id));
      if (doc) {
        await minio.remove(doc.objectKey).catch(() => {});
        await db.delete(bookclubDocument).where(eq(bookclubDocument.id, room.document_id));
      }
      return c.json(accepted, 202);
    } catch (err) {
      if (err instanceof DomainApiError && err.status === 400) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  return router;
}
