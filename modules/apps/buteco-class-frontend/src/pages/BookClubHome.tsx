import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { BookOpen, FileText } from "lucide-react";
import { bookclubApi, type Room } from "../lib/bookclubApi.js";
import { Badge, Banner, Button, EmptyState, ErrorState, Field, Input, PageShell, Skeleton, buttonClasses } from "../components/ui/index.js";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// ProtectedRoute already guarantees a session before this mounts --
// unlike Home.tsx, there's no logged-out view of this page worth
// building: joining a room's WebSocket requires a session anyway
// (bookclub-api's own auth check), so a spectator-without-login
// experience would just fail silently at that point.
export default function BookClubHome() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // bookclub-api answers createRoom with 202 and materializes the
  // room (PDF upload included) async -- the honest status line beats
  // pretending the room is instant.
  const [materializing, setMaterializing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function reload() {
    bookclubApi
      .listRooms()
      .then((res) => setRooms(res.rooms))
      .catch((err) => setListError(err.message));
  }

  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const pdf = fileRef.current?.files?.[0];
    if (!title.trim() || !pdf) return;

    setCreating(true);
    setCreateError(null);
    try {
      await bookclubApi.createRoom(title.trim(), pdf);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setMaterializing(true);
      reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Algo deu errado.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageShell width="wide">
      <h1 className="font-heading font-bold text-4xl mb-1 animate-fade-in-up">
        Clube do <span className="text-gradient">Livro</span>
      </h1>
      <p className="text-buteco-cream/60 mb-8 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
        Suba um PDF, abra uma sala, chame a galera para ler junto -- página, anotações e chat em tempo real.
      </p>

      <form
        id="criar-sala"
        onSubmit={handleCreate}
        className="glass-card shadow-glow rounded-2xl p-6 mb-8 flex flex-col sm:flex-row gap-4 items-stretch sm:items-end animate-fade-in-up"
        style={{ animationDelay: "120ms" }}
      >
        <Field label="Título da sala" className="flex-1">
          <Input
            type="text"
            placeholder="Ex: Duna -- capítulo 1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full"
          />
        </Field>
        <Field label="PDF do livro" hint="vai direto para o servidor da sala">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            required
            className="text-sm text-buteco-cream/80 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-buteco-amber file:text-buteco-navy file:font-heading file:font-semibold file:cursor-pointer cursor-pointer"
          />
        </Field>
        <Button type="submit" loading={creating}>
          Abrir sala
        </Button>
      </form>

      {materializing && (
        <Banner tone="info" className="mb-6" title="Sala materializando">
          O PDF está sendo processado -- a sala aparece na lista em instantes.
        </Banner>
      )}
      {createError && (
        <Banner tone="error" className="mb-6">
          {createError}
        </Banner>
      )}

      {listError && rooms === null ? (
        <ErrorState title="Não deu pra listar as salas" message={listError} onRetry={reload} />
      ) : rooms === null ? (
        <div role="status" aria-label="Carregando salas" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={22} />}
          title="Nenhuma sala aberta ainda"
          description="Escolha um PDF e chame a galera para ler junto, página sincronizada."
          action={
            <a href="#criar-sala" className={buttonClasses({ variant: "secondary" })}>
              Abrir uma sala
            </a>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {rooms.map((r, i) => {
            const closed = r.status === "closed";
            return (
              <Link
                key={r.id}
                to={`/clube-do-livro/${r.id}`}
                style={{ animationDelay: `${120 + i * 60}ms` }}
                className={`group glass-card shadow-card animate-fade-in-up p-5 sm:p-6 hover:-translate-y-0.5 transition-all ${
                  closed ? "opacity-60 hover:border-white/20" : "hover:border-buteco-amber/30"
                }`}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <Badge tone={closed ? "muted" : "live"}>{closed ? "Encerrada" : "Ao vivo"}</Badge>
                  <span className="font-mono text-xs text-buteco-cream/40">{formatDate(r.createdAt)}</span>
                </div>
                <h3 className="font-heading font-semibold text-xl group-hover:text-buteco-amber transition-colors truncate">{r.title}</h3>
                <p className="text-buteco-cream/50 text-sm mt-1.5 flex items-center gap-1.5 min-w-0">
                  {closed ? (
                    <>
                      <BookOpen size={14} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">leitura do PDF e do histórico de chat</span>
                    </>
                  ) : (
                    <>
                      <FileText size={14} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">lendo a página {r.currentPage}</span>
                    </>
                  )}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}