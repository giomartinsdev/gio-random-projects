// Renderização de markdown do contexto/próximos passos (FR-011):
// react-markdown produz elementos React — não existe
// dangerouslySetInnerHTML em lugar nenhum, então texto cru (ex.
// <script>alert(1)</script>) vira texto, nunca HTML executado (quickstart
// §6). Links externos abrem em nova aba sem acesso ao opener.
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

// target/rel só em links externos (http/https): referências a
// /sessoes/42 dentro do markdown abrem na mesma aba, como navegação
// comum. javascript: e afins já são descartados pelo react-markdown
// (urlTransform padrão) — não chegam a virar <a>.
const COMPONENTES: Components = {
  a: ({ children, href }) => {
    const externo = /^(https?:)?\/\//i.test(href ?? "");
    return externo ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <a href={href}>{children}</a>
    );
  },
};

export function MarkdownView({ texto }: { texto: string }) {
  return (
    <div className="prose-md">
      <ReactMarkdown components={COMPONENTES}>{texto}</ReactMarkdown>
    </div>
  );
}