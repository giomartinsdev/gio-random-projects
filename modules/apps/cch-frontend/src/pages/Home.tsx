import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Users } from "lucide-react";
import { api, type DeckInfo, type RoomSummary } from "@/lib/api";
import { AnimatedIcon } from "@/components/ui/animated-icon";
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
        setSelectedDecks(new Set(list.map((d) => d.id)));
      })
      .catch(() => {
        // No decks listed just means the create form shows none to pick
        // -- joining still works, so this isn't worth an error banner.
      });
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
      <div className="w-full max-w-md">
        <motion.div
          className="mb-8 text-center"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h1 className="text-4xl font-bold tracking-tight">
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
                        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
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
          <Card>
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

                    <div className="space-y-2">
                      <Label>Decks</Label>
                      <div className="flex flex-wrap gap-2">
                        {decks.map((deck) => {
                          const selected = selectedDecks.has(deck.id);
                          return (
                            <motion.button
                              key={deck.id}
                              type="button"
                              title={deck.description}
                              onClick={() => toggleDeck(deck.id)}
                              whileTap={{ scale: 0.94 }}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                                selected
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "text-muted-foreground hover:bg-accent",
                              )}
                            >
                              {selected ? (
                                <Check className="size-3.5 text-primary" />
                              ) : (
                                <span className="size-3.5" />
                              )}
                              <span>
                                {deck.emoji} {deck.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {deck.whites + deck.blacks}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Todas as cartas dos decks escolhidos são embaralhadas juntas.
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
                              "flex-1 rounded-md border px-3 py-2 text-sm tabular-nums transition-colors",
                              winningScore === score
                                ? "border-primary bg-primary/15 font-medium text-foreground"
                                : "text-muted-foreground hover:bg-accent",
                            )}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    </div>

                    <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
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
          </Card>
        </motion.div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          18+. Humor pesado, sem censura — as cartas são de mentira, a vergonha é real.
        </p>
      </div>
    </div>
  );
}