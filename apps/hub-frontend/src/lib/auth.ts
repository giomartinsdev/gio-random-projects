// The hub itself is public (its hostname lives in Terraform's
// excluded_hostnames) -- the Google login is opt-in and only gates
// the SHORTCUTS tier. The trick: Terraform also creates a Cloudflare
// Access application scoped to hub.giomartins.dev/sso, a path the
// rest of the site doesn't care about. A request there either passes
// through to this same SPA (HTTP 200 -- there's a valid Google-SSO
// session for this zone) or gets bounced to the Access login page (a
// redirect -- there isn't). Probing that one path is the whole login
// check. Real enforcement stays at the edge either way: every
// shortcut target runs its own Access application, so what this gate
// hides is convenience, not the only copy of the keys.
export const LOGIN_URL = "/sso";

// Logging out has to happen on the Access team domain -- the session
// cookie it issued lives there, not on this origin. That page shows
// its own "logout done" screen with a link back here.
export const LOGOUT_URL =
  "https://workwithgiomartinsdev.cloudflareaccess.com/cdn-cgi/access/logout";

// redirect:"manual" makes Access's login redirect surface as an
// opaque response with status 0; a passed-through request comes back
// 200 (this same index.html). Anything else -- opaque redirect,
// network error -- means "not logged in"; erring that way only hides
// shortcuts, never leaks them.
export async function probeGoogleLogin(): Promise<boolean> {
  try {
    const res = await fetch(LOGIN_URL, { redirect: "manual", cache: "no-store" });
    return res.status === 200;
  } catch {
    return false;
  }
}