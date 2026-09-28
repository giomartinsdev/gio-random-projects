import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Clapperboard, Download, ChevronDown, Lock, MonitorPlay, Play, Search, Sparkles, Users, X, Zap } from "lucide-react";
import { api, type Clip, type RoomSummary } from "@/lib/api";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { airplayIcon, arrowRightCircleIcon, loadingIcon, radioButtonIcon } from "@/lib/lottie-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { APP_VERSION, CHANGELOG, type Release } from "@/lib/changelog";

// How often the "salas rolando" list refreshes. Frequent enough that a
// room appearing/emptying out feels close to live, cheap enough (one
// small JSON response) that nobody notices the polling.
const ROOMS_POLL_MS = 5_000;

// "2026-09-15" parsed as UTC midnight comes out a day early in Brazil
// (UTC-3), so the ISO string is formatted by hand instead of through
// Date -- the changelog's dates are calendar dates, not moments.
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d} de ${months[m - 1]} de ${y}`;
}

// Clips live on the server for a limited time (the API carries the
// expiry); the section lists what's there, plays each one in place and
// links the download URLs. One search box answers "por pessoa, sala,
// nome etc." -- every
// searchable field (the clip's name, the room it came from, who cut
// it) is matched against the same query, because a person looking for
// a clip knows SOME of those, rarely which one will hit. Fetched once
// per mount -- clips don't change while you sit on this page.
function Clips() {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<Clip | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listClips()
      .then((list) => {
        if (!cancelled) setClips(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlaying(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  if (!clips && !failed) return null; // still loading: stay quiet
  if (!clips || clips.length === 0) return null; // nothing to show (or the API is down)

  const formatSize = (bytes: number) => {
    if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} kB`;
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? clips.filter((clip) =>
        [clip.name, clip.roomId, clip.owner].some((field) => field?.toLowerCase().includes(q)),
      )
    : clips;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clapperboard className="size-4 text-primary" />
            Clips
          </CardTitle>
          <CardDescription>Recortes de 5 minutos feitos nas salas — abra aqui mesmo ou baixe enquanto existirem.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* One field, every axis: name, room and owner all match the
              same query -- three dropdowns for a list this size would be
              ceremony, not search. */}
          {clips.length > 3 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="buscar por nome, sala ou pessoa"
                className="h-9 pl-8 text-sm"
                aria-label="Buscar clips"
              />
            </div>
          )}
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum clip casa com “{query.trim()}”.
            </p>
          ) : (
            visible.map((clip) => {
              // "2026-09-15T14:03:22Z" shown as the viewer's local day+time.
              const when = new Date(clip.createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div
                  key={clip.id}
                  className="group flex items-center justify-between gap-3 rounded-lg border bg-secondary/30 px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-secondary/60"
                >
                  {/* The whole left side opens the clip in place --
                      opening is the default act, downloading the
                      deliberate one. */}
                  <button
                    type="button"
                    onClick={() => setPlaying(clip)}
                    title="Abrir o clip"
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block font-medium sm:truncate">{clip.name}</span>
                    <span className="block text-xs text-muted-foreground sm:truncate">
                      sala {clip.roomId}
                      {clip.owner && <> · por {clip.owner}</>} · {when} · {formatSize(clip.size)}
                    </span>
                  </button>
                  <span className="inline-flex shrink-0 items-center gap-3 text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => setPlaying(clip)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                    >
                      <Play className="size-3.5" />
                      abrir
                    </button>
                    <a
                      href={api.clipDownloadUrl(clip.id)}
                      download
                      title="Baixar o .webm"
                      className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                    >
                      <Download className="size-3.5" />
                      baixar
                    </a>
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
      {/* The player: same URL the download uses, played by an element
          instead of filed away. Anyone with this page can open it -- the
          bytes are guarded by the clip's unguessable id, nothing else.
          Progressive download (the server doesn't speak Range), so
          seeking inside what's buffered works; a deep seek may restart
          the fetch. Escape and the backdrop close; the video stops
          with the unmount. */}
      {playing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Clip: ${playing.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPlaying(null)}
        >
          <div className="w-full max-w-3xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium">
                {playing.name}
                <span className="text-muted-foreground">
                  {" "}
                  · sala {playing.roomId}
                  {playing.owner && <> · por {playing.owner}</>}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setPlaying(null)}
                aria-label="Fechar"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <video
              src={api.clipDownloadUrl(playing.id)}
              controls
              autoPlay
              playsInline
              className="max-h-[75vh] w-full rounded-lg border bg-black"
            />
          </div>
        </div>
      )}
    </>
  );
}

