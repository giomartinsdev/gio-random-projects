import type { ReactNode } from "react";
import { motion } from "framer-motion";

// Casca compartilhada por /privacidade e /termos: ambas existem hoje só
// para satisfazer o requisito da tela de consentimento OAuth do Google
// (Branding aponta pra elas) -- conteúdo mínimo e honesto sobre um
// projeto pessoal, não um contrato jurídico revisado.
export function LegalPage({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="textura-papel min-h-dvh bg-background px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-2xl"
      >
        <a href="/" className="font-display text-lg font-semibold tracking-tight">
          ◆ finanças
        </a>

        <h1 className="mt-10 text-balance font-display text-3xl font-semibold tracking-tight">
          {titulo}
        </h1>

        <div className="prose prose-sm mt-6 max-w-none text-sm leading-relaxed text-muted-foreground [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mt-3">
          {children}
        </div>

        <a
          href="/"
          className="mt-10 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Voltar para a página inicial
        </a>
      </motion.div>
    </div>
  );
}
