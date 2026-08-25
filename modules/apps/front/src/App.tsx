import { BrowserRouter, Routes, Route } from "react-router";
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
import SharePopup from "./pages/SharePopup.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* No Layout, no auth -- a bare window.open() popup that only
            needs to run getDisplayMedia/getUserMedia and hand the
            stream back to window.opener. See SharePopup.tsx. */}
        <Route path="/share-popup" element={<SharePopup />} />
        <Route
          path="*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/posts/novo" element={<ProtectedRoute><PostCreate /></ProtectedRoute>} />
                <Route path="/posts/:id/editar" element={<ProtectedRoute><PostCreate /></ProtectedRoute>} />
                <Route path="/posts/:slug" element={<PostView />} />
                <Route path="/perfil" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                <Route path="/clube-do-livro" element={<ProtectedRoute><BookClubHome /></ProtectedRoute>} />
                <Route path="/clube-do-livro/:id" element={<ProtectedRoute><BookClubRoom /></ProtectedRoute>} />
                <Route path="/aulas" element={<ProtectedRoute><AulasHome /></ProtectedRoute>} />
                <Route path="/aulas/:id" element={<ProtectedRoute><AulaRoom /></ProtectedRoute>} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
