import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { Auth } from "../lib/auth.js";
import type { Db } from "../db/index.js";
import { bookclubDocument, bookclubRoom } from "../db/schema.js";

// Generous for a book chapter or a short book, small enough to keep
// comfortably in a Postgres bytea column (see schema.ts's own comment
// on why there's no object store here).
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function requireUser(auth: Auth, c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

function serializeRoom(r: typeof bookclubRoom.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    hostId: r.hostId,
    documentId: r.documentId,
    currentPage: r.currentPage,
    createdAt: r.createdAt,
  };
}

export function createRoomsRouter(auth: Auth, db: Db) {
  const router = new Hono();

  router.get("/", async (c) => {
    const rooms = await db.select().from(bookclubRoom).orderBy(desc(bookclubRoom.createdAt));
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
    const roomId = randomUUID();
    const now = new Date();

    await db.insert(bookclubDocument).values({
      id: documentId,
      uploadedBy: user.id,
      filename: pdf.name || "documento.pdf",
      sizeBytes: bytes.byteLength,
      data: bytes,
      createdAt: now,
    });

    await db.insert(bookclubRoom).values({
      id: roomId,
      hostId: user.id,
      title,
      documentId,
      currentPage: 1,
      createdAt: now,
      updatedAt: now,
    });

    return c.json(
      { id: roomId, title, hostId: user.id, documentId, currentPage: 1, createdAt: now.toISOString() },
      201,
    );
  });

  router.get("/:id", async (c) => {
    const [room] = await db.select().from(bookclubRoom).where(eq(bookclubRoom.id, c.req.param("id")));
    if (!room) return c.json({ error: "not found" }, 404);
    return c.json(serializeRoom(room));
  });

  // Auth-gated (not a public static asset) -- this is the only way the
  // front's <Document file={...}> (react-pdf) gets the bytes, via an
  // authenticated fetch + ArrayBuffer rather than a plain <iframe src>
  // that couldn't carry the session cookie's SameSite=None constraints
  // consistently across every browser.
  router.get("/:id/pdf", async (c) => {
    const user = await requireUser(auth, c);
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const [room] = await db.select().from(bookclubRoom).where(eq(bookclubRoom.id, c.req.param("id")));
    if (!room) return c.json({ error: "not found" }, 404);

    const [doc] = await db.select().from(bookclubDocument).where(eq(bookclubDocument.id, room.documentId));
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

    const [room] = await db.select().from(bookclubRoom).where(eq(bookclubRoom.id, c.req.param("id")));
    if (!room) return c.json({ error: "not found" }, 404);
    if (room.hostId !== user.id) return c.json({ error: "forbidden" }, 403);

    await db.delete(bookclubRoom).where(eq(bookclubRoom.id, room.id));
    await db.delete(bookclubDocument).where(eq(bookclubDocument.id, room.documentId));
    return c.body(null, 204);
  });

  return router;
}
