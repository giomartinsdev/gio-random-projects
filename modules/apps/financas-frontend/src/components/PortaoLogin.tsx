import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router";
import { probeLogin } from "@/lib/auth";

type Estado = "checando" | "logada" | "deslogada";

// Gate de sessão do produto (tudo sob /app): proba /api/me em
// contas-api via redirect:"manual". Sem sessão, manda de volta pra "/"
// -- a landing pública é quem tem o CTA de login (loginNavigationUrl),
// não este componente.
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
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
