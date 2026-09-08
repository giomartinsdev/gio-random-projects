import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Sparkles, Users, Wand2 } from "lucide-react";
import { api, peekPresetDeck, type CustomDeckInfo, type DeckInfo, type RoomSummary } from "@/lib/api";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Avatar } from "@/components/ui/lottie-avatar";
import { arrowRightCircleIcon, loadingIcon, radioButtonIcon } from "@/lib/lottie-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

// How often the "salas rolando" list refreshes. Frequent enough that a
// room appearing/emptying out feels close to live, cheap enough (one
// small JSON response) that nobody notices the polling.
const ROOMS_POLL_MS = 5_000;

// The winning-score choices the host picks between. "5" is the classic
// table default; anything lower turns a game into one round and
// anything higher out-lives a party.
const WINNING_SCORES = [3, 5, 8, 10];

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
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [customDecks, setCustomDecks] = useState<CustomDeckInfo[]>([]);
  // All decks on by default -- "everything, shuffle it together" is
  // what most rooms want, and deselecting is one tap on a chip.
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [winningScore, setWinningScore] = useState(5);

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

  useEffect(() => {
    let cancelled = false;
    api
      .listDecks()
      .then((list) => {
        if (cancelled) return;
        setDecks(list);
        // A marketplace deck stashed by the forge's "jogar" button wins:
        // that session is meant to be played with exactly that deck.
        // Peek, don't take -- this effect re-runs (StrictMode in dev) and
        // the preset is spent by the lobby when the game actually starts.
        const preset = peekPresetDeck();
        if (preset) setSelectedDecks(new Set([preset]));
        else setSelectedDecks(new Set(list.map((d) => d.id)));
      })
      .catch(() => {
        // No decks listed just means the create form shows none to pick
        // -- joining still works, so this isn't worth an error banner.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Marketplace decks are opt-in per room: they show up as chips, but
  // never shuffle themselves silently into every game.
  useEffect(() => {
    let cancelled = false;
    api
      .listCustomDecks()
      .then((list) => {
        if (!cancelled) setCustomDecks(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
      navigate(`/r/${roomId}`, {
        state: { password: createPassword, name: name.trim(), decks: [...selectedDecks], winningScore },
      });
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

  function toggleDeck(id: string) {
    setSelectedDecks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <ThemeToggle className="absolute right-3 top-3" />
      <div className="w-full max-w-3xl">
        <motion.div
          className="mb-8 text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h1 className="font-display text-4xl font-bold tracking-tight">
            cch<span className="text-muted-foreground">.giomartins.dev</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            Cartas contra a humanidade. Decks temáticos, cartas pesadas. Sem cadastro.
          </p>
        </motion.div>

        <AnimatePresence initial={false}>
          {activeRooms.length > 0 && (
            <motion.div
              key="active-rooms"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AnimatedIcon animation={radioButtonIcon} size={18} autoplay loop className="text-green-500" />
                    Salas rolando agora
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <AnimatePresence initial={false}>
                    {activeRooms.map((room) => (
                      <motion.button
                        key={room.roomId}
                        type="button"
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => pickRoom(room.roomId)}
                        className="flex w-full items-center justify-between rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                      >
                        <span className="font-mono tracking-wide">{room.roomId}</span>
                        <span className="inline-flex items-center gap-2 text-muted-foreground">
                          {room.playing && <span className="text-xs text-green-500">jogando</span>}
                          <Users className="size-3.5" />
                          {room.people}
                        </span>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        >
          <Card className="flex overflow-hidden">
            {/* The cast leaning against the wall of the card -- bonequinhos
                waiting for the room to fill, the same characters that'll
                stand beside everyone's cards once a round starts. A side
                rail reads as "these are the players" without competing
                with the form for the eye the way a hero banner would. */}
            <div className="hidden w-20 shrink-0 flex-col items-center justify-center gap-5 border-r-2 bg-secondary/40 py-6 sm:flex">
              {/* gato/robô/alien -- ears, antenna, antennae give them a
                  silhouette that still reads at a glance this small;
                  the plain round bodies (blob/tangerina/fantasma) turn
                  into an unreadable blob at this size. */}
              {[3, 4, 5].map((i) => (
                <motion.div
                  key={i}
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 2 + i * 0.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.25 }}
                >
                  <Avatar index={i} size={48} />
                </motion.div>
              ))}
            </div>
            <div className="min-w-0 flex-1">
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
                  <form onSubmit={handleCreate} className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-4">
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

                      <div className="space-y-2">
                        <Label>Pontos para ganhar</Label>
                        <div className="flex gap-2">
                          {WINNING_SCORES.map((score) => (
                            <button
                              key={score}
                              type="button"
                              onClick={() => setWinningScore(score)}
                              className={cn(
                                "flex-1 rounded-xl border-2 px-3 py-2 font-display text-sm font-semibold tabular-nums transition-colors",
                                winningScore === score
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-border text-muted-foreground hover:bg-accent",
                              )}
                            >
                              {score}
                            </button>
                          ))}
                        </div>
                      </div>

                      <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="hidden sm:block">
                        <Button type="submit" className="w-full" disabled={creating}>
                          <AnimatedIcon animation={creating ? loadingIcon : arrowRightCircleIcon} autoplay={creating} loop={creating} />
                          Criar sala
                        </Button>
                      </motion.div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Decks</Label>
                        <Link
                          to="/forja"
                          className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
                        >
                          <Wand2 className="size-3" /> criar novo com IA
                        </Link>
                      </div>
                      <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                        {decks.map((deck) => (
                          <DeckChip
                            key={deck.id}
                            deck={deck}
                            selected={selectedDecks.has(deck.id)}
                            onToggle={() => toggleDeck(deck.id)}
                          />
                        ))}
                        {customDecks.map((deck) => (
                          <DeckChip
                            key={deck.id}
                            deck={deck}
                            custom
                            selected={selectedDecks.has(deck.id)}
                            onToggle={() => toggleDeck(deck.id)}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Todas as cartas dos decks escolhidos são embaralhadas juntas.
                      </p>
                    </div>

                    <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="sm:hidden">
                      <Button type="submit" className="w-full" disabled={creating}>
                        <AnimatedIcon animation={creating ? loadingIcon : arrowRightCircleIcon} autoplay={creating} loop={creating} />
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
                      <Button type="submit" className="w-full" disabled={joining}>
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
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
          className="mt-4"
        >
          <Link to="/forja" className="group block">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-accent2/30 bg-accent2/10 px-4 py-3 transition-colors hover:border-accent2/60 hover:bg-accent2/15">
              <motion.span
                className="text-2xl"
                animate={{ rotate: [0, -10, 10, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              >
                ✨
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold">Forja de decks</div>
                <div className="text-xs text-muted-foreground">
                  Gere um deck novo com IA sobre qualquer tema, refine à mão e publique.
                </div>
              </div>
              <Sparkles className="size-4 shrink-0 text-accent2 transition-transform group-hover:scale-110" />
            </div>
          </Link>
        </motion.div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          18+. Humor pesado, sem censura — as cartas são de mentira, a vergonha é real.
        </p>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
          Conteúdo de decks baseado em{" "}
          <a
            href="https://cardsagainsthumanity.com"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-foreground"
          >
            Cards Against Humanity
          </a>{" "}
          (CC BY-NC-SA 4.0) e na adaptação brasileira fan-made. Projeto pessoal, sem fins comerciais.
        </p>
      </div>
    </div>
  );
}

// One deck chip, shared by the built-in decks and the marketplace's
// (which carry the sparkle so nobody mistakes them for stock content).
function DeckChip({
  deck,
  custom,
  selected,
  onToggle,
}: {
  deck: Pick<DeckInfo, "id" | "emoji" | "name" | "description" | "whites" | "blacks">;
  custom?: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      title={deck.description}
      onClick={onToggle}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -2 }}
      className={cn(
        "relative flex items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-primary/40 hover:bg-accent",
      )}
    >
      <span className="text-2xl leading-none">{deck.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate font-display font-semibold text-foreground">
          {deck.name}
          {custom && <Sparkles className="size-3 shrink-0 text-primary" />}
        </span>
        <span className="text-xs text-muted-foreground">{deck.whites + deck.blacks} cartas</span>
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
    </motion.button>
  );
}