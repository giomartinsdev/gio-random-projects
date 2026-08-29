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
    // pt-14 (56px) clears the fixed reopen pill (top-3 + 40px tall =
    // bottom at 52px) that rides along on screens without the rail.
    <div className={cn("mx-auto w-full px-4 sm:px-6 pt-14 pb-8 sm:pt-10 sm:pb-10", widths[width], className)}>{children}</div>
  );
}

export default PageShell;