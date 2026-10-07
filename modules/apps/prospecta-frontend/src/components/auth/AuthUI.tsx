import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { GOOGLE_BUTTON_OPTIONS, GOOGLE_CLIENT_ID, googleConfigurado, loadGoogleIdentityScript } from "@/lib/google";

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

// Botão "Continuar com Google" real: o próprio GIS renderiza o botão oficial
// (é ele que entrega o ID token). Se o client ID não estiver configurado, o
// bloco some por completo — nada de botão morto.
export function GoogleButton({
  onCredential,
  busy,
  disabled,
}: {
  onCredential: (credential: string) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    if (!googleConfigurado()) return;
    let alive = true;
    loadGoogleIdentityScript()
      .then(() => {
        if (!alive || !window.google?.accounts?.id || !holder.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => void cb.current(response.credential),
        });
        window.google.accounts.id.renderButton(holder.current, { ...GOOGLE_BUTTON_OPTIONS, width: 320 });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!googleConfigurado()) return null;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        ref={holder}
        aria-busy={busy}
        className={cn("flex w-full justify-center overflow-hidden", (busy || disabled || failed) && "pointer-events-none opacity-60")}
      />
      {failed && <p className="text-[12px] text-danger">Não foi possível carregar o login do Google agora.</p>}
      {busy && <p className="text-[12px] text-fg-3">Entrando…</p>}
    </div>
  );
}

