import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSession } from "../lib/authClient.js";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) return <p className="text-buteco-cream/60 text-center">Carregando…</p>;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
