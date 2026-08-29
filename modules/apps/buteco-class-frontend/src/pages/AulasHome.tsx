import { useEffect, useState } from "react";
import { Link } from "react-router";
import { History, MonitorPlay } from "lucide-react";
import { classroomApi, type Room } from "../lib/classroomApi.js";
import { Badge, Banner, Button, EmptyState, ErrorState, Field, Input, PageShell, Skeleton, buttonClasses } from "../components/ui/index.js";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// ProtectedRoute already guarantees a session before this mounts --
// same reasoning as BookClubHome.tsx.
export default function AulasHome() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // classroom-api answers createRoom with 202 and materializes the
  // room async -- the list may not show it on the very next fetch,
  // so the success feedback says exactly that instead of lying with
  // an instant redirect.
  const [materializing, setMaterializing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  function reload() {
    classroomApi
      .listRooms()
      .then((res) => setRooms(res.rooms))
      .catch((err) => setListError(err.message));
  }

  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      await classroomApi.createRoom(title.trim());
      setTitle("");
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
        Aulas<span className="text-gradient"> ao vivo</span>
      </h1>
      <p className="text-buteco-cream/60 mb-8 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
        Abra uma aula, compartilhe sua tela ou câmera, e use o bloco de notas e o chat em tempo real com a turma.
      </p>

      <form id="criar-aula" onSubmit={handleCreate} className="glass-card shadow-glow rounded-2xl p-6 mb-8 flex flex-col sm:flex-row gap-4 items-stretch sm:items-end animate-fade-in-up" style={{ animationDelay: "120ms" }}>
        <Field label="Título da aula" className="flex-1">
          <Input
            type="text"
            placeholder="Ex: Introdução a Go -- aula 1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full"
          />
        </Field>
        <Button type="submit" loading={creating}>
          Abrir aula
        </Button>
      </form>

      {materializing && (
        <Banner tone="info" className="mb-6" title="Aula abrindo">
          O pedido de criação foi aceito -- a aula aparece na lista em instantes.
        </Banner>
      )}
      {createError && (
        <Banner tone="error" className="mb-6">
          {createError}
        </Banner>
      )}

      {listError && rooms === null ? (
        <ErrorState title="Não deu pra listar as aulas" message={listError} onRetry={reload} />
      ) : rooms === null ? (
        <div role="status" aria-label="Carregando aulas" className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon={<MonitorPlay size={22} />}
          title="Nenhuma aula aberta ainda"
          description="Abra a primeira: compartilhe a tela e ensine algo pra turma."
          action={
            <a href="#criar-aula" className={buttonClasses({ variant: "secondary" })}>
              Abrir uma aula
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
                to={`/aulas/${r.id}`}
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
                      <History size={14} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">leitura do histórico de chat</span>
                    </>
                  ) : (
                    <>
                      <MonitorPlay size={14} className="shrink-0" aria-hidden="true" />
                      <span className="truncate">transmitindo agora</span>
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