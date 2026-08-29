// Class-name joiner for the UI kit. Deliberately minimal (no clsx /
// tailwind-merge): kit components compose from variant/size props
// rather than taking arbitrary override classes, so truthy filtering
// covers everything.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}