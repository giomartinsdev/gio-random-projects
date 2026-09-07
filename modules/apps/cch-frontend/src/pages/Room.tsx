import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Crown, Pencil, SkipForward, Sparkles, Trash2, Trophy, Users } from "lucide-react";
import { api, peekPresetDeck, takePresetDeck, type CustomDeckInfo, type DeckInfo } from "@/lib/api";
import { useGame, type Card as GameCard, type Credential, type GameState, type Submission } from "@/lib/useGame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Confetti } from "@/components/ui/confetti";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  arrowRightCircleIcon,
  checkmarkIcon,
  copyIcon,
  errorIcon,
  loadingIcon,
  notificationIcon,
  plusToXIcon,
} from "@/lib/lottie-icons";
import { cn } from "@/lib/utils";

export default function Room() {
  const { id } = useParams<{ id: string }>();
  // Codes are lowercase words ("abacate98suco") -- lowercased here too
  // so a link typed/pasted in any case still resolves the same room.
  const roomId = (id ?? "").toLowerCase();
  const location = useLocation();

  // Password can arrive through:
  // 1. Navigation state (joining / creating from home)
  // 2. Query param ?pwd=... / ?password=... / ?p=... (direct link shared with password)
  // 3. Hash #pwd=... / #password=... / #p=...
  const [credential, setCredential] = useState<Credential | null>(() => {
    const statePassword = (location.state as { password?: string } | null)?.password;
    if (statePassword) return { password: statePassword };

    const searchParams = new URLSearchParams(location.search);
    const queryPwd = searchParams.get("pwd") || searchParams.get("password") || searchParams.get("p");
    if (queryPwd) return { password: queryPwd };

    if (location.hash) {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
      const hashPwd = hashParams.get("pwd") || hashParams.get("password") || hashParams.get("p");
      if (hashPwd) return { password: hashPwd };
    }

    return null;
  });

  // Set once, from whatever the home page's forms collected -- someone
  // arriving via a bare link (no navigation state) never had the
  // chance to type one, and EntryGate below is where they get it
  // instead.
  const [name, setName] = useState<string>(() => (location.state as { name?: string } | null)?.name ?? "");

  if (!credential) {
    return (
      <EntryGate
        roomId={roomId}
        name={name}
        onUnlocked={(c, n) => {
          setName(n);
          setCredential(c);
        }}
      />
    );
  }
  return <LiveRoom roomId={roomId} credential={credential} name={name} onResetPassword={() => setCredential(null)} />;
}

