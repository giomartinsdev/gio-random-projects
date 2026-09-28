// Metadados do documento por rota (título, description, Open Graph).
//
// São DUAS camadas de preview, e as duas importam:
//
//  1. **Crawler que NÃO roda JavaScript** (a maioria dos bots de Discord,
//     WhatsApp, X): quem responde é o endpoint /og/:tipo/:id do clubs-api, para
//     onde o nginx manda esses User-Agents (ver o template do ingress). O SPA
//     nem chega a carregar nesses casos.
//  2. **Navegador de verdade** (aba, histórico, e crawlers que executam JS,
//     como o Google): aí é o SPA que roda, e ele precisa escrever título e
//     metadados de acordo com a página -- senão TODA página do hub se chama "FC
//     Clubs Hub" na aba e no histórico, e o link compartilhado a partir de um
//     navegador sai sem contexto.
//
// Este módulo é a camada 2. Ele é declarativo: a página diz QUAL é o título e a
// descrição, e o hook cuida de aplicar e LIMPAR (uma página sem metadado não
// pode herdar o da anterior).

import { useEffect } from "react";

export interface DocumentMeta {
  title: string;
  description?: string;
  /** Caminho canônico da página; vira og:url absoluto a partir da origem. */
  path?: string;
  /** Imagem absoluta ou relativa do cartão. */
  image?: string;
}

const SUFIXO = "FC Clubs Hub";

/** Escreve (ou atualiza) uma <meta property=... content=...> no <head>. */
function setMeta(attr: "property" | "name", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: "property" | "name", key: string): void {
  document.head.querySelector(`meta[${attr}="${key}"]`)?.remove();
}

/**
 * Aplica título e metadados da página atual enquanto ela está montada, e os
 * limpa ao desmontar. `path` é relativo (`/club/1001`); a URL absoluta é montada
 * com `location.origin`, que é a mesma origem pública em que o SPA roda.
 *
 * Um `title` vazio limpa o metadado em vez de escrever vazio -- uma tag com
 * conteúdo vazio faz alguns scrapers desistirem do cartão inteiro.
 */
export function useDocumentMeta(meta: DocumentMeta): void {
  const { title, description, path, image } = meta;

  useEffect(() => {
    const titulo = title ? (title.includes(SUFIXO) ? title : `${title} — ${SUFIXO}`) : SUFIXO;
    document.title = titulo;

    const url = path ? `${window.location.origin}${path}` : undefined;

    if (description) {
      setMeta("name", "description", description);
      setMeta("property", "og:description", description);
      setMeta("name", "twitter:description", description);
    } else {
      removeMeta("name", "description");
      removeMeta("property", "og:description");
      removeMeta("name", "twitter:description");
    }

    setMeta("property", "og:title", titulo);
    setMeta("name", "twitter:title", titulo);
    if (url) setMeta("property", "og:url", url);
    else removeMeta("property", "og:url");
    if (image) {
      setMeta("property", "og:image", image);
      setMeta("name", "twitter:image", image);
    } else {
      removeMeta("property", "og:image");
      removeMeta("name", "twitter:image");
    }
    setMeta("property", "og:site_name", SUFIXO);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:card", "summary");

    // A limpeza devolve o documento ao estado neutro: sem isso, navegar de um
    // clube para a home deixaria o título e o og:url do clube anterior.
    return () => {
      document.title = SUFIXO;
    };
  }, [title, description, path, image]);
}

/**
 * Versão em componente do `useDocumentMeta`, para declarar os metadados de uma
 * página direto no JSX:
 *
 *   <DocumentMeta title={club.name} path={`/club/${club.club_id}`} />
 *
 * Mesma função, mesma limpeza -- só evita um hook a mais em cada página.
 */
export function DocumentMeta(props: DocumentMeta) {
  useDocumentMeta(props);
  return null;
}
