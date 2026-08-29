import { cn } from "../../lib/cn.js";

// Loading placeholder: shimmer sweep over a translucent fill. Size it
// via className (h-4 w-40, aspect-video, ...). Rows of these go in a
// role="status" wrapper with an aria-label.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-shimmer rounded-lg", className)} />;
}

export default Skeleton;