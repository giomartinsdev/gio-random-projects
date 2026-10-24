import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-sm border border-line bg-bg px-3.5 py-2.5 text-[14px] text-fg placeholder:text-fg-3 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-60";

export function Input({
  icon,
  className,
  wrapClassName,
  id,
  ...props
}: { icon?: ReactNode; wrapClassName?: string } & InputHTMLAttributes<HTMLInputElement>) {
  // O `Field` já associa o controle pelo `<label>`; o id automático existe para
  // leitores de tela e para o navegador não reclamar de campo sem nome.
  const autoId = useId();
  if (icon) {
    return (
      <div className={cn("relative flex items-center", wrapClassName)}>
        <span className="pointer-events-none absolute left-3.5 text-fg-3">{icon}</span>
        <input id={id ?? autoId} className={cn(FIELD, "pl-10", className)} {...props} />
      </div>
    );
  }
  return <input id={id ?? autoId} className={cn(FIELD, className)} {...props} />;
}

export function Textarea({ className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  return (
    <textarea id={id ?? autoId} className={cn(FIELD, "min-h-[120px] resize-y leading-relaxed", className)} {...props} />
  );
}

/** Select nativo com a mesma pele dos inputs (sem dependência de Radix). */
export function Select({
  className,
  children,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  return (
    <div className="relative">
      <select id={id ?? autoId} className={cn(FIELD, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
    </div>
  );
}

/** Campo com rótulo + dica/erro, como o AuthField do prospecta. */
export function Field({
  label,
  hint,
  error,
  right,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex w-full flex-col gap-1.5", className)}>
      {(label || right) && (
        <span className="flex items-center justify-between gap-2">
          {label && <span className="text-[13px] text-fg-2">{label}</span>}
          {right}
        </span>
      )}
      {children}
      {error ? (
        <span className="text-[12px] text-danger">{error}</span>
      ) : (
        hint && <span className="text-[12px] leading-snug text-fg-3">{hint}</span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  desc,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3.5 text-left disabled:opacity-50"
    >
      <span
        className={cn(
          "mt-0.5 flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line bg-bg",
        )}
      >
        <span
          className={cn(
            "h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-fg">{label}</span>
        {desc && <span className="text-[12px] leading-[1.5] text-fg-3">{desc}</span>}
      </span>
    </button>
  );
}

/** Segmento de botões (período, abas compactas). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-sm border border-line bg-bg p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition-colors",
            value === o.value ? "bg-elevated text-fg" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
