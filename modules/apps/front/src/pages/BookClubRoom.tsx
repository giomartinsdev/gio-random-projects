import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { bookclubApi, type Room } from "../lib/bookclubApi.js";
import { useRoomSocket, type Stroke } from "../lib/useRoomSocket.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import {
  IconSelect,
  IconLaser,
  IconPen,
  IconText,
  IconTrash,
  IconMaximize,
  IconMinimize,
  IconBookmark,
  IconQuote,
  IconClose,
  IconDrag,
  IconEnd,
} from "../components/RoomIcons.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const CURSOR_THROTTLE_MS = 60;
const PEN_COLOR = "#F5A623";
const MAX_PAGE_WIDTH = 800;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;
const TEXT_FONT_MIN = 10;
const TEXT_FONT_MAX = 48;
const TEXT_FONT_DEFAULT = 16;
const TEXT_FONT_STEP = 2;

type Tool = "select" | "laser" | "pen" | "text";

export default function BookClubRoom() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [chatDraft, setChatDraft] = useState("");
  const [baseWidth, setBaseWidth] = useState(MAX_PAGE_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingTextAt, setPendingTextAt] = useState<[number, number] | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [pageRequestDraft, setPageRequestDraft] = useState("");
  // Which placed annotation is being dragged right now, and its live
  // (not-yet-committed) position -- kept purely local so the drag
  // itself feels instant instead of waiting on a socket round-trip for
  // every pointermove. text:move only goes out once, on release.
  const [draggingText, setDraggingText] = useState<{ id: string; x: number; y: number } | null>(null);
  const [endingRoom, setEndingRoom] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<[number, number][]>([]);
  const lastCursorSentRef = useRef(0);
  const textActionTakenRef = useRef(false);
  const dragOffsetRef = useRef<[number, number]>([0, 0]);

  const socket = useRoomSocket(id ?? "");
  const isHost = Boolean(socket.you && socket.you.userId === socket.hostId);

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

  // The viewport's own CSS width (flex layout, capped at
  // MAX_PAGE_WIDTH) drives the BASE render width -- zoom multiplies on
  // top of it. Depends on `room`, not `[]`: the viewport div doesn't
  // exist yet on the very first render (room is still `undefined`, so
  // the early-return "Carregando…" branch renders instead).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setBaseWidth(Math.min(Math.round(width), MAX_PAGE_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [room]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === viewportRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [socket.chatHistory.length]);

  useEffect(() => {
    if (pendingTextAt) textInputRef.current?.focus();
  }, [pendingTextAt]);

  const page = socket.page || room?.currentPage || 1;
  const renderWidth = Math.round(baseWidth * zoom);

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
        const radius = c.style === "laser" ? 11 : 5;

        if (c.style === "laser") {
          ctx.fillStyle = "rgba(245, 166, 35, 0.25)";
          ctx.beginPath();
          ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#F5A623";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#F5F0E8";
        ctx.fillText(c.userName, x + radius + 4, y - radius - 2);
      }
    },
    [socket.you?.userId],
  );

  useEffect(() => {
    redraw(socket.strokes, socket.cursors, null);
  }, [socket.strokes, socket.cursors, redraw]);

  function syncCanvasSize() {
    const canvas = canvasRef.current;
    const box = pageBoxRef.current;
    if (!canvas || !box) return;
    canvas.width = box.clientWidth;
    canvas.height = box.clientHeight;
    redraw(socket.strokes, socket.cursors, null);
  }

  function pointFromEvent(e: React.PointerEvent | React.MouseEvent): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!canvasRef.current) return;
    const [x, y] = pointFromEvent(e);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const now = Date.now();
    if (now - lastCursorSentRef.current > CURSOR_THROTTLE_MS) {
      lastCursorSentRef.current = now;
      socket.sendCursor(x, y, isHost && tool === "laser" ? "laser" : "normal");
    }

    if (drawingRef.current) {
      currentStrokeRef.current.push([x, y]);
      redraw(socket.strokes, socket.cursors, currentStrokeRef.current);
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isHost || tool !== "pen") return;
    drawingRef.current = true;
    currentStrokeRef.current = [pointFromEvent(e)];
  }

  function handlePointerUp() {
    if (isHost && drawingRef.current) {
      drawingRef.current = false;
      if (currentStrokeRef.current.length > 1) socket.sendStroke(currentStrokeRef.current, PEN_COLOR);
      currentStrokeRef.current = [];
    }
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isHost || tool !== "text") return;
    textActionTakenRef.current = false;
    setPendingTextAt(pointFromEvent(e));
  }

  // Enter commits, Escape cancels, and blurring the input (clicking
  // away) commits too -- but React removing the input from the DOM
  // (on Escape's setPendingTextAt(null)) also fires a native blur on
  // it, whose handler closure still holds the PRE-Escape state.
  // textActionTakenRef makes whichever of the two fires first win,
  // instead of Escape's cancel being silently overridden by a
  // stale-closure commit right after.
  function commitText() {
    if (textActionTakenRef.current) return;
    textActionTakenRef.current = true;
    if (pendingTextAt && textDraft.trim()) {
      socket.sendText(pendingTextAt[0], pendingTextAt[1], textDraft.trim(), PEN_COLOR, TEXT_FONT_DEFAULT);
    }
    setPendingTextAt(null);
    setTextDraft("");
  }

  function cancelText() {
    if (textActionTakenRef.current) return;
    textActionTakenRef.current = true;
    setPendingTextAt(null);
    setTextDraft("");
  }

  // Fractional (0..1) position within the page box -- the same
  // coordinate space cursors/strokes/text already travel in (see
  // useRoomSocket's own comment), computed against pageBoxRef instead
  // of canvasRef since annotations render as their own layer, not
  // through the canvas that the "select" tool intentionally makes
  // click-through.
  function textPointFromEvent(e: React.PointerEvent): [number, number] {
    const box = pageBoxRef.current;
    if (!box) return [0, 0];
    const rect = box.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  function handleTextPointerDown(e: React.PointerEvent, tId: string, tx: number, ty: number) {
    if (!isHost) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [px, py] = textPointFromEvent(e);
    dragOffsetRef.current = [tx - px, ty - py];
    setDraggingText({ id: tId, x: tx, y: ty });
  }

  function handleTextPointerMove(e: React.PointerEvent) {
    if (!draggingText) return;
    const [px, py] = textPointFromEvent(e);
    const x = Math.min(1, Math.max(0, px + dragOffsetRef.current[0]));
    const y = Math.min(1, Math.max(0, py + dragOffsetRef.current[1]));
    setDraggingText((d) => (d ? { ...d, x, y } : d));
  }

  function handleTextPointerUp() {
    if (!draggingText) return;
    socket.moveText(draggingText.id, draggingText.x, draggingText.y);
    setDraggingText(null);
  }

  function resizeAnnotation(tId: string, currentSize: number, delta: number) {
    const next = Math.min(TEXT_FONT_MAX, Math.max(TEXT_FONT_MIN, currentSize + delta));
    if (next !== currentSize) socket.resizeText(tId, next);
  }

  async function endRoom() {
    if (!id || endingRoom) return;
    setEndingRoom(true);
    try {
      await bookclubApi.deleteRoom(id);
      navigate("/clube-do-livro");
    } catch {
      setEndingRoom(false);
      setConfirmingEnd(false);
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewportRef.current?.requestFullscreen();
    }
  }

  function submitChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    socket.sendChat(chatDraft.trim());
    setChatDraft("");
  }

  function quoteCurrentPage() {
    setChatDraft((d) => `${d}${d ? " " : ""}(pág. ${page}) `);
  }

  function submitPageRequest(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(pageRequestDraft);
    if (!Number.isInteger(n) || n < 1) return;
    socket.sendChat(`Podemos ir para a página ${n}?`, n);
    setPageRequestDraft("");
  }

  // react-pdf compares `file` by reference to decide whether to
  // reload -- a fresh {data: pdfData} object literal on every render
  // (e.g. triggered by onRenderSuccess -> setBaseWidth) looks like "a
  // new file" to it, so it tries to reload from the SAME ArrayBuffer.
  // pdfjs transfers that buffer to its worker on the first load,
  // detaching it -- the second "reload" then throws "Cannot perform
  // Construct on a detached ArrayBuffer". Memoizing on pdfData's own
  // identity keeps `file` stable across re-renders.
  const pdfFile = useMemo(() => (pdfData ? { data: pdfData } : null), [pdfData]);

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

  // Selecionar: canvas lets pointer events fall through to the PDF's
  // own text layer underneath, so native browser text selection/copy
  // works. Every other tool needs the canvas to catch the pointer
  // itself (drawing, placing text, or just knowing where to send
  // cursor updates from).
  const canvasInteractive = tool !== "select";

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

          <div className="flex items-center gap-2">
            {isHost && (
              <button
                onClick={() => setConfirmingEnd(true)}
                disabled={endingRoom}
                title="Encerrar a sala -- o livro terminou"
                className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-heading font-semibold text-red-300/80 border border-red-400/30 hover:border-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconEnd size={15} />
                {endingRoom ? "Encerrando…" : "Encerrar sala"}
              </button>
            )}
            <div className="flex items-center gap-3 glass-card px-4 py-2">
            <button
              disabled={!isHost || page <= 1}
              onClick={() => socket.setPage(page - 1)}
              className="text-buteco-cream/80 hover:text-buteco-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={isHost ? undefined : "só o mestre da sala vira a página"}
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
              title={isHost ? undefined : "só o mestre da sala vira a página"}
            >
              próxima →
            </button>
            </div>
          </div>
        </div>

        {/* Toolbar: zoom + fullscreen for everyone, presenter tools
            (select/laser/pen/text) host-only -- only the host can
            leave a mark or point with a highlighted cursor, matching
            the same "só o mestre mexe na página" rule as page turns. */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1 glass-card p-1.5">
            <button
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              className="w-8 h-8 rounded-lg text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title="Diminuir zoom"
            >
              −
            </button>
            <button
              onClick={() => setZoom(1)}
              className="px-2 h-8 rounded-lg font-mono text-xs text-buteco-cream/70 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title="Redefinir zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
              className="w-8 h-8 rounded-lg text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title="Aumentar zoom"
            >
              +
            </button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
            </button>
          </div>

          {isHost && (
            <div className="flex items-center gap-1 glass-card p-1.5">
              {(
                [
                  ["select", IconSelect, "Selecionar / ler texto"],
                  ["laser", IconLaser, "Apontador (some sozinho)"],
                  ["pen", IconPen, "Caneta"],
                  ["text", IconText, "Escrever texto"],
                ] as [Tool, typeof IconSelect, string][]
              ).map(([t, Icon, label]) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  title={label}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    tool === t ? "bg-buteco-amber text-buteco-navy" : "text-buteco-cream/80 hover:bg-white/10"
                  }`}
                >
                  <Icon size={17} />
                </button>
              ))}
              <span className="w-px h-5 bg-white/10 mx-1" />
              <button
                onClick={() => socket.clearDrawing()}
                title="Limpar anotações desta página"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-buteco-cream/80 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <IconTrash size={17} />
              </button>
            </div>
          )}
        </div>

        {!isHost && (
          <p className="text-buteco-cream/40 text-xs mb-3 font-mono">
            só quem abriu a sala vira página e desenha -- peça troca de página pelo chat, ao lado →
          </p>
        )}

        <div
          ref={viewportRef}
          className="relative glass-card overflow-auto flex justify-center"
          style={{ maxHeight: "70vh" }}
        >
          <div
            ref={pageBoxRef}
            className="relative shrink-0"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {pdfFile ? (
              <Document file={pdfFile} onLoadSuccess={({ numPages }) => setNumPages(numPages)} loading={<PdfPlaceholder />}>
                <Page pageNumber={page} width={renderWidth} onRenderSuccess={syncCanvasSize} loading={<PdfPlaceholder />} />
              </Document>
            ) : (
              <PdfPlaceholder />
            )}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{
                pointerEvents: canvasInteractive ? "auto" : "none",
                touchAction: canvasInteractive ? "none" : "auto",
                cursor: tool === "pen" || tool === "text" ? "crosshair" : tool === "laser" ? "pointer" : "default",
              }}
              onPointerDown={handlePointerDown}
              onClick={handleCanvasClick}
            />
            {pendingTextAt && (
              <input
                ref={textInputRef}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") cancelText();
                }}
                onBlur={commitText}
                placeholder="Escreva e pressione Enter…"
                className="absolute z-10 bg-buteco-brown-dark border border-buteco-amber rounded px-2 py-1 text-sm text-buteco-cream font-heading outline-none"
                style={{
                  left: `${pendingTextAt[0] * 100}%`,
                  top: `${pendingTextAt[1] * 100}%`,
                  transform: "translateY(-100%)",
                }}
              />
            )}

            {/* Real DOM elements, not canvas-drawn -- lets browser text
                selection/copy work on annotations same as on the PDF's
                own text layer, and lets the host drag/resize/delete
                one annotation individually instead of only an
                all-or-nothing clear. */}
            {socket.texts.map((t) => {
              const isDragging = draggingText?.id === t.id;
              const x = isDragging ? draggingText.x : t.x;
              const y = isDragging ? draggingText.y : t.y;
              return (
                <div
                  key={t.id}
                  className="absolute z-10 flex items-center gap-1"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: "translateY(-100%)" }}
                >
                  <span
                    onPointerDown={isHost ? (e) => handleTextPointerDown(e, t.id, t.x, t.y) : undefined}
                    onPointerMove={isHost ? handleTextPointerMove : undefined}
                    onPointerUp={isHost ? handleTextPointerUp : undefined}
                    className="rounded px-1.5 py-0.5 font-heading font-semibold whitespace-nowrap"
                    style={{
                      backgroundColor: "rgba(42, 23, 15, 0.85)",
                      color: t.color,
                      fontSize: t.fontSize,
                      cursor: isHost ? (isDragging ? "grabbing" : "grab") : "text",
                      touchAction: isHost ? "none" : undefined,
                    }}
                  >
                    {t.text}
                  </span>
                  {isHost && !isDragging && (
                    <span className="flex items-center gap-0.5 rounded bg-buteco-brown-dark/90 border border-white/10 px-0.5">
                      <IconDrag size={12} className="text-buteco-cream/30 mx-0.5" />
                      <button
                        onClick={() => resizeAnnotation(t.id, t.fontSize, -TEXT_FONT_STEP)}
                        title="Diminuir texto"
                        className="w-5 h-5 flex items-center justify-center text-buteco-cream/70 hover:text-buteco-amber cursor-pointer text-xs"
                      >
                        −
                      </button>
                      <button
                        onClick={() => resizeAnnotation(t.id, t.fontSize, TEXT_FONT_STEP)}
                        title="Aumentar texto"
                        className="w-5 h-5 flex items-center justify-center text-buteco-cream/70 hover:text-buteco-amber cursor-pointer text-xs"
                      >
                        +
                      </button>
                      <button
                        onClick={() => socket.removeText(t.id)}
                        title="Remover esta anotação"
                        className="w-5 h-5 flex items-center justify-center text-buteco-cream/70 hover:text-red-400 cursor-pointer"
                      >
                        <IconClose size={11} />
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="w-full lg:w-80 shrink-0 flex flex-col glass-card overflow-hidden" style={{ maxHeight: 700 }}>
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="font-heading font-semibold text-buteco-cream">Chat</h2>
          <p className="text-buteco-cream/40 text-xs">{socket.participants.map((p) => p.userName).join(", ")}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {socket.chatHistory.map((m) =>
            m.requestedPage ? (
              <div key={m.id} className="rounded-lg border border-buteco-amber/30 bg-buteco-amber/10 p-2">
                <p className="text-xs text-buteco-cream/90">
                  <span className="font-heading text-buteco-amber">{m.userName}</span> {m.body}
                </p>
                {isHost && (
                  <button
                    onClick={() => socket.setPage(m.requestedPage!)}
                    className="mt-1 text-xs font-heading font-semibold text-buteco-navy bg-buteco-amber rounded px-2 py-0.5 cursor-pointer hover:bg-buteco-amber-light transition-colors"
                  >
                    Ir para a página {m.requestedPage} →
                  </button>
                )}
              </div>
            ) : (
              <div key={m.id}>
                <span className="font-heading text-sm text-buteco-amber">{m.userName}</span>
                <p className="text-buteco-cream/90 text-sm break-words">{m.body}</p>
              </div>
            ),
          )}
          <div ref={chatEndRef} />
        </div>

        {!isHost && (
          <form onSubmit={submitPageRequest} className="px-3 pt-3 border-t border-white/10 flex gap-2 items-center">
            <span className="flex items-center gap-1 text-xs text-buteco-cream/50 shrink-0">
              <IconBookmark size={13} />
              pedir página
            </span>
            <input
              type="number"
              min={1}
              value={pageRequestDraft}
              onChange={(e) => setPageRequestDraft(e.target.value)}
              placeholder={String(page)}
              className="field flex-1 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="px-2 py-1.5 rounded-lg bg-buteco-brown-light text-buteco-cream text-xs font-heading font-semibold border border-buteco-amber/40 hover:border-buteco-amber transition-colors cursor-pointer"
            >
              Pedir
            </button>
          </form>
        )}

        <form onSubmit={submitChat} className="p-3 border-t border-white/10 flex gap-2">
          <button
            type="button"
            onClick={quoteCurrentPage}
            title="Citar a página atual"
            className="px-2 rounded-lg flex items-center text-buteco-cream/60 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <IconQuote size={16} />
          </button>
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

      <ConfirmDialog
        open={confirmingEnd}
        title="Encerrar esta sala?"
        description="Isso marca o livro como concluído e a sala deixa de existir para todo mundo."
        confirmLabel="Encerrar"
        danger
        busy={endingRoom}
        onConfirm={endRoom}
        onCancel={() => setConfirmingEnd(false)}
      />
    </div>
  );
}

function PdfPlaceholder() {
  return <div className="w-full aspect-[3/4] flex items-center justify-center text-buteco-cream/40">Carregando PDF…</div>;
}
