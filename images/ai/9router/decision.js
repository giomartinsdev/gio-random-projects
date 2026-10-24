// decision.js — provider "decision": rota local de DECISÃO (System One) dentro
// do 9router. Espelha o `systemoneConfig` do provider `v1m`/`cf`, mas aponta pro
// servidor self-hosted do stack `ai` (container `decision`, rede `apps`).
//
// O 9router expõe POST /v1/systemone e o handler (open-sse/handlers/
// systemoneCore.js) monta a URL assim: creds.providerSpecificData.baseUrl ||
// cfg.baseUrl. Como declaramos authType "none"/noAuth, não há connection —
// então a URL vem daqui. O servidor do jev-style serve UM release fixado no
// boot e ignora o campo `model`, então não usamos o placeholder {model}.
//
// Contrato do corpo (não é chat/completions): {state, questions:{id:{type:
// noul|choice|score, instructions, criteria}}} -> {model, answers, usage}.
export default {
  id: "decision",
  priority: 40,
  alias: "decision",
  aliases: ["decide"],
  uiAlias: "decision",
  display: {
    name: "Decision (self-hosted)",
    icon: "psychology",
    color: "#0EA5E9",
    textIcon: "DC",
    website: "https://github.com/lawrence3699/jev-style",
    notice: {
      text: "Decision models self-hosted em CPU no stack ai (Jev-Style, System One API). Nada sai da rede.",
    },
  },
  // "free" (não "freeTier"): é a categoria cujo `noAuth` faz o 9router injetar
  // a connection virtual (auth.js: FREE_PROVIDERS[providerId].noAuth), então o
  // /v1/systemone roteia sem nenhuma credencial cadastrada.
  category: "free",
  authType: "none",
  noAuth: true,
  serviceKinds: ["systemone"],
  // Servidos pelo MESMO endpoint (o release é escolhido no boot do container,
  // via DECISION_RELEASE). Os ids aqui existem pro roteamento por prefixo
  // (`decision/2b`) e pra aparecerem no dashboard.
  models: [
    { id: "2b", name: "Jev-Style 2B (accurate, CPU)", kind: "systemone" },
    { id: "0.8b", name: "Jev-Style 0.8B (fast, CPU)", kind: "systemone" },
  ],
  systemoneConfig: {
    // Endpoint do servidor local (container `decision`, rede `apps`).
    baseUrl: "http://decision:8765/v1/systemone",
    authType: "none",
    authHeader: "none",
  },
};
