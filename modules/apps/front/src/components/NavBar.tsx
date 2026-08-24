import { Link, useNavigate } from "react-router";
import { signOut, useSession } from "../lib/authClient.js";

export default function NavBar() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-10 bg-buteco-brown-dark/95 backdrop-blur border-b border-buteco-amber/20">
      <nav className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="font-heading font-bold text-xl text-buteco-amber">
          Buteco dos Devs
        </Link>
        <div className="flex items-center gap-4 font-body text-sm">
          <Link to="/" className="text-buteco-cream/80 hover:text-buteco-amber transition-colors">
            Início
          </Link>
          {session ? (
            <>
              <Link to="/posts/novo" className="text-buteco-cream/80 hover:text-buteco-amber transition-colors">
                Escrever
              </Link>
              <Link to="/perfil" className="text-buteco-cream/80 hover:text-buteco-amber transition-colors">
                {session.user.name}
              </Link>
              <button
                onClick={async () => {
                  await signOut();
                  navigate("/login");
                }}
                className="text-buteco-cream/50 hover:text-buteco-amber transition-colors cursor-pointer"
              >
                Sair
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="px-4 py-2 rounded-lg bg-buteco-amber text-buteco-navy font-semibold hover:bg-buteco-amber-light transition-colors"
            >
              Entrar
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
