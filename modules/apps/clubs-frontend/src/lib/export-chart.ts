// Exportar um gráfico SVG como PNG baixável.
//
// Por que existe: o histórico é o diferencial do hub -- a fonte não o tem. Um
// PNG do gráfico é o que a pessoa cola no Discord do clube. Sem isto, o que
// diferencia o produto fica preso na tela e não circula.
//
// Os gráficos já são SVG puro (ver components/charts.tsx), então não há
// biblioteca: serializa o SVG, desenha num canvas e exporta. O SVG é embutido
// como data-URL, então não há dependência de rede nem CORS.

/** Serializa o SVG de um elemento e devolve um data-URL pronto para o canvas.
 * Clona o nó para injetar o fundo sem sujar o DOM (o tema claro/escuro é do
 * app; o PNG precisa carregar o fundo, senão sai com transparência preta em
 * alguns visualizadores). */
function svgToDataUrl(svg: SVGSVGElement, bg: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const w = svg.viewBox.baseVal.width || svg.clientWidth || 720;
  const h = svg.viewBox.baseVal.height || svg.clientHeight || 240;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  // Um <rect> de fundo, primeiro filho -- fica atrás de tudo.
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("fill", bg);
  clone.insertBefore(rect, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  // btoa não lida com caracteres não-ASCII (nomes de clube têm acento);
  // encodeURIComponent resolve sem corromper o SVG.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

/**
 * Baixa o SVG da `ref` como PNG. A escala 2x mantém o texto nítido em telas
 * retina e em preview de link.
 *
 * Devolve uma Promise que resolve quando o download foi disparado; rejeita se
 * o elemento não tiver SVG dentro (um clique cedo demais, antes do gráfico
 * montar).
 */
export async function exportSvgAsPng(
  container: HTMLElement | null,
  filename: string,
  opts: { background?: string; scale?: number } = {},
): Promise<void> {
  const svg = container?.querySelector("svg");
  if (!svg) throw new Error("nenhum gráfico para exportar");

  const bg = opts.background ?? "#0b0d0f";
  const scale = opts.scale ?? 2;
  const w = svg.viewBox.baseVal.width || svg.clientWidth || 720;
  const h = svg.viewBox.baseVal.height || svg.clientHeight || 240;

  const img = new Image();
  img.src = svgToDataUrl(svg as SVGSVGElement, bg);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("falha ao rasterizar o SVG"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas indisponível");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("falha ao gerar o PNG");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique para o download não ser cancelado.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
