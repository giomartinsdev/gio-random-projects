import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveImageUrl } from "../lib/discordActivity.js";

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

const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const MusicNoteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="16" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const ExternalLinkIcon = ({ className = "" }: { className?: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

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
        <ExternalLinkIcon className="shrink-0 text-buteco-cream/30 group-hover:text-buteco-amber transition-colors" />
      </a>
    </span>
  );
}

const components: Components = {
  // Same reasoning as PostCard/PostView's cover image -- an inline
  // markdown image is whatever external host the author pasted,
  // unreachable from inside a Discord Activity's iframe sandbox
  // without going through post-api's /image-proxy first.
  img({ src, ...props }) {
    return <img src={typeof src === "string" ? resolveImageUrl(src) : src} {...props} />;
  },
  a({ href, children, ...props }) {
    if (!href) return <a {...props}>{children}</a>;

    if (youtubeIdOf(href)) {
      return (
        <LinkChip href={href} label="YouTube" icon={<PlayIcon />} colorClass="bg-red-500/15 text-red-400">
          {children}
        </LinkChip>
      );
    }

    if (isSpotifyLink(href)) {
      return (
        <LinkChip href={href} label="Spotify" icon={<MusicNoteIcon />} colorClass="bg-green-500/15 text-green-400">
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
        <ExternalLinkIcon className="opacity-60" />
      </a>
    );
  },
};

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-amber max-w-none font-body text-buteco-cream/90 prose-headings:font-heading prose-a:no-underline prose-code:font-mono prose-img:rounded-xl">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
