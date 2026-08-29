// Which rail item should read as "active". Explicit matchers instead
// of NavLink, because the obvious first-match rule is wrong twice on
// this router: /posts/:slug is a READING page (Início), while
// /posts/novo and /posts/:id/editar are WRITING pages (Escrever).
export type NavDestination = {
  label: string;
  to: string;
  isActive: (pathname: string) => boolean;
};

function isPostReadPath(pathname: string): boolean {
  if (!pathname.startsWith("/posts")) return false;
  return pathname !== "/posts/novo" && !pathname.endsWith("/editar");
}

function isPostWritePath(pathname: string): boolean {
  return pathname === "/posts/novo" || pathname.endsWith("/editar");
}

export const NAV: NavDestination[] = [
  { label: "Início", to: "/", isActive: (p) => p === "/" || isPostReadPath(p) },
  { label: "Clube do Livro", to: "/clube-do-livro", isActive: (p) => p === "/clube-do-livro" || p.startsWith("/clube-do-livro/") },
  { label: "Aulas", to: "/aulas", isActive: (p) => p === "/aulas" || p.startsWith("/aulas/") },
  { label: "Escrever", to: "/posts/novo", isActive: isPostWritePath },
];