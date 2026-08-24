import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { bookclubApi, type Room } from "../lib/bookclubApi.js";
import { useRoomSocket, type Stroke } from "../lib/useRoomSocket.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const CURSOR_THROTTLE_MS = 60;
const PEN_COLOR = "#F5A623";
const MAX_PAGE_WIDTH = 800;

export default function BookClubRoom() {
  const { id } = useParams<{ id: string }>();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [chatDraft, setChatDraft] = useState("");
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<[number, number][]>([]);
  const lastCursorSentRef = useRef(0);

  const socket = useRoomSocket(id ?? "");
  const isHost = socket.you && socket.you.userId === socket.hostId;

  useEffect(() => {
    if (!id) return;
    bookclubApi
      .getRoom(id)
      .then(setRoom)
      .catch(() => setRoom(null));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(bookclubApi.pdfUrl(id), { credentials: "include" })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error("failed to load pdf"))))
      .then(setPdfData)
      .catch(() => setPdfData(null));
  }, [id]);

  // The container's own CSS width (flex layout, capped at
  // MAX_PAGE_WIDTH) drives how wide react-pdf renders the page --
  // without this, a hardcoded render width would overflow a phone
  // screen instead of shrinking to fit. Depends on `room`, not `[]`:
  // the container div doesn't exist yet on the very first render
  // (room is still `undefined`, so the early-return "Carregando…"
  // branch renders instead) -- this needs to re-run once the real
  // container actually mounts.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPageWidth(Math.min(Math.round(width), MAX_PAGE_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [room]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [socket.chatHistory.length]);

  const page = socket.page || room?.currentPage || 1;

  const redraw = useCallback(
    (strokes: Stroke[], cursors: typeof socket.cursors, live: [number, number][] | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      function strokePath(points: [number, number][], color: string) {
        if (points.length < 2) return;
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 3;
        ctx!.lineCap = "round";
        ctx!.lineJoin = "round";
        ctx!.beginPath();
        ctx!.moveTo(points[0][0] * width, points[0][1] * height);
        for (const [x, y] of points.slice(1)) ctx!.lineTo(x * width, y * height);
        ctx!.stroke();
      }

      for (const s of strokes) strokePath(s.points, s.color);
      if (live) strokePath(live, PEN_COLOR);

      for (const c of Object.values(cursors)) {
        if (c.userId === socket.you?.userId) continue;
        const x = c.x * width;
        const y = c.y * height;
        ctx.fillStyle = "#F5A623";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#F5F0E8";
        ctx.fillText(c.userName, x + 8, y - 8);
      }
    },
    [socket.you?.userId],
  );

  useEffect(() => {
    redraw(socket.strokes, socket.cursors, null);
  }, [socket.strokes, socket.cursors, redraw]);

  function syncCanvasSize() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    redraw(socket.strokes, socket.cursors, null);
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const [x, y] = pointFromEvent(e);

    const now = Date.now();
    if (now - lastCursorSentRef.current > CURSOR_THROTTLE_MS) {
      lastCursorSentRef.current = now;
      socket.sendCursor(x, y);
    }

    if (drawingRef.current) {
      currentStrokeRef.current.push([x, y]);
      redraw(socket.strokes, socket.cursors, currentStrokeRef.current);
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isHost) return;
    drawingRef.current = true;
    currentStrokeRef.current = [pointFromEvent(e)];
  }

  function handlePointerUp() {
    if (!isHost || !drawingRef.current) return;
    drawingRef.current = false;
    if (currentStrokeRef.current.length > 1) {
      socket.sendStroke(currentStrokeRef.current, PEN_COLOR);
    }
    currentStrokeRef.current = [];
  }

  function submitChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    socket.sendChat(chatDraft.trim());
    setChatDraft("");
  }

  if (room === undefined) return <p className="text-buteco-cream/60">Carregando…</p>;
  if (room === null) {
    return (
      <div className="text-center py-20">
        <p className="text-buteco-cream/60 mb-4">Essa sala não existe (ou já foi encerrada).</p>
        <Link to="/clube-do-livro" className="text-buteco-amber hover:underline">
          Voltar para o Clube do Livro
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-fade-in-up">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="font-heading font-bold text-2xl text-buteco-cream">{room.title}</h1>
            <p className="text-buteco-cream/50 text-sm font-mono">
              {socket.connected ? "conectado" : "conectando…"} · {socket.participants.length}{" "}
              {socket.participants.length === 1 ? "pessoa" : "pessoas"} na sala
            </p>
          </div>

          <div className="flex items-center gap-3 glass-card px-4 py-2">
            <button
              disabled={!isHost || page <= 1}
              onClick={() => socket.setPage(page - 1)}
              className="text-buteco-cream/80 hover:text-buteco-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              ← anterior
            </button>
            <span className="font-mono text-sm text-buteco-amber">
              {page}
              {numPages ? ` / ${numPages}` : ""}
            </span>
            <button
              disabled={!isHost || (numPages > 0 && page >= numPages)}
              onClick={() => socket.setPage(page + 1)}
              className="text-buteco-cream/80 hover:text-buteco-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              próxima →
            </button>
          </div>
        </div>

        {!isHost && (
          <p className="text-buteco-cream/40 text-xs mb-3 font-mono">
            só quem abriu a sala vira página e desenha -- você pode apontar (passe o mouse) e conversar no chat
          </p>
        )}

        <div ref={containerRef} className="relative glass-card overflow-hidden mx-auto" style={{ maxWidth: 800 }}>
          {pdfData ? (
            <Document file={{ data: pdfData }} onLoadSuccess={({ numPages }) => setNumPages(numPages)} loading={<PdfPlaceholder />}>
              <Page pageNumber={page} width={pageWidth} onRenderSuccess={syncCanvasSize} loading={<PdfPlaceholder />} />
            </Document>
          ) : (
            <PdfPlaceholder />
          )}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full touch-none"
            style={{ cursor: isHost ? "crosshair" : "default" }}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>

        {isHost && (
          <button
            onClick={() => socket.clearDrawing()}
            className="mt-3 text-xs font-mono text-buteco-cream/50 hover:text-buteco-amber transition-colors cursor-pointer"
          >
            limpar anotações desta página
          </button>
        )}
      </div>

      <aside className="w-full lg:w-80 shrink-0 flex flex-col glass-card overflow-hidden" style={{ maxHeight: 700 }}>
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="font-heading font-semibold text-buteco-cream">Chat</h2>
          <p className="text-buteco-cream/40 text-xs">{socket.participants.map((p) => p.userName).join(", ")}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {socket.chatHistory.map((m) => (
            <div key={m.id}>
              <span className="font-heading text-sm text-buteco-amber">{m.userName}</span>
              <p className="text-buteco-cream/90 text-sm break-words">{m.body}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={submitChat} className="p-3 border-t border-white/10 flex gap-2">
          <input
            type="text"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder={socket.you ? "Escreva algo…" : "Entre para conversar"}
            disabled={!socket.you}
            className="field flex-1 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!socket.you}
            className="px-3 rounded-lg bg-buteco-amber text-buteco-navy font-heading font-semibold disabled:opacity-40 cursor-pointer"
          >
            ↑
          </button>
        </form>
      </aside>
    </div>
  );
}

function PdfPlaceholder() {
  return <div className="w-full aspect-[3/4] flex items-center justify-center text-buteco-cream/40">Carregando PDF…</div>;
}
