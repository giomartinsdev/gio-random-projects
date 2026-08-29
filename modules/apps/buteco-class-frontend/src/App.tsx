import { createBrowserRouter, RouterProvider } from "react-router";
import Layout from "./components/Layout.js";
import ProtectedRoute from "./components/ProtectedRoute.js";
import Home from "./pages/Home.js";
import Login from "./pages/Login.js";
import Profile from "./pages/Profile.js";
import PostView from "./pages/PostView.js";
import PostCreate from "./pages/PostCreate.js";
import BookClubHome from "./pages/BookClubHome.js";
import BookClubRoom from "./pages/BookClubRoom.js";
import AulasHome from "./pages/AulasHome.js";
import AulaRoom from "./pages/AulaRoom.js";
import OpenOnSite from "./components/OpenOnSite.js";
import { isDiscordActivity } from "./lib/discordActivity.js";

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
            <BookClubRoom />
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
            {inActivity ? <OpenOnSite /> : <AulaRoom />}
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
