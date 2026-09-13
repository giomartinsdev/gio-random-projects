// Captura de apostas: um clique no ícone da extensão abre uma seleção
// de área (overlay.js, injetado sob demanda) sobre a aba atual; a área
// escolhida é recortada do print da aba e mandada pro apostas-api, que
// lê com IA e registra a aposta sozinho -- sem tela de confirmação
// nenhuma aqui (decisão já tomada: um print errado vira uma aposta
// errada, corrigida depois na mão, como qualquer lançamento manual). O
// único feedback é uma notificação nativa do Chrome, sucesso ou falha.

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

// arrayBufferToBase64 avoids FileReader (not always reliable in MV3
// service workers) -- chunked to keep String.fromCharCode's argument
// list well under engine limits for a full-tab screenshot's worth of
// bytes.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// recortarSelecao captures the full visible tab, then crops it down to
// the rect the overlay reported (in CSS pixels, scaled here to device
// pixels since captureVisibleTab always returns device-resolution
// pixels regardless of page zoom/DPI).
async function recortarSelecao(windowId, rect) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const fullBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(fullBlob);

  const dpr = rect.devicePixelRatio || 1;
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await croppedBlob.arrayBuffer();
  return `data:image/png;base64,${arrayBufferToBase64(buffer)}`;
}

async function enviarParaApostasApi(dataUrl) {
  const { apiUrl, token } = await getConfig();
  if (!token) {
    notificar("Configure a extensão primeiro", "Abra as opções e cole seu token do financas.");
    chrome.runtime.openOptionsPage();
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
      notificar("Não consegui ler o print", "Selecione uma área com o bilhete completo, ou registre na mão.");
    } else if (codigo === "token_invalido") {
      notificar("Token inválido", "Confira o token nas opções da extensão.");
    } else {
      notificar("Não consegui registrar a aposta", body?.erro?.mensagem || `Erro ${res.status}`);
    }
  } catch {
    notificar("Não consegui falar com o financas", "Confira sua conexão e a URL configurada.");
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const { token } = await getConfig();
  if (!token) {
    notificar("Configure a extensão primeiro", "Abra as opções e cole seu token do financas.");
    chrome.runtime.openOptionsPage();
    return;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["overlay.js"] });
  } catch {
    notificar("Não consegui abrir a seleção", "Essa aba não permite a extensão rodar nela.");
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "apostas-selecao-feita" && sender.tab) {
    recortarSelecao(sender.tab.windowId, message.rect)
      .then(enviarParaApostasApi)
      .catch(() => notificar("Não consegui recortar o print", "Tente selecionar de novo."));
  }
  // "apostas-selecao-cancelada" needs no handling -- the person just
  // didn't want to send anything this time.
});
