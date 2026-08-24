import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { signOut, useSession } from "../lib/authClient.js";

export default function NavBar() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-20 animate-fade-in-down transition-all duration-300 ${
        // No backdrop-blur: it sits above the animated BinaryRain
        // background and Chrome shows seam/tear artifacts on blurred
        // layers stacked over continuously-changing content. A
        // near-opaque fill gives the same "always readable" nav bar.
        scrolled
          ? "bg-buteco-brown-dark/95 shadow-lg shadow-black/20 border-b border-buteco-amber/10"
          : "bg-buteco-brown-dark/80 border-b border-transparent"
      }`}
    >
      <nav className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 font-heading font-bold text-xl text-buteco-amber">
          <span aria-hidden="true">🍺</span>
          Sala de aula do Buteco
        </Link>
        <div className="flex items-center gap-5 font-heading text-sm font-medium">
          <Link to="/" className="text-buteco-cream/70 hover:text-buteco-amber transition-colors">
            Início
          </Link>
          {session ? (
            <>
              <Link to="/posts/novo" className="text-buteco-cream/70 hover:text-buteco-amber transition-colors">
                Escrever
              </Link>
              <Link
                to="/perfil"
                className="text-buteco-cream/70 hover:text-buteco-amber transition-colors max-w-[10rem] truncate"
              >
                {session.user.name}
              </Link>
              <button
                onClick={async () => {
                  await signOut();
                  navigate("/login");
                }}
                className="text-buteco-cream/40 hover:text-buteco-amber transition-colors cursor-pointer"
              >
                Sair
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="bg-buteco-amber text-buteco-navy px-5 py-2 rounded-lg font-semibold hover:bg-buteco-amber-light hover:scale-105 transition-all shadow-lg shadow-buteco-amber/20"
            >
              Entrar
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
