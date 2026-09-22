// O botão oficial do Google Identity Services.
//
// O botão é renderizado pelo próprio Google (não é um link estilizado por nós):
// é ele que entrega o ID token que o clubs-api verifica. Um link comum para o
// Google não serve aqui -- o token precisa nascer no contexto certo.

import { useEffect, useRef, useState } from "react";
import {
  GOOGLE_CLIENT_ID,
  loadGoogleIdentityScript,
  loginConfigurado,
  signInWithGoogle,
} from "../lib/auth";

export function GoogleSignInButton({ onSuccess }: { onSuccess?: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    if (!loginConfigurado()) return;
    let alive = true;

    loadGoogleIdentityScript()
      .then(() => {
        if (!alive || !window.google?.accounts?.id || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            setEntrando(true);
            setErro("");
            try {
              await signInWithGoogle(response.credential);
              onSuccess?.();
            } catch {
              if (alive) {
                setErro("Não conseguimos entrar com essa conta. Tente de novo.");
                setEntrando(false);
              }
            }
          },
        });
        window.google.accounts.id.renderButton(holder.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 300,
        });
      })
      .catch(() => alive && setErro("Não conseguimos carregar o login do Google agora."));

    return () => {
      alive = false;
    };
  }, [onSuccess]);

  if (!loginConfigurado()) {
    // Sem client ID o botão não existiria; explicar é melhor que um botão morto.
    return (
      <p className="text-xs text-faint">
        O login com Google não está configurado neste ambiente. O resto do hub continua aberto.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={holder} />
      {entrando && <p className="text-xs text-muted">Entrando…</p>}
      {erro && <p className="text-xs" style={{ color: "var(--danger)" }}>{erro}</p>}
    </div>
  );
}
