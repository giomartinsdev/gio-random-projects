import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Auth } from "../lib/auth.js";
import type { Db } from "../db/index.js";
import { bookclubDocument } from "../db/schema.js";
import { DomainApiError, NotFoundError, type DomainApiClient, type DomainRoom } from "../lib/domainApiClient.js";

// Generous for a book chapter or a short book, small enough to keep
// comfortably in a Postgres bytea column (see schema.ts's own comment
// on why there's no object store here).
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
    createdAt: r.created_at,
  };
}

export function createRoomsRouter(auth: Auth, db: Db, domainApi: DomainApiClient) {
  const router = new Hono();

  router.get("/", async (c) => {
    const { rooms } = await domainApi.listRooms();
    return c.json({ rooms: rooms.map(serializeRoom) });
  });

  router.post("/", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.parseBody();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const pdf = body.pdf;

    if (!title) return c.json({ error: "title is required" }, 400);
    if (!(pdf instanceof File)) return c.json({ error: "pdf file is required" }, 400);
    if (pdf.type && pdf.type !== "application/pdf") return c.json({ error: "file must be a PDF" }, 400);
    if (pdf.size > MAX_PDF_BYTES) {
      return c.json({ error: `pdf must be under ${Math.floor(MAX_PDF_BYTES / 1024 / 1024)}MB` }, 400);
    }

    const bytes = Buffer.from(await pdf.arrayBuffer());
    const documentId = randomUUID();

    await db.insert(bookclubDocument).values({
      id: documentId,
      uploadedBy: user.id,
      filename: pdf.name || "documento.pdf",
      sizeBytes: bytes.byteLength,
      data: bytes,
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
  // consistently across every browser.
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

    return new Response(new Uint8Array(doc.data), {
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
      await db.delete(bookclubDocument).where(eq(bookclubDocument.id, room.document_id));
      return c.json(accepted, 202);
    } catch (err) {
      if (err instanceof DomainApiError && err.status === 400) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  return router;
}
