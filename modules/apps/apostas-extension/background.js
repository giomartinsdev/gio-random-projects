// Captura de apostas: um clique no ícone da extensão tira um print da
// aba visível e manda pro apostas-api, que lê com IA e registra a
// aposta sozinho -- sem tela de confirmação nenhuma aqui (decisão já
// tomada: um print errado vira uma aposta errada, corrigida depois na
// mão, como qualquer lançamento manual). O único feedback é uma
// notificação nativa do Chrome, sucesso ou falha.

const DEFAULT_API_URL = "https://apostas-api.giomartins.dev";

async function getConfig() {
  const { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  return { apiUrl: apiUrl || DEFAULT_API_URL, token: token || "" };
}

function notificar(titulo, mensagem) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: titulo,
    message: mensagem,
  });
}

function formatarValor(valor) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

chrome.action.onClicked.addListener(async (tab) => {
  const { apiUrl, token } = await getConfig();
  if (!token) {
    notificar("Configure a extensão primeiro", "Abra as opções e cole seu token do financas.");
    chrome.runtime.openOptionsPage();
    return;
  }

  let dataUrl;
  try {
    // captureVisibleTab exige o gesto do usuário que este próprio
    // clique já é -- não precisa de host_permissions pra casa de
    // aposta nenhuma, só captura o que já está na tela.
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {
    notificar("Não consegui tirar o print", "Tente de novo nesta aba.");
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/api/extensao/apostas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Extension-Token": token },
      body: JSON.stringify({ imagem: dataUrl }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      notificar(
        "Aposta registrada ✓",
        `${body.casa} — ${body.descricao} (${formatarValor(body.valorApostado)})`,
      );
      return;
    }

    const codigo = body?.erro?.codigo;
    if (codigo === "casa_nao_reconhecida") {
      notificar("Não reconheci a casa", body.erro.mensagem + " -- registre na mão.");
    } else if (codigo === "extracao_falhou") {
      notificar("Não consegui ler o print", "Tente um print mais nítido, ou registre na mão.");
    } else if (codigo === "token_invalido") {
      notificar("Token inválido", "Confira o token nas opções da extensão.");
    } else {
      notificar("Não consegui registrar a aposta", body?.erro?.mensagem || `Erro ${res.status}`);
    }
  } catch {
    notificar("Não consegui falar com o financas", "Confira sua conexão e a URL configurada.");
  }
});
