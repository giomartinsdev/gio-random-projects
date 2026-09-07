import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import {
  api,
  rememberPresetDeck,
  type CustomDeck,
  type CustomDeckInfo,
  type DeckDraft,
  type DeckInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Confetti } from "@/components/ui/confetti";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

// A publishable deck needs enough cards for a real game. Same numbers
// the API enforces (customdecks.minWhites/minBlacks) -- mirrored here
// so the publish button knows it's safe to light up before the request
// ever leaves the page.
const MIN_WHITES = 10;
const MIN_BLACKS = 4;

// Free-form theme suggestions. Deliberately in the game's register --
// specific enough to spark a deck, loose enough that the person typing
// their own is never the wrong answer.
const THEME_SUGGESTIONS = [
  "futebol brasileiro",
  "telenovela das nove",
  "hospital",
  "casamento",
  "crime organizado",
  "fast food",
  "escola",
  "política",
  "fim do mundo",
  "grupo de família no zap",
];

const EMPTY_DRAFT: DeckDraft = { name: "", emoji: "🎴", description: "", whites: [], blacks: [] };

// The forge: pick a base deck, give the AI a theme, then refine every
// card by hand before publishing to the marketplace. The AI drafts;
// the human decides -- nothing reaches the marketplace unedited.
export default function Forja() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"forge" | "market">("forge");
  const [builtins, setBuiltins] = useState<DeckInfo[]>([]);
  const [market, setMarket] = useState<CustomDeckInfo[]>([]);

  // Forge state.
  const [baseId, setBaseId] = useState<string | null>(null);
  const [theme, setTheme] = useState("");
  const [draft, setDraft] = useState<DeckDraft | null>(null);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [author, setAuthor] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<CustomDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = still asking; false turns the generate button into a
  // "write it yourself" nudge rather than a dead end.
  const [aiOn, setAiOn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listDecks()
      .then((list) => !cancelled && setBuiltins(list))
      .catch(() => {});
    api
      .listCustomDecks()
      .then((list) => !cancelled && setMarket(list))
      .catch(() => {});
    api
      .aiStatus()
      .then((s) => !cancelled && setAiOn(s.configured))
      .catch(() => !cancelled && setAiOn(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function generate() {
    if (generating || !baseId) return;
    setError(null);
    setGenerating(true);
    setPublished(null);
    try {
      const { draft } = await api.generateDeck(baseId, theme);
      setDraft({ ...draft, whites: [...draft.whites], blacks: [...draft.blacks] });
      setParentId(baseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "a forja falhou, tente de novo");
    } finally {
      setGenerating(false);
    }
  }

  function startFromScratch() {
    setDraft({ ...EMPTY_DRAFT, whites: [], blacks: [] });
    setParentId(undefined);
    setPublished(null);
    setError(null);
  }

  async function publish() {
    if (!draft || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const deck = await api.publishDeck({
        name: draft.name,
        emoji: draft.emoji,
        description: draft.description,
        parentId,
        author: author.trim() || undefined,
        whites: draft.whites,
        blacks: draft.blacks,
      });
      setPublished(deck);
      // The publish response carries the cards; the market list carries
      // counts. Convert so the fresh listing renders like the fetched
      // ones.
      setMarket((current) => [
        { ...deck, whites: deck.whites.length, blacks: deck.blacks.length },
        ...current,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function fork(info: CustomDeckInfo) {
    try {
      const full = await api.getCustomDeck(info.id);
      setDraft({
        name: `${full.name} (fork)`,
        emoji: full.emoji,
        description: full.description,
        whites: [...full.whites],
        blacks: [...full.blacks],
      });
      setParentId(full.parentId || undefined);
      setPublished(null);
      setError(null);
      setTab("forge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "não foi possível abrir o deck");
    }
  }

  function playWith(info: CustomDeckInfo) {
    rememberPresetDeck(info.id);
    navigate("/");
  }

  const validation = useMemo(() => validateDraft(draft), [draft]);

  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-8">
      <ThemeToggle className="absolute right-3 top-3" />
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <Link
            to="/"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> início
          </Link>
          <motion.h1
            className="flex items-center gap-2 text-3xl font-bold tracking-tight"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <motion.span
              animate={{ rotate: [0, -8, 8, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              ✨
            </motion.span>
            Forja de Decks
          </motion.h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha um deck base, dê um tema para a IA e refine cada carta à mão. O que passar na
            sua curadoria vai pro mercado.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "forge" | "market")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="forge">Forjar</TabsTrigger>
            <TabsTrigger value="market">Mercado{market.length > 0 ? ` (${market.length})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="forge" className="mt-4">
            <AnimatePresence mode="wait" initial={false}>
              {published ? (
                <motion.div key="published" {...stepTransition}>
                  <PublishedCard deck={published} onAnother={() => setPublished(null)} onMarket={() => setTab("market")} />
                </motion.div>
              ) : draft ? (
                <motion.div key="editor" {...stepTransition}>
                  <Editor
                    draft={draft}
                    onChange={setDraft}
                    parentName={builtins.find((d) => d.id === parentId)?.name}
                    author={author}
                    onAuthor={setAuthor}
                    validation={validation}
                    publishing={publishing}
                    onPublish={publish}
                    onRestart={() => {
                      setDraft(null);
                      setParentId(undefined);
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div key="setup" {...stepTransition}>
                  <Setup
                    decks={builtins}
                    baseId={baseId}
                    onBase={setBaseId}
                    theme={theme}
                    onTheme={setTheme}
                    generating={generating}
                    aiOn={aiOn}
                    onGenerate={generate}
                    onScratch={startFromScratch}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="market" className="mt-4">
            <Market decks={market} onFork={fork} onPlay={playWith} />
          </TabsContent>
        </Tabs>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-4"
            >
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Shared enter/exit for the three forge steps.
const stepTransition = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -14 },
  transition: { duration: 0.28, ease: "easeOut" as const },
};

// ---- Step 1: base deck + theme ----

function Setup({
  decks,
  baseId,
  onBase,
  theme,
  onTheme,
  generating,
  aiOn,
  onGenerate,
  onScratch,
}: {
  decks: DeckInfo[];
  baseId: string | null;
  onBase: (id: string) => void;
  theme: string;
  onTheme: (t: string) => void;
  generating: boolean;
  aiOn: boolean | null;
  onGenerate: () => void;
  onScratch: () => void;
}) {
  return (
    <div className="space-y-4">
      {aiOn === false && (
        <Alert>
          <AlertDescription>
            A IA está desligada neste servidor — dá pra forjar na mão mesmo assim.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Deck base</CardTitle>
          <CardDescription>A IA usa o espírito deste deck como ponto de partida.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {decks.map((deck, i) => {
              const on = deck.id === baseId;
              return (
                <motion.button
                  key={deck.id}
                  type="button"
                  onClick={() => onBase(deck.id)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.96 }}
                  className={cn(
                    "relative rounded-lg border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  {on && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Check className="size-3" />
                    </motion.span>
                  )}
                  <div className="text-2xl">{deck.emoji}</div>
                  <div className="mt-1 text-sm font-medium leading-tight">{deck.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {deck.whites} brancas · {deck.blacks} pretas
                  </div>
                </motion.button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Tema</CardTitle>
          <CardDescription>Livre. Quanto mais específico, mais engraçado o resultado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="ex.: churrasco de domingo que deu errado"
            value={theme}
            onChange={(e) => onTheme(e.target.value)}
            maxLength={80}
            disabled={generating}
          />
          <div className="flex flex-wrap gap-1.5">
            {THEME_SUGGESTIONS.map((s) => (
              <motion.button
                key={s}
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => onTheme(s)}
                disabled={generating}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {s}
              </motion.button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="flex-1">
          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={!baseId || generating || aiOn === false}
            onClick={onGenerate}
          >
            {generating ? <GeneratingLabel /> : <><Wand2 className="size-4" /> Gerar com IA</>}
          </Button>
        </motion.div>
        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}>
          <Button type="button" variant="outline" size="lg" onClick={onScratch} disabled={generating}>
            <Plus className="size-4" /> Criar à mão
          </Button>
        </motion.div>
      </div>
      {!baseId && (
        <p className="text-center text-xs text-muted-foreground">escolha um deck base (ou crie à mão)</p>
      )}
    </div>
  );
}

// The generate button's loading state: a cycling deck of emojis, so the
// wait reads as "the writer is shuffling" instead of a frozen button.
const GENERATING_EMOJIS = ["🃏", "✍️", "🎲", "🖤", "🤍", "🔥", "✨"];

function GeneratingLabel() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 420);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-center gap-2">
      <motion.span
        key={tick}
        initial={{ y: 10, opacity: 0, rotate: -20 }}
        animate={{ y: 0, opacity: 1, rotate: 0 }}
        exit={{ y: -10, opacity: 0 }}
        className="text-base"
      >
        {GENERATING_EMOJIS[tick % GENERATING_EMOJIS.length]}
      </motion.span>
      escrevendo cartas...
    </span>
  );
}

// ---- Step 2: the editor ----

type Validation = { ok: boolean; message: string };

function validateDraft(draft: DeckDraft | null): Validation {
  if (!draft) return { ok: false, message: "" };
  if (!draft.name.trim()) return { ok: false, message: "Dê um nome ao deck." };
  const badBlack = draft.blacks.findIndex((b) => !b.includes("_"));
  if (badBlack >= 0) {
    return { ok: false, message: `A carta preta nº ${badBlack + 1} precisa de um "_" marcando a lacuna.` };
  }
  if (draft.whites.length < MIN_WHITES) {
    return { ok: false, message: `Faltam ${MIN_WHITES - draft.whites.length} cartas brancas (mínimo ${MIN_WHITES}).` };
  }
  if (draft.blacks.length < MIN_BLACKS) {
    return { ok: false, message: `Faltam ${MIN_BLACKS - draft.blacks.length} cartas pretas (mínimo ${MIN_BLACKS}).` };
  }
  return { ok: true, message: `${draft.whites.length} brancas · ${draft.blacks.length} pretas · pronto pra publicar` };
}

function Editor({
  draft,
  onChange,
  parentName,
  author,
  onAuthor,
  validation,
  publishing,
  onPublish,
  onRestart,
}: {
  draft: DeckDraft;
  onChange: (d: DeckDraft) => void;
  parentName?: string;
  author: string;
  onAuthor: (a: string) => void;
  validation: Validation;
  publishing: boolean;
  onPublish: () => void;
  onRestart: () => void;
}) {
  function update(partial: Partial<DeckDraft>) {
    onChange({ ...draft, ...partial });
  }

  return (
    <div className="space-y-4">
      <Card className="relative">
        <CardHeader>
          <CardTitle className="text-base">3. Refine</CardTitle>
          <CardDescription>
            {parentName
              ? `Rascunho gerado a partir de "${parentName}" — edite, apague, adicione. Nada sai daqui sem a sua mão.`
              : "Rascunho em branco — escreva cada carta."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              className="w-16 text-center text-xl"
              value={draft.emoji}
              onChange={(e) => update({ emoji: e.target.value })}
              maxLength={4}
              aria-label="Emoji do deck"
            />
            <Input
              placeholder="Nome do deck"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              maxLength={40}
            />
          </div>
          <Input
            placeholder="Descrição curta (aparece no mercado)"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            maxLength={160}
          />
          <Input
            placeholder="Seu nome (opcional — aparece como autor)"
            value={author}
            onChange={(e) => onAuthor(e.target.value)}
            maxLength={30}
          />
        </CardContent>
      </Card>

      <CardListEditor
        title="Cartas brancas"
        hint="as respostas"
        lines={draft.whites}
        variant="white"
        onChange={(whites) => update({ whites })}
      />
      <CardListEditor
        title="Cartas pretas"
        hint='frases com "_" marcando a lacuna'
        lines={draft.blacks}
        variant="black"
        onChange={(blacks) => update({ blacks })}
      />

      <div className="sticky bottom-4 z-10 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <span className={cn("font-medium", validation.ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
              {validation.message}
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onRestart}>
              Começar de novo
            </Button>
            <motion.div whileHover={validation.ok ? { scale: 1.03 } : undefined} whileTap={validation.ok ? { scale: 0.97 } : undefined}>
              <Button type="button" disabled={!validation.ok || publishing} onClick={onPublish}>
                <Sparkles className="size-4" />
                {publishing ? "Publicando..." : "Publicar no mercado"}
              </Button>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

// One editable card list. White cards render as white cards and black
// cards as black cards in both themes -- you're literally shaping the
// deck while you type.
function CardListEditor({
  title,
  hint,
  lines,
  variant,
  onChange,
}: {
  title: string;
  hint: string;
  lines: string[];
  variant: "white" | "black";
  onChange: (lines: string[]) => void;
}) {
  function setLine(i: number, value: string) {
    const next = [...lines];
    next[i] = value;
    onChange(next);
  }
  function addLine() {
    onChange([...lines, ""]);
  }
  function removeLine(i: number) {
    onChange(lines.filter((_, j) => j !== i));
  }

  const inputClass =
    variant === "white"
      ? "border-black/10 bg-white text-black placeholder:text-black/40"
      : "border-white/10 bg-zinc-900 text-white placeholder:text-white/40";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            {title} <span className="text-xs font-normal text-muted-foreground">({lines.length})</span>
          </span>
          <span className="text-xs font-normal text-muted-foreground">{hint}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <AnimatePresence initial={false}>
          {lines.map((line, i) => (
            <motion.div
              key={`${variant}-${i}`}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-xs font-mono tabular-nums",
                  variant === "white" ? "bg-black/5 text-black/60" : "bg-white/10 text-white/60",
                )}
              >
                {i + 1}
              </span>
              <Input
                className={inputClass}
                value={line}
                onChange={(e) => setLine(i, e.target.value)}
                maxLength={variant === "white" ? 160 : 200}
                placeholder={variant === "white" ? "resposta curta..." : "frase com _ ..."}
              />
              <motion.button
                type="button"
                whileTap={{ scale: 0.85 }}
                onClick={() => removeLine(i)}
                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                aria-label={`Remover ${title.toLowerCase()} ${i + 1}`}
              >
                <Trash2 className="size-4" />
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
        <Button type="button" variant="outline" size="sm" onClick={addLine} className="w-full">
          <Plus className="size-4" /> Adicionar carta
        </Button>
      </CardContent>
    </Card>
  );
}

// ---- Step 3: published ----

function PublishedCard({
  deck,
  onAnother,
  onMarket,
}: {
  deck: CustomDeck;
  onAnother: () => void;
  onMarket: () => void;
}) {
  return (
    <Card className="relative overflow-hidden text-center">
      <Confetti count={36} />
      <CardContent className="relative space-y-3 py-10">
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="text-6xl"
        >
          {deck.emoji}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <h2 className="text-2xl font-bold">{deck.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* The publish response carries the full deck -- cards, not
                counts -- so length them here. */}
            No mercado! {deck.whites.length} brancas · {deck.blacks.length} pretas
          </p>
        </motion.div>
        <div className="flex flex-col justify-center gap-2 pt-2 sm:flex-row">
          <Button type="button" onClick={onMarket} variant="default">
            Ver no mercado
          </Button>
          <Button type="button" onClick={onAnother} variant="outline">
            Forjar outro
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Mercado ----

function Market({
  decks,
  onFork,
  onPlay,
}: {
  decks: CustomDeckInfo[];
  onFork: (deck: CustomDeckInfo) => void;
  onPlay: (deck: CustomDeckInfo) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (decks.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-4xl">🎴</div>
          <p className="mt-3 font-medium">Nenhum deck no mercado ainda</p>
          <p className="mt-1 text-sm text-muted-foreground">Seja a primeira pessoa a forjar um.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <motion.div layout className="space-y-2">
        <AnimatePresence initial={false}>
          {decks.map((deck, i) => {
            const isOpen = open === deck.id;
            return (
              <motion.div
                key={deck.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.3) } }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <motion.button
                  type="button"
                  layout
                  onClick={() => setOpen(isOpen ? null : deck.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.99 }}
                  className={cn(
                    "w-full rounded-lg border p-4 text-left transition-colors",
                    isOpen ? "border-primary bg-primary/5" : "hover:bg-accent",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{deck.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{deck.name}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                          <Sparkles className="size-3" /> mercado
                        </span>
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {deck.description || "sem descrição"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {deck.whites} brancas · {deck.blacks} pretas
                        {deck.author ? ` · por ${deck.author}` : ""}
                        {deck.plays > 0 ? ` · ${deck.plays} partidas` : ""}
                      </p>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        style={{ overflow: "hidden" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="mt-4 flex gap-2 border-t pt-3">
                          <Button type="button" size="sm" onClick={() => onPlay(deck)}>
                            🎲 Jogar com este deck
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => onFork(deck)}>
                            <Wand2 className="size-3.5" /> Abrir na forja
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
      <p className="pt-1 text-center text-xs text-muted-foreground">
        "Jogar" leva pro início: crie ou entre numa sala e marque o deck no lobby.
      </p>
    </div>
  );
}