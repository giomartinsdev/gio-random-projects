import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export type PageWidth = "prose" | "content" | "wide" | "full";

const widths: Record<PageWidth, string> = {
  // Reading width for article bodies (~72ch -- the .prose sweet spot).
  prose: "max-w-[46rem]",
  content: "max-w-3xl",
  wide: "max-w-5xl",
  full: "max-w-none",
};

// Per-page horizontal rhythm. The router's <main> sets NO width or
// padding of its own (rooms need the full row); every page opts into
// its width here instead.
export function PageShell({ width = "content", className, children }: { width?: PageWidth; className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 py-8 sm:py-10", widths[width], className)}>{children}</div>
  );
}

export default PageShell;