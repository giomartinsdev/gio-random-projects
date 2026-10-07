import type { InputHTMLAttributes, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";

// Peças das telas de entrada (poc.pen §V1, frames Ub3iA/CfIAJ): campos com
// rótulo 13/500 em app-text2, input escuro raio 10 e botão primário de largura
// cheia. O painel de marca (login) e o rail (cadastro) trazem dot grid + orbs.

export function AuthField({
  label,
  extra,
  error,
  children,
}: {
  label?: string;
  extra?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex w-full flex-col gap-2">
      {(label || extra) && (
        <span className="flex items-center justify-between">
          {label && <span className="text-[13px] font-medium text-fg-2">{label}</span>}
          {extra}
        </span>
      )}
      {children}
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </label>
  );
}

export function AuthInput({ invalid, ...props }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} className={cn(invalid && "border-danger focus:border-danger focus:ring-[rgba(220,38,38,0.35)]")} />;
}

export function AuthSubmit({ children, busy, ...props }: { children: ReactNode; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-5 py-[14px] text-[15px] font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    >
      {children}
      {!busy && <ArrowRight size={16} />}
    </button>
  );
}

export function AuthAlert({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-sm border px-3.5 py-2.5 text-[13px]",
        kind === "error" ? "border-danger/40 bg-danger/10 text-danger" : "border-line bg-elevated text-fg-2",
      )}
    >
      {children}
    </p>
  );
}

export function AuthDivider() {
  return (
    <div className="flex w-full items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[12px] text-fg-3">ou</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

// Botão "Continuar com Google" do design. A API do contrato só tem
// /auth/login e /auth/signup (e-mail/senha), então ele fica visível mas inerte.
export function GoogleButton() {
  return (
    <button
      type="button"
      disabled
      title="Login social ainda não está disponível"
      className="inline-flex w-full items-center justify-center gap-2.5 rounded-sm border border-line bg-bg px-5 py-3 text-[14px] font-medium text-fg transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-70"
    >
      <GoogleGlyph />
      Continuar com Google
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
