import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Template } from "@/lib/types";

/**
 * Prévia de como o template chega no WhatsApp: header (texto/imagem),
 * corpo com as variáveis já substituídas por valores de exemplo, footer e
 * botões. É a peça que faz o operador entender o que ele está aprovando —
 * o mesmo papel do preview do Gerenciador da Meta, mas dentro do produto.
 */
export function WhatsAppPreview({
  template,
  values,
  className,
  time = "09:42",
}: {
  template: Pick<Template, "header" | "body" | "footer" | "buttons" | "variables">;
  /** Override dos exemplos das variáveis (ex.: cupom real do destinatário). */
  values?: Record<string, string>;
  className?: string;
  time?: string;
}) {
  const resolve = (index: string): string => {
    if (values && values[index] != null) return values[index];
    return template.variables.find((v) => v.index === index)?.example ?? `{{${index}}}`;
  };

  const body = template.body.replace(/\{\{(\d+)\}\}/g, (_, i: string) => resolve(i));
  const headerText = template.header.text?.replace(/\{\{(\d+)\}\}/g, (_, i: string) => resolve(i));

  return (
    <div className={cn("w-full max-w-[380px] overflow-hidden rounded-md", className)}>
      {/* Fundo de conversa (o papel de parede do WhatsApp, simplificado). */}
      <div className="flex flex-col gap-2 bg-[#0B141A] p-3">
        <div className="flex justify-center">
          <span className="rounded bg-[#182229] px-2 py-1 text-[10px] text-[#8696A0]">hoje</span>
        </div>

        <div className="flex justify-end">
          <div className="wa-bubble w-[86%] overflow-hidden rounded-lg rounded-tr-none shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
            {template.header.kind === "image" && (
              <div className="flex h-[130px] w-full flex-col items-center justify-center gap-1.5 bg-[#cfd8d0]">
                <span className="text-[11px] font-medium text-[#5b6b60]">imagem</span>
                <span className="font-mono text-[10px] text-[#7b8b80]">
                  {template.header.mediaHint ?? "header.jpg"}
                </span>
              </div>
            )}
            {template.header.kind === "video" && (
              <div className="flex h-[130px] w-full flex-col items-center justify-center gap-1.5 bg-[#cfd8d0]">
                <span className="text-[11px] font-medium text-[#5b6b60]">vídeo</span>
                <span className="font-mono text-[10px] text-[#7b8b80]">{template.header.mediaHint ?? "header.mp4"}</span>
              </div>
            )}
            {template.header.kind === "document" && (
              <div className="flex items-center gap-2 bg-[#d3ddd3] px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded bg-[#8fae8f] text-[10px] font-bold text-white">
                  PDF
                </span>
                <span className="font-mono text-[10px] text-[#4c5c50]">{template.header.mediaHint ?? "doc.pdf"}</span>
              </div>
            )}
            {template.header.kind === "text" && headerText && (
              <div className="px-2.5 pb-0 pt-2 text-[14px] font-semibold leading-snug">{headerText}</div>
            )}

            <div className="whitespace-pre-wrap px-2.5 pb-1 pt-2 text-[14px] leading-[1.4]">
              {body}
            </div>
            {template.footer && (
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-[#667781]">{template.footer}</div>
            )}
            <div className="flex items-center justify-end gap-1 px-2.5 pb-1.5">
              <span className="text-[10px] text-[#667781]">{time}</span>
              <Check size={12} className="text-[#53BDEB]" />
              <Check size={12} className="-ml-2 text-[#53BDEB]" />
            </div>

            {template.buttons.length > 0 && (
              <div className="flex flex-col divide-y divide-[#d7ded7] border-t border-[#d7ded7]">
                {template.buttons.map((b, i) => (
                  <div
                    key={`${b.text}-${i}`}
                    className="flex items-center justify-center gap-1.5 bg-[#f0f5f0] py-2 text-[13px] font-medium text-[#00A884]"
                  >
                    {b.type === "url" ? "↗" : b.type === "phone" ? "☎" : "↩"} {b.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bloco de corpo com as variáveis destacadas — é o "editor" de conteúdo:
 * o texto é read-only (na Meta ele é imutável depois de aprovado), mas as
 * variáveis aparecem como chips para o operador mapear origem do dado.
 */
export function HighlightedBody({ body }: { body: string }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">
      {parts.map((p, i) =>
        /^\{\{\d+\}\}$/.test(p) ? (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center rounded-xs bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent-light"
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}
