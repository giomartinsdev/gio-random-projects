import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { bookclubApi, type Room } from "../lib/bookclubApi.js";
import Button from "../components/Button.js";

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
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function reload() {
    bookclubApi
      .listRooms()
      .then((res) => setRooms(res.rooms))
      .catch((err) => setError(err.message));
  }

  useEffect(reload, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const pdf = fileRef.current?.files?.[0];
    if (!title.trim() || !pdf) return;

    setCreating(true);
    setError(null);
    try {
      await bookclubApi.createRoom(title.trim(), pdf);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1 className="font-heading font-bold text-4xl mb-1 animate-fade-in-up">
        Clube do <span className="text-gradient">Livro</span>
      </h1>
      <p className="text-buteco-cream/60 mb-10 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
        Suba um PDF, abra uma sala, chame a galera para ler junto -- página, anotações e chat em tempo real.
      </p>

      <form
        onSubmit={handleCreate}
        className="glass-card glow-amber p-6 mb-10 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end animate-fade-in-up"
      >
        <div className="flex-1">
          <label className="block font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/50 mb-1">
            Título da sala
          </label>
          <input
            type="text"
            placeholder="Ex: Duna -- capítulo 1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="field w-full"
          />
        </div>
        <div>
          <label className="block font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/50 mb-1">
            PDF
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            required
            className="text-sm text-buteco-cream/80 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-buteco-amber file:text-buteco-navy file:font-heading file:font-semibold file:cursor-pointer cursor-pointer"
          />
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Enviando…" : "Abrir sala"}
        </Button>
      </form>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {rooms === null && !error && <p className="text-buteco-cream/60">Carregando…</p>}
      {rooms?.length === 0 && <p className="text-buteco-cream/60">Nenhuma sala aberta ainda -- seja o primeiro.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {rooms?.map((r, i) => {
          const closed = r.status === "closed";
          return (
            <Link
              key={r.id}
              to={`/clube-do-livro/${r.id}`}
              style={{ animationDelay: `${120 + i * 60}ms` }}
              className={`group glass-card overflow-hidden animate-fade-in-up p-6 hover:bg-white/10 hover:-translate-y-0.5 transition-all ${
                closed ? "opacity-60 hover:border-white/20" : "hover:border-buteco-amber/30"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 font-mono text-xs text-buteco-amber/70">
                <span className="uppercase tracking-wide">Sala</span>
                <span>·</span>
                <span>{formatDate(r.createdAt)}</span>
                {closed && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-white/10 text-buteco-cream/60 normal-case tracking-normal">
                    Encerrada
                  </span>
                )}
              </div>
              <h3 className="font-heading font-semibold text-xl text-buteco-cream group-hover:text-buteco-amber transition-colors">
                {r.title}
              </h3>
              <p className="text-buteco-cream/50 text-sm mt-1">
                {closed ? "leitura do PDF e do histórico de chat" : `página ${r.currentPage}`}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
