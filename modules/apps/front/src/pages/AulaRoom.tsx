import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { classroomApi, type Room } from "../lib/classroomApi.js";
import { useClassSocket } from "../lib/useClassSocket.js";
import { useLiveShare } from "../lib/useLiveShare.js";
import ConfirmDialog from "../components/ConfirmDialog.js";
import { IconEnd } from "../components/RoomIcons.js";

// Debounced broadcast: sending on every keystroke would flood the WS
// and (worse) fight every other participant's cursor position on
// every character. 400ms is short enough to feel "live", long enough
// to collapse a fast typist's keystrokes into a handful of messages.
const NOTEPAD_DEBOUNCE_MS = 400;

export default function AulaRoom() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [notepadDraft, setNotepadDraft] = useState("");
  const notepadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const socket = useClassSocket(id ?? "");
  const isHost = Boolean(socket.you && socket.you.userId === socket.hostId);
  const isClosed = socket.status === "closed";

  const share = useLiveShare({
    roomId: id ?? "",
    you: socket.you,
    stopShare: socket.stopShare,
  });

  useEffect(() => {
    if (!id) return;
    classroomApi
      .getRoom(id)
      .then(setRoom)
      .catch(() => setRoom(null));
  }, [id]);

  // classroom-api's WS broadcast for notepad:update always excludes
  // the sender (see that service's app.ts) -- so every change to
  // socket.notepad reaching this effect came from someone else (or is
  // the initial `init` payload), never an echo of this client's own
  // pending edit. Safe to just mirror it into the textarea directly.
  useEffect(() => {
    setNotepadDraft(socket.notepad);
  }, [socket.notepad]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [socket.chatHistory.length]);

  function handleNotepadChange(value: string) {
    setNotepadDraft(value);
    if (notepadTimerRef.current) clearTimeout(notepadTimerRef.current);
    notepadTimerRef.current = setTimeout(() => socket.updateNotepad(value), NOTEPAD_DEBOUNCE_MS);
  }

  function submitChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatDraft.trim()) return;
    socket.sendChat(chatDraft.trim());
    setChatDraft("");
  }

  async function endRoom() {
    if (!id || endingRoom) return;
    setEndingRoom(true);
    try {
      await classroomApi.closeRoom(id);
      navigate("/aulas");
    } catch {
      setEndingRoom(false);
      setConfirmingEnd(false);
    }
  }

  if (room === undefined) return <p className="text-buteco-cream/60">Carregando…</p>;
  if (room === null) {
    return (
      <div className="text-center py-20">
        <p className="text-buteco-cream/60 mb-4">Essa aula não existe.</p>
        <Link to="/aulas" className="text-buteco-amber hover:underline">
          Voltar para Aulas
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col animate-fade-in-up">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="font-heading font-bold text-2xl text-buteco-cream">{room.title}</h1>
          <p className="text-buteco-cream/50 text-sm font-mono">
            {isClosed
              ? "aula encerrada · somente leitura"
              : `${socket.connected ? "conectado" : "conectando…"} · ${socket.participants.length} ${
                  socket.participants.length === 1 ? "pessoa" : "pessoas"
                } na aula`}
          </p>
        </div>

        {isHost && !isClosed && (
          <button
            onClick={() => setConfirmingEnd(true)}
            disabled={endingRoom}
            title="Encerrar a aula"
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-heading font-semibold text-red-300/80 border border-red-400/30 hover:border-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconEnd size={15} />
            {endingRoom ? "Encerrando…" : "Encerrar aula"}
          </button>
        )}
      </div>

      {/* Three panels, left to right: live video (share da tela ou
          câmera do host), bloco de notas compartilhado, chat -- matches
          the product sketch for this feature 1:1. */}
      <div className="flex flex-col lg:flex-row gap-4" style={{ height: "min(70vh, 640px)" }}>
        <div className="flex-[3] min-w-0 glass-card p-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-lg bg-black/40 flex items-center justify-center overflow-hidden relative">
            {socket.frame ? (
              <img src={socket.frame} alt="tela compartilhada pelo professor" className="w-full h-full object-contain" />
            ) : socket.sharing ? (
              <p className="text-buteco-cream/40 text-sm text-center px-6">recebendo a imagem…</p>
            ) : (
              <p className="text-buteco-cream/40 text-sm text-center px-6">
                {isClosed
                  ? "aula encerrada"
                  : isHost
                    ? "compartilhe sua tela ou câmera pra começar"
                    : "esperando o professor compartilhar a tela ou câmera…"}
              </p>
            )}
          </div>

          {isHost && !isClosed && (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => share.start("screen")}
                disabled={socket.sharing}
                className="px-3 h-9 rounded-lg text-xs font-heading font-semibold border border-white/15 text-buteco-cream/80 hover:border-buteco-amber/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Compartilhar tela
              </button>
              <button
                onClick={() => share.start("camera")}
                disabled={socket.sharing}
                className="px-3 h-9 rounded-lg text-xs font-heading font-semibold border border-white/15 text-buteco-cream/80 hover:border-buteco-amber/40 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Câmera
              </button>
              {socket.sharing && (
                <button
                  onClick={share.stop}
                  className="px-3 h-9 rounded-lg text-xs font-heading font-semibold border border-red-400/30 text-red-300/80 hover:border-red-400/60 hover:text-red-300 transition-colors cursor-pointer"
                >
                  Parar
                </button>
              )}
              {share.error && <p className="text-red-300/80 text-xs font-mono ml-1">{share.error}</p>}
            </div>
          )}
        </div>

        <div className="flex-[2] min-w-0 glass-card p-4 flex flex-col">
          <h2 className="font-heading font-semibold text-sm text-buteco-cream/70 uppercase tracking-wide mb-2">
            Bloco de notas
          </h2>
          <textarea
            value={notepadDraft}
            onChange={(e) => handleNotepadChange(e.target.value)}
            disabled={isClosed}
            placeholder={isClosed ? "aula encerrada" : "anote aqui -- todo mundo na aula vê em tempo real"}
            className="field flex-1 resize-none font-mono text-sm leading-relaxed"
          />
        </div>

        <div className="flex-[2] min-w-0 glass-card flex flex-col overflow-hidden">
          <h2 className="font-heading font-semibold text-sm text-buteco-cream/70 uppercase tracking-wide px-4 pt-4 pb-2">
            Chat
          </h2>
          <div className="flex-1 overflow-y-auto px-4 space-y-3 min-h-0">
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
              placeholder={isClosed ? "aula encerrada" : socket.you ? "Escreva algo…" : "Entre para conversar"}
              disabled={!socket.you || isClosed}
              className="field flex-1 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={!socket.you || isClosed}
              className="px-3 rounded-lg bg-buteco-amber text-buteco-navy font-heading font-semibold disabled:opacity-40 cursor-pointer"
            >
              ↑
            </button>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingEnd}
        title="Encerrar esta aula?"
        description="A aula continua na lista como encerrada -- ninguém mais pode compartilhar tela, editar o bloco de notas ou mandar mensagem, mas o histórico de chat continua disponível pra quem quiser rever."
        confirmLabel="Encerrar"
        danger
        busy={endingRoom}
        onConfirm={endRoom}
        onCancel={() => setConfirmingEnd(false)}
      />
    </div>
  );
}
