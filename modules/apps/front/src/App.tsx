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

export default function App() {
  return (
    <BrowserRouter>
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
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
