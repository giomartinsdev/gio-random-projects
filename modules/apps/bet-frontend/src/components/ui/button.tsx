import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// A thick flat "shadow" riding under each solid variant (color-mix
// darkens it -- no extra token per color) that the button sinks into on
// press, like a big arcade button. Copied from cch-frontend.
const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-display font-semibold tracking-wide transition-[transform,box-shadow,filter] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-[3px]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_4px_0_0_color-mix(in_srgb,hsl(var(--primary))_65%,black)] hover:brightness-110 active:shadow-[0_1px_0_0_color-mix(in_srgb,hsl(var(--primary))_65%,black)]",
        success:
          "bg-accent2 text-accent2-foreground shadow-[0_4px_0_0_color-mix(in_srgb,hsl(var(--accent2))_65%,black)] hover:brightness-110 active:shadow-[0_1px_0_0_color-mix(in_srgb,hsl(var(--accent2))_65%,black)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_4px_0_0_color-mix(in_srgb,hsl(var(--destructive))_65%,black)] hover:brightness-110 active:shadow-[0_1px_0_0_color-mix(in_srgb,hsl(var(--destructive))_65%,black)]",
        outline:
          "border-2 border-border bg-transparent hover:bg-accent hover:text-accent-foreground active:translate-y-0",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[0_4px_0_0_color-mix(in_srgb,hsl(var(--secondary))_55%,black)] hover:brightness-110 active:shadow-[0_1px_0_0_color-mix(in_srgb,hsl(var(--secondary))_55%,black)]",
        ghost: "hover:bg-accent hover:text-accent-foreground active:translate-y-0",
        link: "text-primary underline-offset-4 hover:underline active:translate-y-0 font-sans font-medium tracking-normal",
      },
      size: {
        default: "h-12 px-5 py-2 text-[15px] sm:h-11",
        sm: "h-10 rounded-xl px-3.5 text-sm",
        lg: "h-14 rounded-2xl px-8 text-lg",
        icon: "h-11 w-11 rounded-xl",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };