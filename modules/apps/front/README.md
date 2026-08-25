# front

React SPA for the Sala de aula do Buteco blog — login, home feed of recent
posts, a profile page, reading/writing individual posts, and the Clube
do Livro realtime PDF rooms. Talks directly to `post-api` and
`bookclub-api` from the browser (no server-side rendering, no
backend-for-frontend of its own).

Visual language borrowed from [Funnie-Tech/website-butecodosdev](https://github.com/Funnie-Tech/website-butecodosdev)
(the actual Buteco dos Devs landing page): the `buteco` Tailwind color
palette (brown/amber/cream/navy) and the Space Grotesk + Inter +
JetBrains Mono font stack. No shared code with that repo — just the
same design tokens, reproduced here.

- **Auth**: Better Auth's React client (`better-auth/react`), cookie-based session (`credentials: "include"` on every fetch). post-api's `bearer` plugin exists for non-browser clients (a future Discord bot); this app doesn't need to manage tokens itself.
- **Routing**: `react-router` v7. `/` (home), `/login`, `/posts/:slug` (read), `/posts/novo` (create, protected), `/posts/:id/editar` (edit, protected), `/perfil` (profile, protected).
- **Markdown**: `react-markdown` renders `bodyMarkdown` on the post page; the create/edit form is a plain markdown textarea (no WYSIWYG).
- **Clube do Livro** (`/clube-do-livro`, `/clube-do-livro/:id`, both protected): upload a PDF and open a room (`react-pdf`/`pdfjs` renders pages), then a raw `WebSocket` (`lib/useRoomSocket.ts`) drives everyone's live page position, the host's pointer/pen strokes on a `<canvas>` overlay, and chat -- see `bookclub-api`'s own README for the realtime protocol.

## Known gap

Profile only lists **published** posts. `post-api`'s `GET /posts` (and
by extension this app) has no "list my drafts too" endpoint yet —
domain-api would need one. Saving a draft still works (`PATCH`/`POST`
with `status: "draft"`), it just won't show up anywhere in the UI to
resume editing later.

## Running locally

```
cp .env.example .env.local   # points at the real post-api by default
npm install
npm run dev
```

## Deploying

Static build (`vite build`) served by nginx — see `Dockerfile`.
`VITE_POST_API_URL`/`VITE_BOOKCLUB_API_URL`/`VITE_CLASSROOM_API_URL` are baked in at **build**
time (Vite convention), not read at container runtime — see
`ts-ci-cd.yml`'s `build-args` for where those are set for production
builds.
