import UseAnimations from "react-useanimations";
import type { Animation } from "react-useanimations/utils";

// Thin wrapper matching how lucide-react icons are used across this
// app (a pixel size instead of a Tailwind size-N class, currentColor
// by default so wrapping something in text-muted-foreground etc.
// still works) around react-useanimations -- these render through
// lottie-web under the hood, so this IS a real Lottie animation, not a
// CSS trick pretending to be one. `reverse` flips a two-state icon
// (mic on/off, volume on/off, plus-to-x) between its two endpoints;
// `autoplay`+`loop` is for a self-running one like a spinner.
export function AnimatedIcon({
  animation,
  size = 16,
  reverse,
  loop,
  autoplay,
  speed,
  className,
  onClick,
}: {
  animation: Animation;
  size?: number;
  reverse?: boolean;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <UseAnimations
      animation={animation}
      size={size}
      reverse={reverse}
      loop={loop}
      autoplay={autoplay}
      speed={speed}
      strokeColor="currentColor"
      fillColor="currentColor"
      className={className}
      onClick={onClick}
      wrapperStyle={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
    />
  );
}
