import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Props = {
  glow?: boolean;
  className?: string;
  children: ReactNode;
};

// The app's one surface type. padded=false for callers that bleed
// content (cover images) past the border.
export function Card({ glow = false, className, children }: Props) {
  return <div className={cn("glass-card shadow-card", glow && "shadow-glow", className)}>{children}</div>;
}

// Header p-5, Body rest, Footer strip -- compose inside <Card>.
function Section({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Section className={cn("p-5 sm:p-6 border-b border-white/5", className)}>{children}</Section>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <Section className={cn("p-5 sm:p-6", className)}>{children}</Section>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <Section className={cn("p-5 sm:p-6 border-t border-white/5", className)}>{children}</Section>;
}

export default Card;