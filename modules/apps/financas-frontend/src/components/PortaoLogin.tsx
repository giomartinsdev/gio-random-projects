import { useEffect, useState, type ReactNode } from "react";
import { probeLogin, loginNavigationUrl } from "@/lib/auth";
import { Botao } from "@/components/Botao";

type Estado = "checando" | "logada" | "deslogada";

// Gate simples de sessão: proba /sso da API âncora (contas-api) via
// redirect:"manual". Enquanto "checando", não renderiza nada sensível;
// se "deslogada", oferece o link de login (que passa pelo Access).
export function PortaoLogin({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>("checando");

  useEffect(() => {
    let ativo = true;
    probeLogin().then((ok) => {
      if (ativo) setEstado(ok ? "logada" : "deslogada");
    });
    return () => {
      ativo = false;
    };
  }, []);

  if (estado === "checando") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <span className="font-display text-2xl text-muted-foreground">◆</span>
      </div>
    );
  }

  if (estado === "deslogada") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <span className="font-display text-4xl font-semibold tracking-tight">◆ finanças</span>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sua sessão não foi encontrada. Entre com a conta autorizada para ver seus dados
          financeiros.
        </p>
        <Botao onClick={() => (window.location.href = loginNavigationUrl())}>Entrar</Botao>
      </div>
    );
  }

  return <>{children}</>;
}
