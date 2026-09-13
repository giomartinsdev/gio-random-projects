const DEFAULT_API_URL = "https://apostas-api.giomartins.dev";

const apiUrlInput = document.getElementById("apiUrl");
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");

chrome.storage.local.get(["apiUrl", "token"], ({ apiUrl, token }) => {
  apiUrlInput.value = apiUrl || DEFAULT_API_URL;
  tokenInput.value = token || "";
});

document.getElementById("salvar").addEventListener("click", async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, "") || DEFAULT_API_URL;
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ apiUrl, token });
  status.textContent = "Salvo.";
  setTimeout(() => (status.textContent = ""), 2000);
});
