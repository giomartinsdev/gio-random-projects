// Hand-authored icon sprite, hidden and referenced everywhere else via
// <svg class="icon"><use href="#icon-name"/></svg> — one definition per
// icon, no icon-font/library dependency.
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol
          id="icon-bus"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3.5" y="5" width="17" height="12" rx="3" />
          <path d="M3.5 11.5h17" />
          <path d="M7 17v1.6M17 17v1.6" />
          <circle cx="7.5" cy="19" r="1.3" />
          <circle cx="16.5" cy="19" r="1.3" />
        </symbol>
        <symbol
          id="icon-crosshair"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="6.5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </symbol>
        <symbol id="icon-pin" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.2c-3.9 0-7 3.1-7 6.9 0 5 6.2 11.7 6.5 12a0.7 0.7 0 0 0 1 0c.3-.3 6.5-7 6.5-12 0-3.8-3.1-6.9-7-6.9z" />
          <circle cx="12" cy="9" r="2.4" style={{ fill: "var(--surface)" }} />
        </symbol>
        <symbol
          id="icon-walk"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="13.5" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M11 8l2-1.4 3 1 1.6 3.4" />
          <path d="M13 7l-1.2 4.4L8.5 14l-1 4" />
          <path d="M13 11.4l2.2 1.6-.6 4" />
          <path d="M11.8 11.4L15 12" />
        </symbol>
        <symbol
          id="icon-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h13M13 6l6 6-6 6" />
        </symbol>
        <symbol
          id="icon-flag"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3v18" />
          <path d="M6 4h11l-2.5 3.5L17 11H6" />
        </symbol>
        <symbol
          id="icon-train"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="3.5" width="14" height="13" rx="4" />
          <path d="M5 11.5h14" />
          <path d="M9 16.5l-2 3.5M15 16.5l2 3.5" />
          <circle cx="9" cy="14" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="15" cy="14" r="0.9" fill="currentColor" stroke="none" />
        </symbol>
        <symbol
          id="icon-x"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </symbol>
      </defs>
    </svg>
  );
}
