import { motion } from "framer-motion";
import { loginNavigationUrl } from "@/lib/auth";

// Ícone oficial do Google ("G" de 4 cores) -- padrão de mercado pra
// botão "Continuar com o Google", não uma logo genérica.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

// Tela dedicada de entrada: sem senha, sem formulário de cadastro
// próprio -- o primeiro login com uma conta Google JÁ É a criação da
// conta (financas-frontend abriu para qualquer conta Google, ver
// modules/infra/terraform's public_signup_hostnames). Uma única ação,
// dois rótulos possíveis dependendo de quem já esteve aqui antes.
export function EntrarPage() {
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

        <button
          onClick={() => (window.location.href = loginNavigationUrl())}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-full border border-border bg-background py-3 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <GoogleIcon />
          Continuar com o Google
        </button>

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
