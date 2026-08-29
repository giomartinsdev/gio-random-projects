# front

React SPA for the Sala de aula do Buteco blog — login, home feed of recent
posts, a profile page, reading/writing individual posts, live classes
(screen/camera sharing with a shared notepad and chat), and realtime PDF
reading rooms. Talks directly to `post-api`, `bookclub-api` and
`classroom-api` from the browser (no server-side rendering, no
backend-for-frontend of its own).

Visual language borrowed from [Funnie-Tech/website-butecodosdev](https://github.com/Funnie-Tech/website-butecodosdev)
(the actual Buteco dos Devs landing page): the `buteco` Tailwind color
palette (brown/amber/cream/navy) and the Space Grotesk + Inter +
JetBrains Mono font stack. No shared code with that repo — just the
same design tokens, reproduced here.

## App shell

- **`components/Sidebar.tsx`** — the always-visible 72px icon rail
  (desktop) plus its expanded overlay sheet and the mobile/Activity
  drawer. `lib/nav.ts` owns the destination list and each item's
  `isActive` matcher (a post page lights "Início", the editor lights
  "Escrever"); `lib/useRailState.ts` persists the rail state.
- **`components/Layout.tsx`** — router `<Outlet>` shell: `main#conteudo`
  (no width/padding of its own), skip link, fixed BinaryRain backdrop,
  `lg:pl-[72px]` reservation while the rail is visible.
- **`components/ui/`** — the hand-rolled kit everything else renders
  with (`Button`/`IconButton`, `Input`/`Textarea`/`Field`, `Card`,
  `Badge`, `Banner`, `EmptyState`/`ErrorState`, `Skeleton`/`Spinner`,
  `ConfirmDialog`, `PageShell`, `PageSkeleton`, `CodeBlock`). There's
  no UI library on purpose; radius convention: controls `rounded-lg`,
  buttons/inputs `rounded-xl`, cards/panels `rounded-2xl`.
- **`components/editor/MarkdownEditor.tsx`** — controlled markdown
  textarea, formatting toolbar inserting via `setRangeText`, mod+b/i/k
  shortcuts, desktop split editor/preview, mobile write/preview tabs.
- **`components/room/`** — dumb furniture shared by the two live-room
  pages (`RoomShell`, `RoomHeader`, `RoomStatusBadge`,
  `ParticipantsStrip`, `ChatPanel`, `NotepadPanel`, `PanelTabs`,
  `RtcErrorBanner`). Protocol knowledge (sockets, WebRTC, commands)
  stays strictly in the pages.

### Routes

`/` (home), `/login` (Discord first, email/senha collapsed below),
`/posts/:slug` (read), `/posts/novo` and `/posts/:id/editar` (editor,
protected — the create form has an "Importar de um link" section that
pulls a public Medium/dev.to/TabNews article into the editor for
review; the server appends the "Retirado daqui do …" attribution
footer to the body itself),
`/perfil` (own, protected) and `/perfil/:id` (public —
anyone, even anonymous, can see a person's posts; own vs. other is
decided per id) — the profile page has Posts \| Curtidas \| Aulas
tabs (Curtidas only on your own profile; Aulas lists the rooms that
person hosted), `/clube-do-livro` + `/clube-do-livro/:id` (protected
PDF rooms, lazily loaded), `/aulas` + `/aulas/:id` (protected live
classes, lazily loaded — inside a Discord Activity both swap to
`components/OpenOnSite.tsx`).

### localStorage keys

| key | what |
| --- | --- |
| `buteco.ui.rail` | sidebar state: `collapsed` \| `expanded` \| `hidden` |
| `buteco.draft.post.new` | autosaved draft of a new post (`usePostDraftAutosave`) |
| `buteco.draft.post.<postId>` | autosaved draft of an edited post |

List pages render `Skeleton`s while loading and surface failures with
`ErrorState`/`Banner`; there is no toast layer by design.

- **Auth**: Better Auth's React client (`better-auth/react`), cookie-based session (`credentials: "include"` on every fetch). post-api's `bearer` plugin exists for non-browser clients (a future Discord bot); this app doesn't need to manage tokens itself.
- **Routing**: `react-router` v7 (`createBrowserRouter` — the data router, so the editor's unsaved-changes guard can use `useBlocker`).
- **Markdown**: `react-markdown` renders `bodyMarkdown` with `remark-gfm`, `rehype-highlight` (theme in `index.css`'s `.hljs-*` tokens) and the `CodeBlock` pre replacement (language chip + copy). YouTube/Spotify bare links are upgraded to chips by `MarkdownContent`.
- **Clube do Livro** (`/clube-do-livro`, `/clube-do-livro/:id`, both protected): upload a PDF and open a room (`react-pdf`/`pdfjs` renders pages), then a raw `WebSocket` (`lib/useRoomSocket.ts`) drives everyone's live page position, the host's pointer/pen strokes on a `<canvas>` overlay, floating text annotations, and chat -- see `bookclub-api`'s own README for the realtime protocol. Host-only page turns also bind ←/→.
- **Aulas ao vivo** (`/aulas`, `/aulas/:id`, both protected): classroom over `lib/useClassSocket.ts` + `lib/useWebRTCBroadcast.ts` — host shares screen or camera, everyone gets chat and a shared notepad (20k chars, wiped by the server when the room empties — the UI says so). Mic/camera toggles only flip `track.enabled` on the local stream.
- **Discord Activity**: `lib/discordActivity.ts` detects embedding and swaps `/aulas*` to `OpenOnSite`; requests go out with a module-scoped bearer token (`discordAuthToken.ts`), images walk `resolveImageUrl`'s proxy, and the rail is forced compact with no "Sair".

## Known gap

Drafts used to be invisible outside the editor — `GET /posts` only
ever returned published ones. Now `GET /posts/by-author/:id` returns
the author's drafts **to the author's own session** (PostCard flags
them with the Rascunho badge; everyone else gets published-only), so
the profile's Posts tab shows everything and the old client-side
author filter is gone. domain-api likewise gained `?q=` substring
search, which powers the home page's search box.

Engagement edges worth knowing: the profile view counter only counts
**logged-in distinct visitors** (anonymous visits are deliberately not
tracked — no fingerprinting — and the badge says so via tooltip);
viewing your own profile never counts. Likes are idempotent and
optimistic in the UI (reverts on server error); the "who liked this"
list doesn't exist, only the count. Posts are filterable by author on
the client only — domain-api has no by-author list endpoint.

## Running locally

```
cp .env.example .env.local   # points at the real post-api by default
npm install
npm run dev
```

## Deploying

Static build (`vite build`, `target: es2022`) mirrored straight into a
MinIO bucket — not a container at all, see
`modules/infra/terraform/static_sites.tf` and
`compute/services/ingress`'s README for how that's served.
`VITE_POST_API_URL`/`VITE_BOOKCLUB_API_URL`/`VITE_CLASSROOM_API_URL` are baked in at **build**
time (Vite convention) via real environment variables, not container
env — see `ts-frontend-ci-cd.yml` for where those are set for production
builds.