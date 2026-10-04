import Home from "@/pages/Home";

// One screen for now. When the read side (spec §4.2) and the dashboard
// land, this gains a router like tela-frontend's; until then a router
// would be ceremony around a single page.
export default function App() {
  return <Home />;
}
