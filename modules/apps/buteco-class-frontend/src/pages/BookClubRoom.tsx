import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { bookclubApi, type Room } from "../lib/bookclubApi.js";
import { useRoomSocket, type Stroke } from "../lib/useRoomSocket.js";
import { Banner, Button, ConfirmDialog, Input, PageShell, Skeleton, Spinner } from "../components/ui/index.js";
import {
  RoomHeader,
  RoomShell,
  RoomStatusBadge,
  ParticipantsStrip,
  ChatPanel,
} from "../components/room/index.js";
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
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<[number, number][]>([]);
  const lastCursorSentRef = useRef(0);
  const textActionTakenRef = useRef(false);
  const dragOffsetRef = useRef<[number, number]>([0, 0]);

  const socket = useRoomSocket(id ?? "");
  const isHost = Boolean(socket.you && socket.you.userId === socket.hostId);
  // Server already rejects every mutating WS message on a closed room
  // (bookclub-api's app.ts onMessage guard) -- this just keeps the UI
  // from offering controls that would silently do nothing.
  const isClosed = socket.status === "closed";

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

  const page = socket.page || room?.currentPage || 1;
  const renderWidth = Math.round(baseWidth * zoom);

  // Page turns from the keyboard for the host (same rule as the
  // on-screen arrows). Skips when focus is in an input/textarea --
  // arrows must stay characters there (chat composer, page-request
  // field, annotation editor).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!isHost || isClosed) return;
      if (e.key === "ArrowLeft" && page > 1) socket.setPage(page - 1);
      if (e.key === "ArrowRight" && !(numPages > 0 && page >= numPages)) socket.setPage(page + 1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isHost, isClosed, page, numPages, socket]);

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
      await bookclubApi.closeRoom(id);
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

  function submitChatDraft() {
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

  if (room === undefined) {
    return (
      <PageShell width="full">
        <div role="status" className="flex items-center gap-3 text-buteco-cream/60 text-sm">
          <Spinner size="sm" /> Carregando a sala…
        </div>
      </PageShell>
    );
  }
  if (room === null) {
    return (
      <PageShell width="content">
        <div className="text-center py-20">
          <p className="text-buteco-cream/60 mb-4">Essa sala não existe.</p>
          <Link to="/clube-do-livro" className="text-buteco-amber hover:underline">
            Voltar para o Clube do Livro
          </Link>
        </div>
      </PageShell>
    );
  }

  // Selecionar: canvas lets pointer events fall through to the PDF's
  // own text layer underneath, so native browser text selection/copy
  // works. Every other tool needs the canvas to catch the pointer
  // itself (drawing, placing text, or just knowing where to send
  // cursor updates from).
  const canvasInteractive = tool !== "select";

  return (
    <RoomShell
      header={
        <RoomHeader
          title={room.title}
          status={<RoomStatusBadge connected={socket.connected} closed={isClosed} />}
          actions={
            isHost &&
            !isClosed && (
              <button
                onClick={() => setConfirmingEnd(true)}
                disabled={endingRoom}
                title="Encerrar a sala -- o livro terminou"
                className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-heading font-semibold text-red-300/80 border border-red-400/30 hover:border-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconEnd size={15} />
                {endingRoom ? "Encerrando…" : "Encerrar sala"}
              </button>
            )
          }
        />
      }
      aside={
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="glass-card rounded-2xl px-3 sm:px-4 py-2.5 shrink-0">
            <ParticipantsStrip participants={socket.participants} hostId={socket.hostId} currentUserId={socket.you?.userId ?? null} />
          </div>

          <div className="glass-card rounded-2xl overflow-hidden flex flex-col h-96 lg:h-auto lg:flex-1 min-h-0">
            <ChatPanel
              messages={socket.chatHistory}
              disabled={!socket.you || isClosed}
              disabledPlaceholder={isClosed ? "sala encerrada" : "entre para conversar"}
              placeholder={socket.you ? "Escreva algo…" : "Entre para conversar"}
              draft={chatDraft}
              onDraftChange={setChatDraft}
              onSend={submitChatDraft}
              highlightPageNumbers
              onGoToPage={isHost ? (n) => socket.setPage(n) : undefined}
              toolbar={
                <button
                  type="button"
                  onClick={quoteCurrentPage}
                  title="Citar a página atual"
                  className="px-2 rounded-lg flex items-center text-buteco-cream/60 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  <IconQuote size={16} />
                </button>
              }
              aboveComposer={
                !isHost &&
                !isClosed && (
                  <form onSubmit={submitPageRequest} className="px-2.5 sm:px-3 pt-2.5 border-t border-white/10 flex gap-2 items-center">
                    <span className="flex items-center gap-1 text-xs text-buteco-cream/50 shrink-0">
                      <IconBookmark size={13} />
                      pedir página
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={pageRequestDraft}
                      onChange={(e) => setPageRequestDraft(e.target.value)}
                      placeholder={String(page)}
                      size="sm"
                      className="w-20"
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      Pedir
                    </Button>
                  </form>
                )
              }
              emptyHint="Ninguém falou ainda -- combine a próxima página por aqui."
            />
          </div>
        </div>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col gap-2.5">
        {!isHost && !isClosed && (
          <Banner tone="info" className="shrink-0">
            só quem abriu a sala vira página e desenha -- peça troca de página por aqui.
          </Banner>
        )}

        {/* Toolbar: zoom + fullscreen + page turns for everyone,
            presenter tools (select/laser/pen/text) host-only -- only
            the host can leave a mark or point with a highlighted
            cursor, matching the same "só o mestre mexe na página" rule
            as page turns. Host-only pieces disappear once the room is
            closed: nothing left to draw or point at, read-only from
            here on. */}
        <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-1 glass-card p-1.5 rounded-xl">
            <button
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              className="w-8 h-8 rounded-lg text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title="Diminuir zoom"
              aria-label="Diminuir zoom"
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
              aria-label="Aumentar zoom"
            >
              +
            </button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button
              onClick={() => socket.setPage(page - 1)}
              disabled={!isHost || isClosed || page <= 1}
              className="px-2 h-8 rounded-lg font-mono text-xs text-buteco-cream/80 hover:text-buteco-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={isClosed ? "sala encerrada" : isHost ? undefined : "só o mestre da sala vira a página"}
            >
              ← anterior
            </button>
            <span className="px-1 font-mono text-sm text-buteco-amber">
              {page}
              {numPages ? ` / ${numPages}` : ""}
            </span>
            <button
              onClick={() => socket.setPage(page + 1)}
              disabled={!isHost || isClosed || (numPages > 0 && page >= numPages)}
              className="px-2 h-8 rounded-lg font-mono text-xs text-buteco-cream/80 hover:text-buteco-amber disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={isClosed ? "sala encerrada" : isHost ? undefined : "só o mestre vira a página"}
            >
              próxima →
            </button>
            <span className="w-px h-5 bg-white/10 mx-1" />
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-buteco-cream/80 hover:text-buteco-amber hover:bg-white/10 transition-colors cursor-pointer"
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
            </button>
          </div>

          {isHost && !isClosed && (
            <div className="flex items-center gap-1 glass-card p-1.5 rounded-xl">
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
                  aria-label={label}
                  aria-pressed={tool === t}
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
                aria-label="Limpar anotações desta página"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-buteco-cream/80 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <IconTrash size={17} />
              </button>
            </div>
          )}
        </div>

        <div
          ref={viewportRef}
          className="relative flex-1 min-h-0 max-h-[80dvh] lg:max-h-none glass-card rounded-2xl overflow-auto flex justify-center"
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
                        aria-label="Diminuir texto"
                        className="w-5 h-5 flex items-center justify-center text-buteco-cream/70 hover:text-buteco-amber cursor-pointer text-xs"
                      >
                        −
                      </button>
                      <button
                        onClick={() => resizeAnnotation(t.id, t.fontSize, TEXT_FONT_STEP)}
                        title="Aumentar texto"
                        aria-label="Aumentar texto"
                        className="w-5 h-5 flex items-center justify-center text-buteco-cream/70 hover:text-buteco-amber cursor-pointer text-xs"
                      >
                        +
                      </button>
                      <button
                        onClick={() => socket.removeText(t.id)}
                        title="Remover esta anotação"
                        aria-label="Remover esta anotação"
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

      <ConfirmDialog
        open={confirmingEnd}
        title="Encerrar esta sala?"
        description="Isso marca o livro como concluído. A sala continua na lista como encerrada -- ninguém mais pode virar página, desenhar ou mandar mensagem, mas o PDF e o histórico de chat continuam disponíveis pra quem quiser rever."
        confirmLabel="Encerrar"
        danger
        busy={endingRoom}
        onConfirm={endRoom}
        onCancel={() => setConfirmingEnd(false)}
      />
    </RoomShell>
  );
}

function PdfPlaceholder() {
  return <Skeleton className="w-full aspect-[3/4]" />;
}