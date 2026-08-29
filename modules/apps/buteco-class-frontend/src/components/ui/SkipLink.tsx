// Screen-reader / keyboard shortcut to the router content (see
// Layout's <main id="conteudo">). Invisible until focused.
export function SkipLink() {
  return (
    <a
      href="#conteudo"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-buteco-amber focus:text-buteco-navy focus:font-heading focus:font-semibold focus:text-sm"
    >
      Pular para o conteúdo
    </a>
  );
}

export default SkipLink;