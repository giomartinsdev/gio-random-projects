import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { GOOGLE_CLIENT_ID, loadGoogleIdentityScript, signInWithGoogle } from "@/lib/auth";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

// Tela dedicada de entrada: sem senha, sem formulário de cadastro
// próprio -- o primeiro login com uma conta Google JÁ É a criação da
// conta. O botão é o de verdade do Google Identity Services (não um
// link de navegação pro antigo hop do Cloudflare Access): ele entrega
// um ID token que mandamos pro contas-api verificar e trocar pela
// sessão do produto.
export function EntrarPage() {
  const navigate = useNavigate();
  const botaoRef = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function handleCredential(response: { credential: string }) {
      setProcessando(true);
      setErro(null);
      try {
        await signInWithGoogle(response.credential);
        if (ativo) navigate("/app", { replace: true });
      } catch {
        if (ativo) {
          setErro("Não conseguimos entrar com essa conta. Tente novamente.");
          setProcessando(false);
        }
      }
    }

    loadGoogleIdentityScript()
      .then(() => {
        if (!ativo || !window.google || !botaoRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
        });
        window.google.accounts.id.renderButton(botaoRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 320,
        });
      })
      .catch(() => {
        if (ativo) setErro("Não conseguimos carregar o login do Google agora.");
      });

    return () => {
      ativo = false;
    };
  }, [navigate]);

  return (
    <div className="textura-papel flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-16">
      <motion.a
        href="/"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mb-10 font-display text-lg font-semibold tracking-tight"
      >
        ◆ finanças
      </motion.a>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lift"
      >
        <h1 className="text-balance text-center font-display text-2xl font-semibold tracking-tight">
          Entre ou crie sua conta
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Aberto para qualquer conta Google — seu primeiro login já cria seu espaço, isolado e
          só seu.
        </p>

        <div className="mt-8 flex justify-center">
          <div ref={botaoRef} />
        </div>
        {processando && (
          <p className="mt-4 text-center text-xs text-muted-foreground">Entrando…</p>
        )}
        {erro && <p className="mt-4 text-center text-xs text-destructive">{erro}</p>}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Ao continuar, seus dados ficam isolados e visíveis só para você.
        </p>
      </motion.div>

      <a
        href="/"
        className="mt-8 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        ← Voltar para a página inicial
      </a>
    </div>
  );
}