function WhatsNew() {
  const [showOlder, setShowOlder] = useState(false);
  const [latest, ...older] = CHANGELOG;
  if (!latest) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          Novidades
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs font-medium text-primary">
            v{APP_VERSION}
          </span>
        </CardTitle>
        <CardDescription>{formatDay(latest.date)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5 text-sm">
          {latest.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60" />
              <span className="text-foreground/90">{item}</span>
            </li>
          ))}
        </ul>
        {older.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowOlder((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              <ChevronDown className={"size-3.5 transition-transform" + (showOlder ? " rotate-180" : "")} />
              {showOlder ? "esconder versões anteriores" : "versões anteriores"}
            </button>
            {showOlder && (
              <div className="mt-3 space-y-3 border-l-2 pl-3">
                {older.map((release: Release) => (
                  <div key={release.version}>
                    <p className="text-xs font-medium">
                      v{release.version}{" "}
                      <span className="font-normal text-muted-foreground">· {formatDay(release.date)}</span>
                    </p>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {release.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// The live-rooms card is always rendered -- the layout doesn't jump
// when the first room opens; an empty state fills it instead.
function LiveRooms({
  activeRooms,
  onPick,
}: {
  activeRooms: RoomSummary[];
  onPick: (roomId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AnimatedIcon animation={radioButtonIcon} size={18} autoplay loop className="text-green-500" />
          Salas rolando agora
        </CardTitle>
        <CardDescription>Quem está transmitindo neste momento.</CardDescription>
      </CardHeader>
      <CardContent>
        {activeRooms.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma sala no ar — crie a primeira pelo formulário.
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {activeRooms.map((room) => (
                <motion.button
                  key={room.roomId}
                  type="button"
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => onPick(room.roomId)}
                  className="group flex w-full items-center justify-between rounded-lg border bg-secondary/30 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-secondary/60"
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <MonitorPlay className="size-4 shrink-0 text-primary" />
                    <span className="truncate font-mono tracking-wide">{room.roomId}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2 text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" />
                      {room.people}
                    </span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  // Shared across both tabs -- it's the same person typing it either
  // way, and switching tabs to fix a typo shouldn't lose it.
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeRooms, setActiveRooms] = useState<RoomSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .listRooms()
        .then((rooms) => {
          if (!cancelled) setActiveRooms(rooms);
        })
        .catch(() => {
          // A failed poll just means the list stays as it was -- not
          // worth surfacing an error for something this ambient.
        });
    };
    poll();
    const interval = setInterval(poll, ROOMS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const { roomId } = await api.createRoom(createPassword);
      // Same as joining: the password is the only credential, and it
      // travels in navigation state rather than the URL.
      navigate(`/r/${roomId}`, { state: { password: createPassword, name: name.trim() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível criar a sala");
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (joining) return;
    setError(null);
    setJoining(true);
    const code = joinCode.trim().toLowerCase();
    try {
      // Checked here so a wrong password is a clear message rather than
      // a WebSocket that just refuses to open.
      await api.checkPassword(code, joinPassword);
      navigate(`/r/${code}`, { state: { password: joinPassword, name: name.trim() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
      setJoining(false);
    }
  }

  function pickRoom(roomId: string) {
    setJoinCode(roomId);
    setTab("join");
    setError(null);
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Ambient backdrop: two soft glows and a faint grid that fades
          out toward the bottom. Purely decorative, never interactive. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[58rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[130px]" />
        <div className="absolute -bottom-32 right-[-8rem] h-[26rem] w-[30rem] rounded-full bg-sky-400/10 blur-[110px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.4)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.4)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_20%,transparent_80%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:py-12">
        <motion.header
          className="mb-10 flex items-center justify-between lg:mb-14"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <span className="inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
            <MonitorPlay className="size-6 text-primary" />
            tela
          </span>
          <span className="rounded-full border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
            v{APP_VERSION}
          </span>
        </motion.header>

        <div className="grid flex-1 items-start gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Left: the pitch and the one action people came here for. */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05, ease: "easeOut" }}
            >
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Uma sala, <span className="bg-gradient-to-r from-primary to-sky-400 bg-clip-text text-transparent">várias telas</span>.
              </h1>
              <p className="mt-3 max-w-lg text-base text-muted-foreground sm:text-lg">
                Todo mundo pode compartilhar. Sem cadastro, sem instalar nada — um código e uma senha.
              </p>
              <ul className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {[
                  { icon: Zap, label: "uma subida só — o servidor reparte pra sala" },
                  { icon: Lock, label: "senha por sala, nada salvo" },
                  { icon: Clapperboard, label: "clips dos últimos 5 minutos" },
                ].map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5 backdrop-blur"
                  >
                    <Icon className="size-3.5 text-primary" />
                    {label}
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
              className="mt-8"
            >
              <Card className="border-border/80 bg-card/80 shadow-2xl shadow-black/30 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-xl">Começar</CardTitle>
                  <CardDescription>Crie uma sala, ou entre numa que te passaram.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 space-y-2">
                    <Label htmlFor="display-name">Seu nome (opcional)</Label>
                    <Input
                      id="display-name"
                      placeholder="deixe em branco para um nome aleatório"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={30}
                    />
                  </div>

                  <Tabs
                    value={tab}
                    onValueChange={(v) => {
                      setTab(v as "create" | "join");
                      setError(null);
                    }}
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="create">Criar sala</TabsTrigger>
                      <TabsTrigger value="join">Entrar</TabsTrigger>
                    </TabsList>

                    <TabsContent value="create">
                      <form onSubmit={handleCreate} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="create-password">Senha da sala</Label>
                          <Input
                            id="create-password"
                            type="password"
                            autoComplete="new-password"
                            placeholder="mínimo 4 caracteres"
                            value={createPassword}
                            onChange={(e) => setCreatePassword(e.target.value)}
                            required
                            minLength={4}
                          />
                          <p className="text-xs text-muted-foreground">
                            Quem entrar vai precisar dela junto com o código da sala.
                          </p>
                        </div>
                        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                          <Button type="submit" className="h-11 w-full text-base" disabled={creating}>
                            <AnimatedIcon animation={creating ? loadingIcon : airplayIcon} autoplay={creating} loop={creating} />
                            Criar sala
                          </Button>
                        </motion.div>
                      </form>
                    </TabsContent>

                    <TabsContent value="join">
                      <form onSubmit={handleJoin} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="join-code">Código da sala</Label>
                          <Input
                            id="join-code"
                            placeholder="abacate98suco"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value)}
                            className="font-mono tracking-wide"
                            maxLength={40}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="join-password">Senha</Label>
                          <Input
                            id="join-password"
                            type="password"
                            autoComplete="current-password"
                            value={joinPassword}
                            onChange={(e) => setJoinPassword(e.target.value)}
                            required
                          />
                        </div>
                        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
                          <Button type="submit" className="h-11 w-full text-base" disabled={joining}>
                            <AnimatedIcon
                              animation={joining ? loadingIcon : arrowRightCircleIcon}
                              autoplay={joining}
                              loop={joining}
                            />
                            Entrar
                          </Button>
                        </motion.div>
                      </form>
                    </TabsContent>
                  </Tabs>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                      >
                        <Alert variant="destructive" className="mt-4">
                          <AlertDescription>{error}</AlertDescription>
                        </Alert>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right: everything ambient -- what's live, what you recorded,
              what changed. On a phone these come after the forms. */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: "easeOut" }}
            >
              <LiveRooms activeRooms={activeRooms} onPick={pickRoom} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.14, ease: "easeOut" }}
            >
              <Clips />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.18, ease: "easeOut" }}
            >
              <WhatsNew />
            </motion.div>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          O vídeo vai direto de um navegador pro outro. O servidor só apresenta os dois.
        </p>
      </div>
    </div>
  );
}