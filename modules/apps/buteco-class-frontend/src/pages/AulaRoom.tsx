import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { Mic, MicOff, MonitorPlay, ScreenShare, Video, VideoOff } from "lucide-react";
import { classroomApi, type Room } from "../lib/classroomApi.js";
import { useClassSocket, type SignalPayload } from "../lib/useClassSocket.js";
import { useWebRTCBroadcast } from "../lib/useWebRTCBroadcast.js";
import { Button, ConfirmDialog, IconButton, PageShell, Spinner } from "../components/ui/index.js";
import { IconEnd, IconMaximize, IconMinimize } from "../components/RoomIcons.js";
import { ChatPanel, NotepadPanel, PanelTabs, ParticipantsStrip, RoomHeader, RoomShell, RoomStatusBadge, RtcErrorBanner } from "../components/room/index.js";
import { cn } from "../lib/cn.js";

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
  const [asideTab, setAsideTab] = useState<"chat" | "notepad">("chat");
  // Track.enabled mirrors for the UI-only mic/cam toggles -- the
  // tracks themselves are the broadcast source of truth, these just
  // keep the icons honest. Re-derived on every new share.
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const notepadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const signalHandlerRef = useRef<(from: string, payload: SignalPayload) => void>(() => {});
  const socket = useClassSocket(id ?? "", (from, payload) => signalHandlerRef.current(from, payload));
  const isHost = Boolean(socket.you && socket.you.userId === socket.hostId);
  const isClosed = socket.status === "closed";

  const rtc = useWebRTCBroadcast({
    isHost,
    hostId: socket.hostId,
    you: socket.you,
    participants: socket.participants,
    sendSignal: socket.sendSignal,
  });
  signalHandlerRef.current = rtc.handleSignal;

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
    if (localVideoRef.current) localVideoRef.current.srcObject = rtc.localStream;
  }, [rtc.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = rtc.remoteStream;
  }, [rtc.remoteStream]);

  useEffect(() => {
    const audio = rtc.localStream?.getAudioTracks() ?? [];
    const video = rtc.localStream?.getVideoTracks() ?? [];
    setMicMuted(audio.length > 0 && !audio.some((t) => t.enabled));
    setCameraOff(video.length > 0 && !video.some((t) => t.enabled));
  }, [rtc.localStream]);

  useEffect(() => {
    const onFsChange = () => setStageFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function handleNotepadChange(value: string) {
    setNotepadDraft(value);
    if (notepadTimerRef.current) clearTimeout(notepadTimerRef.current);
    notepadTimerRef.current = setTimeout(() => socket.updateNotepad(value), NOTEPAD_DEBOUNCE_MS);
  }

  function toggleMic() {
    const track = rtc.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicMuted(!track.enabled);
  }

  function toggleCamera() {
    const track = rtc.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }

  function sendChatDraft() {
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

  function toggleStageFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      stageRef.current?.requestFullscreen();
    }
  }

  if (room === undefined) {
    return (
      <PageShell width="full">
        <div role="status" className="flex items-center gap-3 text-buteco-cream/60 text-sm">
          <Spinner size="sm" /> Carregando a aula…
        </div>
      </PageShell>
    );
  }
  if (room === null) {
    return (
      <PageShell width="content">
        <div className="text-center py-20">
          <p className="text-buteco-cream/60 mb-4">Essa aula não existe.</p>
          <Link to="/aulas" className="text-buteco-amber hover:underline">
            Voltar para Aulas
          </Link>
        </div>
      </PageShell>
    );
  }

  const hasAudio = Boolean(rtc.localStream?.getAudioTracks()[0]);
  const hasCameraVideo = rtc.sharing === "camera" && Boolean(rtc.localStream?.getVideoTracks()[0]);
  const chatDisabled = !socket.you || isClosed;

  return (
    <RoomShell
      header={
        <RoomHeader
          title={room.title}
          status={<RoomStatusBadge connected={socket.connected} closed={isClosed} liveLabel="aula ao vivo" />}
          actions={
            isHost &&
            !isClosed && (
              <button
                onClick={() => setConfirmingEnd(true)}
                disabled={endingRoom}
                title="Encerrar a aula"
                className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-heading font-semibold text-red-300/80 border border-red-400/30 hover:border-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <IconEnd size={15} />
                {endingRoom ? "Encerrando…" : "Encerrar aula"}
              </button>
            )
          }
        />
      }
      // Stage: live video (host's screen/camera share) or, waiting on
      // it, one of the role-specific empty states. Fullscreen borrows
      // the pattern already used by the book club's PDF viewport.
      aside={
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="glass-card rounded-2xl px-3 sm:px-4 py-2.5 shrink-0">
            <ParticipantsStrip participants={socket.participants} hostId={socket.hostId} currentUserId={socket.you?.userId ?? null} />
          </div>

          <PanelTabs
            tabs={[
              { id: "chat", label: "Chat" },
              { id: "notepad", label: "Bloco" },
            ]}
            active={asideTab}
            onChange={setAsideTab}
            label="Painéis da aula"
            className="lg:hidden"
          />

          {/* One instance per panel; the tabs toggle them on mobile,
              `lg:flex` puts both on screen at once on desktop. */}
          <div
            aria-label="Chat da aula"
            className={cn(
              "glass-card rounded-2xl overflow-hidden flex-col flex-1 min-h-0 lg:flex",
              asideTab === "chat" ? "flex" : "hidden",
            )}
          >
            <ChatPanel
              messages={socket.chatHistory}
              disabled={chatDisabled}
              disabledPlaceholder={isClosed ? "aula encerrada" : "entre para conversar"}
              placeholder={socket.you ? "Escreva algo…" : "Entre para conversar"}
              draft={chatDraft}
              onDraftChange={setChatDraft}
              onSend={sendChatDraft}
            />
          </div>

          <div
            aria-label="Bloco de notas da aula"
            className={cn(
              "glass-card rounded-2xl overflow-hidden flex-col flex-1 min-h-0 lg:flex",
              asideTab === "notepad" ? "flex" : "hidden",
            )}
          >
            <NotepadPanel
              value={notepadDraft}
              onChange={handleNotepadChange}
              disabled={isClosed}
              disabledPlaceholder="aula encerrada"
              placeholder="anote aqui -- todo mundo na aula vê em tempo real"
              emptyNote="salvo no servidor, mas some quando a aula esvazia"
            />
          </div>
        </div>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col">
        <div ref={stageRef} className="flex-1 min-h-0 relative glass-card rounded-2xl p-3 sm:p-4 flex flex-col">
          <div className="flex-1 min-h-0 rounded-lg bg-black/40 flex items-center justify-center overflow-hidden relative">
            {isHost ? (
              rtc.localStream ? (
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-center px-6">
                  <ScreenShare size={28} className="text-buteco-amber/50" aria-hidden="true" />
                  <p className="text-buteco-cream/45 text-sm max-w-xs">
                    {isClosed ? "aula encerrada" : "compartilhe sua tela ou câmera pra começar"}
                  </p>
                </div>
              )
            ) : rtc.remoteStream ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-center px-6">
                <MonitorPlay size={28} className="text-buteco-amber/50" aria-hidden="true" />
                <p className="text-buteco-cream/45 text-sm max-w-xs">
                  {isClosed ? "aula encerrada" : "esperando o professor compartilhar a tela ou câmera…"}
                </p>
              </div>
            )}
          </div>

          {/* Fullscreen is genuinely useful on a classroom stage: the
              viewer's browser chrome goes away for the class. */}
          <IconButton
            label={stageFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            onClick={toggleStageFullscreen}
            className="absolute top-2.5 right-2.5 z-10 bg-black/40 hover:bg-black/60 border border-white/10"
          >
            {stageFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
          </IconButton>
        </div>

        {isHost && !isClosed && (
          <div className="shrink-0 mt-3 flex items-center flex-wrap gap-2">
            <Button size="sm" variant={rtc.sharing === "screen" ? "primary" : "secondary"} onClick={() => rtc.startSharing("screen")}>
              Compartilhar tela
            </Button>
            <Button size="sm" variant={rtc.sharing === "camera" ? "primary" : "secondary"} onClick={() => rtc.startSharing("camera")}>
              Câmera
            </Button>
            {rtc.sharing && (
              <Button size="sm" variant="danger" onClick={rtc.stopSharing}>
                Parar
              </Button>
            )}
            {/* Mute/cam flip track.enabled on the local stream only --
                WebRTC propagates it; no server contract involved. The
                camera toggle only exists for a camera share: killing
                the single track of a screen share just freezes it. */}
            {hasAudio && (
              <IconButton label={micMuted ? "Ativar microfone" : "Silenciar microfone"} active={micMuted} onClick={toggleMic} className="border border-white/10">
                {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
              </IconButton>
            )}
            {hasCameraVideo && (
              <IconButton label={cameraOff ? "Ligar câmera" : "Desligar câmera"} active={cameraOff} onClick={toggleCamera} className="border border-white/10">
                {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}
              </IconButton>
            )}
          </div>
        )}
        {rtc.shareError && (
          <div className="shrink-0 mt-2">
            <RtcErrorBanner error={rtc.shareError} />
          </div>
        )}
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
    </RoomShell>
  );
}