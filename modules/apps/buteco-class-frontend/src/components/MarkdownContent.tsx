import { useState, type ImgHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink, Music2, Youtube } from "lucide-react";
import { resolveImageUrl } from "../lib/discordActivity.js";
import CodeBlock from "./ui/CodeBlock.js";

function hostnameOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function youtubeIdOf(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") return url.pathname.slice(1) || null;
  if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] ?? null;
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] ?? null;
  }
  return null;
}

function isSpotifyLink(href: string): boolean {
  return hostnameOf(href) === "open.spotify.com";
}

function LinkChip({
  href,
  label,
  children,
  icon,
  colorClass,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  colorClass: string;
}) {
  return (
    <span className="not-prose block my-4">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-3 glass-card p-3 no-underline hover:bg-white/10 hover:border-buteco-amber/30 transition-all"
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[0.65rem] uppercase tracking-wide text-buteco-cream/50">
            {label}
          </span>
          <span className="block truncate font-heading text-buteco-cream group-hover:text-buteco-amber transition-colors">
            {children}
          </span>
        </span>
        <ExternalLink size={14} className="shrink-0 text-buteco-cream/30 group-hover:text-buteco-amber transition-colors" />
      </a>
    </span>
  );
}

// An inline markdown image is whatever external host the author
// pasted (unreachable from a Discord Activity's iframe without
// post-api's /image-proxy). If even the proxy can't serve it, render
// nothing -- no broken-image glyph breaking up the text.
function MarkdownImage({ src, ...props }: { src?: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const [broken, setBroken] = useState(false);
  if (broken || src === undefined) return null;
  return (
    <img
      src={typeof src === "string" ? resolveImageUrl(src) : src}
      loading="lazy"
      {...props}
      onError={() => setBroken(true)}
    />
  );
}

const components: Components = {
  img({ src, ...props }) {
    return <MarkdownImage src={src} {...props} />;
  },
  pre: CodeBlock,
  a({ href, children, ...props }) {
    if (!href) return <a {...props}>{children}</a>;

    if (youtubeIdOf(href)) {
      return (
        <LinkChip href={href} label="YouTube" icon={<Youtube size={18} />} colorClass="bg-buteco-amber/15 text-buteco-amber">
          {children}
        </LinkChip>
      );
    }

    if (isSpotifyLink(href)) {
      return (
        <LinkChip href={href} label="Spotify" icon={<Music2 size={18} />} colorClass="bg-white/10 text-buteco-cream/80">
          {children}
        </LinkChip>
      );
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-buteco-amber hover:text-buteco-amber-light underline decoration-buteco-amber/30 underline-offset-2 transition-colors"
        {...props}
      >
        {children}
        <ExternalLink size={14} className="opacity-60" />
      </a>
    );
  },
};

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none font-body text-buteco-cream/90 prose-headings:font-heading prose-code:font-mono prose-img:rounded-xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
