// Minha área: a tela de entrada (quando visitante) e o perfil pessoal (quando
// conectado), com os clubes que o login desbloqueou por nível.
//
// O hub é usável sem login — esta tela deixa explícito o que o login
// acrescenta, em vez de sugerir que algo está faltando.

import { useEffect, useState } from "react";
import { Bell, Compass, RefreshCw, Star } from "lucide-react";
import { VerifiedIcon } from "../components/icons";
import { api } from "../lib/api";import type { PlayerProfile, SyncRun, WatchEntry } from "../lib/types";
import { Badge, Card, Empty, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { GoogleSignInButton } from "../components/google-signin";
import { fmt, POS_LABEL } from "../lib/format";

export function MyAreaPage({
  authed,
  email,
  sync,
  onStartSync,
  onSignedIn,
  onOpenClub,
  onOpenPlayer,
  onToggleWatch,
}: {
  authed: boolean | null;
  email: string;
  sync: SyncRun | null;
  onStartSync: () => void;
  onSignedIn: () => void;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
  onToggleWatch: (id: string) => void;
}) {
  if (authed === null) return <Spinner label="verificando sua sessão…" />;
  if (!authed) return <LoginScreen onSignedIn={onSignedIn} />;
  return <Profile email={email} sync={sync} onStartSync={onStartSync} onOpenClub={onOpenClub} onOpenPlayer={onOpenPlayer} onToggleWatch={onToggleWatch} />;
}

function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <>
      <PageHead
        title="Minha área"
        sub="O hub funciona sem login. Entrando, ele descobre seus clubs, os rivais deles e os rivais dos rivais — e traz tudo sozinho, em segundo plano."
      />
      <div className="mx-auto max-w-xl">
        <Card title="Entrar com o Google">
          <div className="flex flex-col gap-4 px-5 py-5">
            <div className="flex justify-center">
              <GoogleSignInButton onSuccess={onSignedIn} />
            </div>
            <p className="text-xs text-muted">
              Sem cadastro e sem senha nova: usamos o mesmo login do resto do hub. Você sai quando quiser.
            </p>
            <ul className="flex flex-col gap-2.5 text-sm text-muted">
              {[
                [Compass, "Explorar clubs, players e matches", "isso já funciona sem entrar"],
                [Star, "Seguir clubs e montar sua lista", "escolha os que te interessam"],
                [RefreshCw, "Seus clubs atualizados sozinhos", "o hub trabalha em segundo plano"],
                [Bell, "Avisos no Discord quando quiser", "você escolhe o que receber"],
              ].map(([Icon, title, desc]) => {
                const I = Icon as typeof Compass;
                return (
                  <li key={title as string} className="flex items-start gap-2.5">
                    <I className="mt-0.5 size-4 shrink-0" strokeWidth={2} style={{ color: "var(--accent)" }} />
                    <span>
                      <span className="font-semibold text-ink">{title as string}</span>
                      <span className="block text-xs text-faint">{desc as string}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}

function Profile({
  email,
  sync,
  onStartSync,
  onOpenClub,
  onOpenPlayer,
  onToggleWatch,
}: {
  email: string;
  sync: SyncRun | null;
  onStartSync: () => void;
  onOpenClub: (id: string) => void;
  onOpenPlayer: (id: string) => void;
  onToggleWatch: (id: string) => void;
}) {
  const [watch, setWatch] = useState<WatchEntry[] | null>(null);
  const [pro, setPro] = useState<PlayerProfile | null>(null);

  const load = () => {
    api.watchlist().then((r) => setWatch(r.clubs ?? [])).catch(() => setWatch([]));
    api
      .claimedPro()
      .then((r) => {
        if (r.pro?.player_id) {
          api.player(r.pro.player_id).then(setPro).catch(() => setPro(null));
        }
      })
      .catch(() => setPro(null));
  };

  useEffect(load, []);

  // Quando a sincronização termina, a lista de clubes mudou — recarrega.
  useEffect(() => {
    if (sync && !sync.running) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.running]);

  const porOrigem = (source: WatchEntry["source"]) => (watch ?? []).filter((w) => w.source === source);

  return (
    <>
      <PageHead
        title="Minha área"
        sub={`Conectado com ${email}`}
        actions={
          <button
            type="button"
            onClick={onStartSync}
            className="rounded-md border border-line-strong px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-muted transition-colors hover:text-ink"
          >
            {sync?.running ? "sincronizando…" : "atualizar meus clubs"}
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="clubs que você segue" value={fmt(watch?.length ?? 0)} sub="atualizados sozinhos" accent />
        <Stat
          label="status da sincronização"
          value={sync?.running ? "em andamento" : "tudo em dia"}
          sub={sync?.running ? `${fmt(sync.completed)}/${fmt(sync.total)}` : "nada pendente"}
        />
        <Stat label="clubs liberados pelo login" value={fmt(porOrigem("rival").length + porOrigem("rival_of_rival").length)} sub="rivais e clubs from_division clubs" />
        <Stat label="seu pro" value={pro ? pro.gamertag : "não reivindicado"} sub={pro ? `rating ${fmt(pro.rating, 2)}` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Seu pro">
          {pro ? (
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base font-bold">{pro.gamertag}</span>
                  <span className="block font-mono text-[10px] text-faint">
                    {POS_LABEL[pro.position]} · {pro.club_name}
                  </span>
                </span>
                {pro.verified && (
                  <Badge tone="accent">
                    <VerifiedIcon /> verified
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="rating" value={fmt(pro.rating, 2)} />
                <Stat label="goals" value={fmt(pro.goals)} />
                <Stat label="played" value={fmt(pro.played)} />
              </div>
              <button
                type="button"
                onClick={() => onOpenPlayer(pro.player_id)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-muted hover:text-ink"
              >
                ver meu perfil
              </button>
            </div>
          ) : (
            <div className="px-4 py-4">
              <p className="text-sm text-muted">Você ainda não reivindicou seu pro.</p>
              <p className="mt-2 text-xs text-faint">
                Reivindicar league a sua conta à gamertag e dá o selo from_division verified no perfil público.
              </p>
            </div>
          )}
        </Card>

        <Card title="Sincronização">
          <div className="px-4 py-4">
            {sync?.running ? (
              <>
                <div className="font-display text-sm font-bold">Trabalhando em segundo plano</div>
                <div className="mt-1 text-xs text-muted">
                  {fmt(sync.completed)} from_division {fmt(sync.total)} · agora: {sync.current || "…"}
                </div>
                <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${sync.total ? (sync.completed / sync.total) * 100 : 0}%`, background: "var(--accent)" }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="font-display text-sm font-bold">Tudo em dia</div>
                <div className="mt-1 text-xs text-muted">
                  {sync?.total ? `${fmt(sync.total)} clubs processados` : "nada pendente"}
                </div>
              </>
            )}
            <p className="mt-3 text-xs text-muted">
              Você não precisa esperar: pode navegar enquanto o hub termina from_division trazer seus clubs.
            </p>
          </div>
        </Card>

        <Card title="Clubs que você segue">
          {watch === null ? (
            <Spinner />
          ) : watch.length === 0 ? (
            <Empty title="Nenhum clube seguido" hint="Abra um clube e toque em seguir — ou deixe a sincronização trazer os seus." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {watch.map((w) => (
                <li key={w.club_id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <button type="button" onClick={() => onOpenClub(w.club_id)} className="min-w-0 flex-1 truncate text-left hover:text-accent">
                    <span className="font-semibold">{w.name}</span>{" "}
                    <span className="font-mono text-[10px] text-faint">
                      D{w.division_at_read} · nível {fmt(w.skill_rating)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleWatch(w.club_id);
                      setWatch((prev) => (prev ?? []).filter((x) => x.club_id !== w.club_id));
                    }}
                    title="deixar from_division seguir"
                    className="text-[var(--gold)]"
                  >
                    <Star className="size-4" fill="currentColor" strokeWidth={0} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="O que seu login trouxe">
        <div className="grid gap-4 px-4 py-4 md:grid-cols-3">
          <Level title="Seus clubs" hint="onde você joga" entries={porOrigem("own")} onOpenClub={onOpenClub} />
          <Level title="Rivais diretos" hint="adversários recentes" entries={porOrigem("rival")} onOpenClub={onOpenClub} />
          <Level title="Clubs from_division clubs" hint="rivais dos rivais" entries={porOrigem("rival_of_rival")} onOpenClub={onOpenClub} />
        </div>
      </Card>
    </>
  );
}

function Level({
  title,
  hint,
  entries,
  onOpenClub,
}: {
  title: string;
  hint: string;
  entries: WatchEntry[];
  onOpenClub: (id: string) => void;
}) {
  return (
    <div className="surface p-3">
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-bold">{title}</span>
        <Badge>{entries.length}</Badge>
      </div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.length === 0 ? (
          <li className="text-xs text-faint">nada aqui ainda</li>
        ) : (
          entries.map((w) => (
            <li key={w.club_id}>
              <button
                type="button"
                onClick={() => onOpenClub(w.club_id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-3"
              >
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="font-mono text-[10px] text-faint">D{w.division_at_read}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

