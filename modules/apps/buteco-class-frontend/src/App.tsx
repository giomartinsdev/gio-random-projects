import { Suspense, lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import Layout from "./components/Layout.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import Home from "./pages/Home.js";
import Login from "./pages/Login.js";
import Profile from "./pages/Profile.js";
import PostView from "./pages/PostView.js";
import PostCreate from "./pages/PostCreate.js";
import BookClubHome from "./pages/BookClubHome.js";
import AulasHome from "./pages/AulasHome.js";
import OpenOnSite from "./components/OpenOnSite.js";
import { PageSkeleton } from "./components/ui/index.js";
import { isDiscordActivity } from "./lib/discordActivity.js";

// Only the two live rooms are lazy: they drag react-pdf + pdfjs
// (~1MB) behind them, and pdfjs's worker already ships as its own
// asset. The entry stays lean for the common reading/writing flow.
const BookClubRoom = lazy(() => import("./pages/BookClubRoom.js"));
const AulaRoom = lazy(() => import("./pages/AulaRoom.js"));

// Data router (not <BrowserRouter>) so page-level flow interrupts can
// use useBlocker -- PostCreate's unsaved-draft guard needs it.
//
// Live classes need screen capture and WebRTC, neither of which exists
// inside a Discord Activity's iframe -- see OpenOnSite.tsx. Swapped at
// the route level so the room never mounts there at all (no pointless
// WebSocket, no peer connections that would throw).
const inActivity = isDiscordActivity();

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/login", element: <Login /> },
      {
        path: "/posts/novo",
        element: (
          <ProtectedRoute>
            <PostCreate />
          </ProtectedRoute>
        ),
      },
      {
        path: "/posts/:id/editar",
        element: (
          <ProtectedRoute>
            <PostCreate />
          </ProtectedRoute>
        ),
      },
      { path: "/posts/:slug", element: <PostView /> },
      {
        path: "/perfil",
        element: (
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        ),
      },
      {
        path: "/clube-do-livro",
        element: (
          <ProtectedRoute>
            <BookClubHome />
          </ProtectedRoute>
        ),
      },
      {
        path: "/clube-do-livro/:id",
        element: (
          <ProtectedRoute>
            <Suspense fallback={<PageSkeleton />}>
              <BookClubRoom />
            </Suspense>
          </ProtectedRoute>
        ),
      },
      {
        path: "/aulas",
        element: (
          <ProtectedRoute>
            {inActivity ? <OpenOnSite /> : <AulasHome />}
          </ProtectedRoute>
        ),
      },
      {
        path: "/aulas/:id",
        element: (
          <ProtectedRoute>
            {inActivity ? (
              <OpenOnSite />
            ) : (
              <Suspense fallback={<PageSkeleton />}>
                <AulaRoom />
              </Suspense>
            )}
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
