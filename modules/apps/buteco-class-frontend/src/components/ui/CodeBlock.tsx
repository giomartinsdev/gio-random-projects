import { isValidElement, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

// <pre> replacement for markdown. The lowlight classes (index.css's
// .hljs tokens) color the code; this adds the chrome that makes a
// block feel native: language chip, copy affordance, horizontal
// scroll. `not-prose` keeps the typography plugin's pre styles out.
export default function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const child =
    isValidElement<{ className?: string }>(children) ? children.props : undefined;
  const lang = /language-([\w-]+)/.exec(child?.className ?? "")?.[1];

  async function copy() {
    if (!preRef.current) return;
    try {
      // innerText (not textContent): rehype-highlight splits code into
      // many spans and textContent would hand back the same strings --
      // but innerText is what the user visually selects/copies.
      await navigator.clipboard.writeText(preRef.current.innerText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be denied (permissions policy in an iframe
      // embed); a dead copy button beats a thrown page.
    }
  }

  return (
    <div className="not-prose my-5 glass-card overflow-hidden">
      <div className="flex items-center justify-between pl-4 pr-2.5 py-1.5 border-b border-white/5 bg-black/15">
        <span className="font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/50">{lang ?? "código"}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[0.7rem] font-mono text-buteco-cream/60 hover:text-buteco-amber hover:bg-white/5 transition-colors cursor-pointer"
        >
          {copied ? <Check size={13} className="text-buteco-amber" /> : <Copy size={13} />}
          {copied ? "copiado" : "copiar"}
        </button>
      </div>
      <pre ref={preRef} className="overflow-x-auto p-4 bg-black/20 text-[0.85rem] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}