// Two ways in, picked with a toggle: the password (instant), or "pedir
// para entrar" -- a knock that notifies everyone already in the room
// and waits for one of them to answer. See KnockLobby for the waiting
// side of that.
function EntryGate({
  roomId,
  name: initialName,
  onUnlocked,
}: {
  roomId: string;
  name: string;
  onUnlocked: (credential: Credential, name: string) => void;
}) {
  const [mode, setMode] = useState<"password" | "knock">("password");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [knockRequestId, setKnockRequestId] = useState<string | null>(null);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      await api.checkPassword(roomId, password);
      onUnlocked({ password }, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível entrar");
      setChecking(false);
    }
  }

  async function requestToJoin() {
    setError(null);
    setChecking(true);
    try {
      const { requestId } = await api.knock(roomId, name.trim());
      setKnockRequestId(requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível pedir para entrar");
    } finally {
      setChecking(false);
    }
  }

  if (knockRequestId) {
    return (
      <KnockLobby
        roomId={roomId}
        requestId={knockRequestId}
        name={name.trim()}
        onApproved={(admitToken) => onUnlocked({ admitToken }, name.trim())}
        onCancel={() => setKnockRequestId(null)}
      />
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <ThemeToggle className="absolute right-3 top-3" />
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sala {roomId}</CardTitle>
            <CardDescription>
              {mode === "password" ? "Digite a senha para entrar." : "Peça para alguém já na sala te deixar entrar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="display-name">Seu nome (opcional)</Label>
              <Input
                id="display-name"
                placeholder="deixe em branco para um nome aleatório"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
              />
            </div>

            {mode === "password" ? (
              <form onSubmit={submitPassword} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={checking}>
                  {checking && <AnimatedIcon animation={loadingIcon} autoplay loop />}
                  Entrar
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("knock");
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Não sei a senha -- pedir para entrar
                </button>
              </form>
            ) : (
              <div className="mt-4 space-y-4">
                <Button type="button" className="w-full" onClick={requestToJoin} disabled={checking}>
                  <AnimatedIcon
                    animation={checking ? loadingIcon : arrowRightCircleIcon}
                    autoplay={checking}
                    loop={checking}
                  />
                  Pedir para entrar
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("password");
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Tenho a senha
                </button>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// The waiting side of a knock -- polled rather than a held-open
// request, so a slow or unattended room never freezes this tab. See
// cch-api's knock.go for why this is safe to poll.
const KNOCK_POLL_MS = 1_500;

function KnockLobby({
  roomId,
  requestId,
  name,
  onApproved,
  onCancel,
}: {
  roomId: string;
  requestId: string;
  name: string;
  onApproved: (admitToken: string) => void;
  onCancel: () => void;
}) {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api.knockStatus(roomId, requestId);
        if (cancelled) return;
        if (status.status === "approved" && status.admitToken) {
          onApproved(status.admitToken);
        } else if (status.status === "denied") {
          setDenied(true);
        }
      } catch {
        // A 404 here means the request expired -- treated the same as
        // a denial rather than surfacing a network error for it.
        if (!cancelled) setDenied(true);
      }
    };
    poll();
    const interval = setInterval(poll, KNOCK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, requestId, onApproved]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-xl">Sala {roomId}</CardTitle>
          <CardDescription>
            {denied
              ? "Ninguém te deixou entrar dessa vez."
              : `Esperando alguém aprovar${name ? `, ${name}` : ""}…`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <motion.div
            key={denied ? "denied" : "waiting"}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex justify-center text-muted-foreground"
          >
            <AnimatedIcon animation={denied ? errorIcon : loadingIcon} size={40} autoplay loop={!denied} />
          </motion.div>
          <Button variant="outline" className="w-full" onClick={onCancel}>
            {denied ? "Voltar" : "Cancelar"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Fills a black card's blanks with the played lines, the way the
// physical game reads out. More lines than blanks appends the
// leftovers -- the server guarantees exactly one line per blank, so
// this is just display tolerance.
function fillBlank(text: string, lines: string[]): string {
  let i = 0;
  const out = text.replace(/_{1,}/g, () => lines[i++] ?? "_");
  if (i < lines.length) {
    return `${out} ${lines.slice(i).join(" ")}`;
  }
  return out;
}

function LiveRoom({
  roomId,
  credential,
  name,
  onResetPassword,
}: {
  roomId: string;
  credential: Credential;
  name?: string;
  onResetPassword?: () => void;
}) {
  const game = useGame(roomId, credential, name);
  const navigate = useNavigate();
  // Only someone who actually typed the password has one to share --
  // someone let in through a knock never learns it, so there's nothing
  // for CopyLinkWithPassword to put in the link.
  const password = "password" in credential ? credential.password : undefined;
  const isAdm = game.you?.name === "adm";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 sm:px-4 sm:py-3">
        <Link to="/" className="text-lg font-bold tracking-tight">
          cch
        </Link>
        <CopyableCode code={roomId} />
        {password && <CopyLinkWithPassword roomId={roomId} password={password} />}
        {game.state && <PeopleCount state={game.state} />}
        {game.you && <NameChip game={game} />}
        {game.status !== "connected" && (
          <span className="text-sm text-muted-foreground">
            {game.status === "reconnecting"
              ? "reconectando…"
              : game.status === "closed"
                ? "desconectado"
                : game.status === "error"
                  ? "erro na conexão"
                  : "conectando…"}
          </span>
        )}

        {isAdm && password && (
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm("Tem certeza que quer apagar esta sala?")) return;
              await api.deleteRoom(roomId, password);
              navigate("/");
            }}
            className="flex-1 sm:flex-none"
          >
            <Trash2 className="size-4" />
            Apagar sala
          </Button>
        )}
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 flex-col">
        {(game.status === "error" || game.knockRequests.length > 0) && (
          <div className="absolute inset-x-4 top-4 z-10 mx-auto flex max-w-md flex-col gap-2">
            {game.status === "error" && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3 text-xs">
                  <span>Falha ao conectar na sala (senha incorreta ou sala fechada).</span>
                  {onResetPassword && (
                    <Button size="sm" variant="outline" onClick={onResetPassword} className="h-7 shrink-0 text-xs">
                      Digitar senha
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <AnimatePresence initial={false}>
              {game.knockRequests.map((req) => (
                <motion.div
                  key={req.requestId}
                  layout
                  initial={{ opacity: 0, y: -16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Alert className="bg-card">
                    <AlertDescription className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <AnimatedIcon animation={notificationIcon} autoplay loop className="text-muted-foreground" />
                        <strong>{req.name}</strong> quer entrar na sala
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => game.denyKnock(req.requestId)}>
                          <AnimatedIcon animation={plusToXIcon} reverse />
                          Recusar
                        </Button>
                        <Button size="sm" onClick={() => game.approveKnock(req.requestId)}>
                          <AnimatedIcon animation={checkmarkIcon} autoplay />
                          Aprovar
                        </Button>
                      </span>
                    </AlertDescription>
                  </Alert>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {game.state && <GameTable roomId={roomId} game={game} />}
      </main>
    </div>
  );
}

// The header's people badge -- a hover/click dropdown listing everyone
// in the room with their score, who's the czar, and who's gone.
function PeopleCount({ state }: { state: GameState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Users className="size-4" />
        <span className="tabular-nums">{state.players.filter((p) => p.connected).length}</span>
        <span className="hidden sm:inline">{state.players.filter((p) => p.connected).length === 1 ? "pessoa" : "pessoas"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-20 mt-2 w-56 origin-top-left rounded-md border bg-card p-2 text-card-foreground shadow-md"
          >
            <p className="mb-1 px-1.5 text-xs font-medium text-muted-foreground">Na sala</p>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {state.players.map((p) => (
                <li key={p.peerId} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {p.isCzar && <Crown className="size-3.5 shrink-0 text-yellow-500" aria-label="Czar" />}
                    <span className={cn("truncate", !p.connected && "text-muted-foreground line-through")}>{p.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.score}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// GameTable is the whole playable area, switched on the game's phase.
// One component per phase keeps each screen's own state (card
// selection, blank text) from leaking into another's render.
function GameTable({
  roomId,
  game,
}: {
  roomId: string;
  game: ReturnType<typeof useGame>;
}) {
  const state = game.state!;
  if (state.phase === "lobby") return <Lobby roomId={roomId} game={game} />;
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-6">
      <Scoreboard state={state} you={game.you?.peerId ?? ""} />
      {/* Phases cross-fade instead of hard-cutting: the table reads as
          one continuous game rather than five separate screens. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={state.phase}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {state.phase === "playing" && <Playing game={game} />}
          {state.phase === "judging" && <Judging game={game} />}
          {state.phase === "roundEnd" && <RoundEnd game={game} />}
          {state.phase === "gameOver" && <GameOver game={game} />}
        </motion.div>
      </AnimatePresence>
      {state.phase !== "gameOver" && <BlackCardBar game={game} />}
    </div>
  );
}

function Lobby({ roomId, game }: { roomId: string; game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const location = useLocation();
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [customDecks, setCustomDecks] = useState<CustomDeckInfo[]>([]);
  // Pre-selected from what the creator chose on the home page -- the
  // navigation state carries it (see Home's handleCreate). Anyone else
  // in the lobby picks their own chips before starting; whoever presses
  // the button decides.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [winningScore, setWinningScore] = useState(5);
  const [winningScorePicked, setWinningScorePicked] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listDecks(),
      api.listCustomDecks().catch(() => [] as CustomDeckInfo[]),
    ])
      .then(([list, customList]) => {
        if (cancelled) return;
        setDecks(list);
        setCustomDecks(customList);
        // First load: seed from the creator's choices (navigation
        // state), else the marketplace deck this session came here to
        // play with, else everything on. Later loads keep whatever this
        // player already toggled.
        setSelected((current) => {
          if (current.size > 0) return current;
          const pre = (location.state as { decks?: string[] } | null)?.decks;
          if (pre && pre.length > 0) return new Set(pre);
          // Peek, not take: StrictMode re-runs this effect, and the
          // preset is spent in start() once the game actually begins.
          const preset = peekPresetDeck();
          return new Set(preset ? [preset] : list.map((d) => d.id));
        });
        const preScore = (location.state as { winningScore?: number } | null)?.winningScore;
        if (preScore && !winningScorePicked) {
          setWinningScore(preScore);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = state.players.filter((p) => p.connected).length;
  const canStart = connected >= 3 && selected.size > 0;

  function toggleDeck(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    game.startGame([...selected], winningScore);
    // The marketplace preset was just played -- spend it so a later
    // room in this tab doesn't silently re-select it.
    takePresetDeck();
    // The broadcast comes back as new state; if nothing changed (a
    // rejection), re-enable after a moment.
    setTimeout(() => setStarting(false), 1500);
  }

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight">Sala pronta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Chame o pessoal: <Code>{roomId}</Code> — mínimo 3 pessoas para começar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Jogando agora ({connected})
          </CardTitle>
          <CardDescription>
            {connected < 3 ? "Faltam " + (3 - connected) + " pessoas conectadas." : "Todo mundo conectado pode dar o start."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {state.players.map((p) => (
              <li
                key={p.peerId}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                  p.connected ? "bg-secondary/50" : "text-muted-foreground line-through",
                )}
              >
                {p.name}
                {p.peerId === game.you?.peerId && <span className="text-xs text-muted-foreground">(você)</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decks</CardTitle>
          <CardDescription>As cartas de todos os decks marcados são embaralhadas juntas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {decks.map((deck) => {
              const on = selected.has(deck.id);
              return (
                <motion.button
                  key={deck.id}
                  type="button"
                  title={deck.description}
                  onClick={() => toggleDeck(deck.id)}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {on ? <Check className="size-3.5 text-primary" /> : <span className="size-3.5" />}
                  <span>
                    {deck.emoji} {deck.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{deck.whites + deck.blacks}</span>
                </motion.button>
              );
            })}
            {customDecks.map((deck) => {
              const on = selected.has(deck.id);
              return (
                <motion.button
                  key={deck.id}
                  type="button"
                  title={deck.description}
                  onClick={() => toggleDeck(deck.id)}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    on ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {on ? <Check className="size-3.5 text-primary" /> : <span className="size-3.5" />}
                  <span>
                    {deck.emoji} {deck.name}
                  </span>
                  <Sparkles className="size-3 shrink-0 text-primary" />
                  <span className="text-xs text-muted-foreground">{deck.whites + deck.blacks}</span>
                </motion.button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>Pontos para ganhar</Label>
            <div className="flex gap-2">
              {[3, 5, 8, 10].map((score) => (
                <motion.button
                  key={score}
                  type="button"
                  onClick={() => {
                    setWinningScore(score);
                    setWinningScorePicked(true);
                  }}
                  whileTap={{ scale: 0.94 }}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-sm tabular-nums transition-colors",
                    winningScore === score
                      ? "border-primary bg-primary/15 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {score}
                </motion.button>
              ))}
            </div>
          </div>

          <motion.div whileHover={{ scale: canStart ? 1.01 : 1 }} whileTap={{ scale: canStart ? 0.98 : 1 }}>
            <Button type="button" className="w-full" disabled={!canStart || starting} onClick={start}>
              <AnimatedIcon animation={starting ? loadingIcon : checkmarkIcon} autoplay={starting} loop={starting} />
              Começar o jogo
            </Button>
          </motion.div>
        </CardContent>
      </Card>
    </div>
  );
}

// One black card up top for the whole round -- the table's anchor.
// Every phase except the lobby shows it (BlackCardBar), so the
// composition of who said what reads against it.
function BlackCardBar({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  if (!state.blackCard) return null;
  const amCzar = state.players.some((p) => p.peerId === game.you?.peerId && p.isCzar);
  return (
    // Keyed by round so a fresh black card slides in instead of
    // silently swapping text.
    <motion.div
      key={state.round}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Rodada {state.round}</p>
        <BlackText text={state.blackCard.text} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {amCzar && (state.phase === "playing" || state.phase === "judging") && (
          <Button variant="ghost" size="sm" onClick={game.skipRound} title="Pular esta rodada (ninguém pontua)">
            <SkipForward className="size-4" />
            <span className="hidden sm:inline">Pular</span>
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function BlackText({ text }: { text: string }) {
  // Underscores render as proper blanks, not raw characters.
  return (
    <p className="mt-0.5 text-lg font-semibold leading-snug">
      {text.split(/(_{1,})/).map((part, i) =>
        part.startsWith("_") ? (
          <span key={i} className="mx-1 inline-block w-16 border-b-2 border-foreground/60" aria-label="espaço em branco" />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function Playing({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const amCzar = state.players.some((p) => p.peerId === game.you?.peerId && p.isCzar);
  const [selected, setSelected] = useState<string[]>([]);
  // Write-your-own cards collect a text per card id -- "__" alone is
  // never sent.
  const [blankTexts, setBlankTexts] = useState<Record<string, string>>({});
  const submitted = state.myLines != null && state.myLines.length > 0;

  // A round change resets the local pick -- new black card, new hand.
  useEffect(() => {
    setSelected([]);
    setBlankTexts({});
  }, [state.round]);

  const blanks = state.blackBlanks;
  const readyToPlay = selected.length === blanks && selected.every((id) => {
    const card = game.hand.find((c) => c.id === id);
    return !card?.text.includes("__") || (blankTexts[id] ?? "").trim().length > 0;
  });

  if (amCzar) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
            className="flex justify-center"
          >
            <Crown className="size-8 text-yellow-500" />
          </motion.div>
          <p className="font-medium">Você é o czar desta rodada.</p>
          <p className="text-sm text-muted-foreground">
            Espere todo mundo jogar. Depois escolha a melhor resposta.
          </p>
          <SubmissionTracker game={game} />
        </CardContent>
      </Card>
    );
  }

  if (submitted) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-center">
          <AnimatedIcon animation={checkmarkIcon} size={32} autoplay className="mx-auto text-green-500" />
          <p className="font-medium">Sua jogada está na mesa.</p>
          {/* The played hand, exactly as the czar will read it. */}
          {state.blackCard && state.myLines && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="mx-auto max-w-md rounded-xl border-2 border-black/10 bg-white p-4 text-left text-black shadow-sm"
            >
              <span className="font-medium leading-snug">{fillBlank(state.blackCard.text, state.myLines)}</span>
            </motion.div>
          )}
          <p className="text-sm text-muted-foreground">Espere todo mundo jogar para o czar escolher.</p>
          <SubmissionTracker game={game} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Escolha {blanks === 1 ? "1 carta" : `${blanks} cartas`} para a rodada.
        </p>
        {state.myTraded && <span className="text-xs text-muted-foreground">você já trocou uma carta nesta rodada</span>}
      </div>

      {/* The deal: cards fan in with a stagger instead of popping as a
          block. New cards (a trade, a refill) inherit the same entrance. */}
      <motion.div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3"
        initial="hidden"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.035 } } }}
      >
        {game.hand.map((card) => (
          <HandCard
            key={card.id}
            card={card}
            selected={selected.includes(card.id)}
            disabled={selected.length >= blanks && !selected.includes(card.id)}
            blankText={blankTexts[card.id] ?? ""}
            onBlankText={(text) => setBlankTexts((current) => ({ ...current, [card.id]: text }))}
            onClick={() =>
              setSelected((current) => {
                if (current.includes(card.id)) return current.filter((id) => id !== card.id);
                if (current.length >= blanks) return current;
                return [...current, card.id];
              })
            }
            onDiscard={state.myTraded ? undefined : () => game.discardCard(card.id)}
          />
        ))}
      </motion.div>

      {blanks > 0 && (
        <motion.div whileHover={{ scale: readyToPlay ? 1.01 : 1 }} whileTap={{ scale: readyToPlay ? 0.98 : 1 }}>
          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={!readyToPlay}
            onClick={() =>
              game.submitCards(
                selected.map((id) => {
                  const card = game.hand.find((c) => c.id === id);
                  return { cardId: id, text: card?.text.includes("__") ? (blankTexts[id] ?? "").trim() : undefined };
                }),
              )
            }
          >
            Jogar {selected.length}/{blanks}
          </Button>
        </motion.div>
      )}

      <SubmissionTracker game={game} />
    </div>
  );
}

// A hand card. Printed cards tap to select; write-your-own cards also
// carry a text field. The discard (trade) affordance lives in the
// corner -- once per round, only before playing.
function HandCard({
  card,
  selected,
  disabled,
  blankText,
  onBlankText,
  onClick,
  onDiscard,
}: {
  card: GameCard;
  selected: boolean;
  disabled: boolean;
  blankText: string;
  onBlankText: (text: string) => void;
  onClick: () => void;
  onDiscard?: () => void;
}) {
  const isBlank = card.text.includes("__");
  const locked = disabled && !selected;
  return (
    <motion.div
      layout
      variants={{ hidden: { opacity: 0, y: 18, scale: 0.9 }, show: { opacity: 1, y: 0, scale: 1 } }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      whileHover={locked ? undefined : { y: -4 }}
      // Blank cards carry an input -- a tap-scale there reads as the
      // field jittering, so only printed cards get it.
      whileTap={!isBlank && !locked ? { scale: 0.97 } : undefined}
      className={cn(
        "relative rounded-xl border-2 p-3 pb-4 text-sm leading-snug shadow-sm",
        // White card look regardless of theme: the physical card is
        // white, and keeping that makes hands readable at a glance.
        "bg-white text-black",
        selected ? "border-primary ring-2 ring-primary" : "border-black/10",
        locked && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled && !selected}
        className="block w-full text-left"
        aria-pressed={selected}
      >
        {isBlank ? <span className="font-medium">Escreva a sua:</span> : card.text}
      </button>
      {isBlank && (
        <Input
          value={blankText}
          onChange={(e) => onBlankText(e.target.value)}
          placeholder="sua resposta"
          maxLength={120}
          className="mt-2 h-8 border-black/20 bg-black/5 text-black placeholder:text-black/40"
        />
      )}
      {onDiscard && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Trocar "${isBlank ? "sua carta em branco" : card.text}" por uma nova? (1x por rodada)`)) {
              onDiscard();
            }
          }}
          title="Trocar esta carta por uma nova (1x por rodada)"
          className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground shadow hover:text-foreground"
          aria-label="Trocar carta"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </motion.div>
  );
}

// Who's in and who already played -- the round's pulse, shown to
// everyone in every phase of a round.
function SubmissionTracker({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const entries = state.players.filter((p) => p.connected && !p.isCzar);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-1.5 text-xs text-muted-foreground">
      {entries.map((p) => (
        <li
          key={p.peerId}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
            p.submitted && "border-green-500/40 text-green-600 dark:text-green-400",
          )}
        >
          {p.submitted ? <Check className="size-3" /> : <span className="size-3 rounded-full border" />}
          {p.name}
        </li>
      ))}
    </ul>
  );
}

// The czar picks from the anonymous plays. First tap highlights, the
// button confirms -- a misclick on a phone shouldn't crown a winner.
function Judging({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const amCzar = state.players.some((p) => p.peerId === game.you?.peerId && p.isCzar);

  if (!amCzar) {
    // Watching the czar deliberate is a spectator sport now: every play
    // is on the table (anonymous, read-only), not just your own.
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="space-y-1.5 py-5 text-center">
            <div className="flex items-center justify-center gap-2">
              <AnimatedIcon animation={loadingIcon} size={20} autoplay loop className="text-muted-foreground" />
              <p className="font-medium">O czar está escolhendo o vencedor…</p>
            </div>
            <p className="text-sm text-muted-foreground">As respostas de todo mundo estão na mesa — leia em voz alta e ria.</p>
          </CardContent>
        </Card>
        <SubmissionCards game={game} />
      </div>
    );
  }

  return <JudgeList game={game} />;
}

function JudgeList({ game }: { game: ReturnType<typeof useGame> }) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Toque na melhor resposta para coroar o vencedor.</p>
      <SubmissionCards game={game} picked={picked} onSelect={(id) => setPicked(picked === id ? null : id)} />
      <motion.div whileHover={{ scale: picked ? 1.01 : 1 }} whileTap={{ scale: picked ? 0.98 : 1 }}>
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={!picked}
          onClick={() => picked && game.pickSubmission(picked)}
        >
          <Crown className="size-4" />
          Coroar essa
        </Button>
      </motion.div>
    </div>
  );
}

function RoundEnd({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const amCzar = state.players.some((p) => p.peerId === game.you?.peerId && p.isCzar);
  const winner = state.winner;

  return (
    <div className="space-y-4">
      {winner && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <Card className="relative overflow-hidden border-yellow-500/40 bg-yellow-500/5">
            <Confetti />
            <CardContent className="flex items-center gap-4 py-5">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 12, delay: 0.1 }}
                className="shrink-0"
              >
                <Trophy className="size-8 text-yellow-500" />
              </motion.div>
              <div className="min-w-0">
                <p className="font-semibold">
                  {winner.name} {winner.peerId === game.you?.peerId && "(você)"} ganhou a rodada
                </p>
                {state.blackCard && winner.lines && (
                  <BlackText text={fillBlank(state.blackCard.text, winner.lines)} />
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* The whole table, winner crowned -- the part everyone reads out
          loud and laughs at. */}
      {(state.submissions?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Todas as respostas da rodada:</p>
          <SubmissionCards game={game} winnerId={state.winnerSubmissionId} />
        </div>
      )}

      {amCzar ? (
        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
          <Button type="button" className="w-full" size="lg" onClick={game.nextRound}>
            <Sparkles className="size-4" />
            Próxima rodada
          </Button>
        </motion.div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Aguardando o czar distribuir a próxima rodada…</p>
      )}
    </div>
  );
}

function GameOver({ game }: { game: ReturnType<typeof useGame> }) {
  const state = game.state!;
  const gw = state.gameWinner;

  return (
    <div className="space-y-4">
      {gw && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="relative text-center"
        >
          <Confetti count={40} />
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 12 }}
            className="flex justify-center"
          >
            <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}>
              <Trophy className="size-12 text-yellow-500" />
            </motion.div>
          </motion.div>
          <p className="mt-2 text-2xl font-bold tracking-tight">
            {gw.name} {gw.peerId === game.you?.peerId && "(você)"} venceu o jogo!
          </p>
          <p className="text-sm text-muted-foreground">
            {state.winningScore} pontos. Que vergonha alheia.
          </p>
        </motion.div>
      )}

      <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
        <Button type="button" className="w-full" size="lg" onClick={game.resetGame}>
          Jogar de novo
        </Button>
      </motion.div>
    </div>
  );
}

function Scoreboard({ state, you }: { state: GameState; you: string }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ranked.map((p) => (
        // layout: chips glide past each other as scores reorder the
        // ranking instead of teleporting.
        <motion.li
          key={p.peerId}
          layout
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs",
            p.peerId === you && "border-primary",
            !p.connected && "opacity-50",
          )}
        >
          {p.isCzar && <Crown className="size-3 text-yellow-500" />}
          <span className="font-medium">{p.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {/* The number itself pops in when it changes. */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={p.score}
                initial={{ y: -10, opacity: 0, scale: 1.35 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 8, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 24 }}
                className="inline-block"
              >
                {p.score}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

// Your own name in the header -- tap to change it any time, mid-round
// included. The server rebroadcasts it (scoreboard, knock badges, the
// people list) and hands back a fresh resume token, which useGame
// stores -- so the rename survives a reconnect too.
function NameChip({ game }: { game: ReturnType<typeof useGame> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setDraft(game.you?.name ?? "");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function save() {
    const name = draft.trim();
    if (name && name !== game.you?.name) game.setName(name);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        title="Mudar seu nome"
        className="inline-flex max-w-32 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Pencil className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground">{game.you?.name}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-30 mt-2 w-64 origin-top-right rounded-md border bg-card p-3 text-card-foreground shadow-md"
          >
            <Label htmlFor="rename-input">Seu nome</Label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="mt-1.5 flex gap-2"
            >
              <Input
                ref={inputRef}
                id="rename-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                maxLength={30}
                placeholder="como quer ser chamado?"
              />
              <Button type="submit" size="icon" className="size-10 shrink-0" aria-label="Salvar nome">
                <Check className="size-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// The table of anonymous plays -- shown to everyone, in judging and at
// the reveal. For the czar it's the picking surface (onSelect set, the
// two-tap confirm lives in JudgeList); for everyone else it's
// read-only, with their own play and the round's winner called out.
function SubmissionCards({
  game,
  picked,
  onSelect,
  winnerId,
}: {
  game: ReturnType<typeof useGame>;
  picked?: string | null;
  onSelect?: (id: string) => void;
  winnerId?: string;
}) {
  const state = game.state!;
  const submissions = state.submissions ?? [];
  // Authorship never leaves the server; MyLines is the one honest way
  // to recognize your own entry. Joined with a separator that can't
  // appear in card text so "a"+"bc" never equals "ab"+"c".
  const mineKey = state.myLines?.join(" ") ?? null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {submissions.map((sub: Submission, i: number) => {
        const isMine = mineKey != null && sub.lines.join(" ") === mineKey;
        const isWinner = winnerId === sub.id;
        const interactive = onSelect != null;
        return (
          <motion.div
            key={sub.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.95, rotate: i % 2 === 0 ? -1.2 : 1.2 }}
            animate={{ opacity: 1, y: 0, scale: isWinner ? 1.02 : 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26, delay: Math.min(i * 0.06, 0.4) }}
            whileHover={interactive ? { y: -3, scale: 1.02 } : undefined}
            whileTap={interactive ? { scale: 0.98 } : undefined}
            onClick={onSelect ? () => onSelect(sub.id) : undefined}
            role={interactive ? "button" : undefined}
            className={cn(
              "relative rounded-xl border-2 bg-white p-4 text-left text-black shadow-sm",
              isWinner
                ? "border-yellow-500 ring-2 ring-yellow-500"
                : interactive && picked === sub.id
                  ? "border-primary ring-2 ring-primary"
                  : "border-black/10",
              interactive && "cursor-pointer",
            )}
          >
            <span className="font-medium leading-snug">
              {state.blackCard ? fillBlank(state.blackCard.text, sub.lines) : sub.lines.join(" · ")}
            </span>
            {isMine && !isWinner && (
              <span className="absolute right-2 top-2 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium text-black/70">
                sua
              </span>
            )}
            {isWinner && (
              <motion.span
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.15 }}
                className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-yellow-400 text-black shadow"
                title="Resposta vencedora"
              >
                <Crown className="size-4" />
              </motion.span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// A one-shot burst of paper bits -- no library, gone after about a
// second and a half. Render inside a relatively-positioned parent (the
// winner card, the game-over banner).

function CopyLinkWithPassword({
  roomId,
  password,
  variant = "secondary",
}: {
  roomId: string;
  password: string;
  variant?: "secondary" | "outline" | "default";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = `${window.location.origin}/r/${roomId}?pwd=${encodeURIComponent(password)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (navigator.share) {
        navigator.share({ title: `cch - Sala ${roomId}`, url: link }).catch(() => {});
      }
    }
  }

  return (
    <Button variant={variant} size="sm" onClick={copy} title="Copiar link direto com senha" className="gap-1.5">
      {copied ? (
        <AnimatedIcon animation={checkmarkIcon} autoplay className="text-green-500" />
      ) : (
        <AnimatedIcon animation={copyIcon} />
      )}
      <span className="hidden sm:inline">{copied ? "Link copiado!" : "Convidar"}</span>
      <span className="sm:hidden">{copied ? "Copiado!" : "Convidar"}</span>
    </Button>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard API is unavailable in plenty of mobile contexts.
      // A share sheet is the natural fallback on a phone, and the code
      // is on screen to read out either way.
      if (navigator.share) {
        navigator.share({ title: "cch", url: link }).catch(() => {});
      }
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={copy} className="font-mono tracking-widest" title="Copiar código / link da sala">
      <AnimatedIcon animation={copied ? checkmarkIcon : copyIcon} autoplay={copied} />
      {code}
    </Button>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-secondary px-1.5 py-0.5 font-mono tracking-widest">{children}</span>;
}