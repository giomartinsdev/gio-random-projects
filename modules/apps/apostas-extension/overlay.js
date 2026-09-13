// Injetado sob demanda (chrome.scripting.executeScript) quando a pessoa
// clica no ícone da extensão -- desenha uma seleção de área por
// arrastar do mouse sobre a página atual, e manda de volta pro
// background o retângulo escolhido (em pixels CSS; o background
// converte pra pixels de device antes de recortar o print). Esc
// cancela. O overlay se remove sozinho ao final, sucesso ou cancelado.
(() => {
  // Evita empilhar overlays se a pessoa clicar de novo enquanto um já
  // está aberto.
  if (document.getElementById("__apostas_overlay__")) return;

  const overlay = document.createElement("div");
  overlay.id = "__apostas_overlay__";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,0.25)",
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    border: "2px solid #c45d3e",
    background: "rgba(196,93,62,0.15)",
    display: "none",
  });
  overlay.appendChild(box);

  const hint = document.createElement("div");
  hint.textContent = "Arraste para selecionar o bilhete — Esc para cancelar";
  Object.assign(hint.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#2a2420",
    color: "#f7f2e9",
    padding: "6px 14px",
    borderRadius: "999px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  });
  overlay.appendChild(hint);

  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "apostas-selecao-cancelada" });
    }
  }
  document.addEventListener("keydown", onKeyDown, true);

  overlay.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.display = "block";
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    cleanup();

    if (w < 10 || h < 10) {
      chrome.runtime.sendMessage({ type: "apostas-selecao-cancelada" });
      return;
    }
    chrome.runtime.sendMessage({
      type: "apostas-selecao-feita",
      rect: { x, y, width: w, height: h, devicePixelRatio: window.devicePixelRatio || 1 },
    });
  });
})();
