// Refetch periódico + ao voltar o foco da aba — é o que faz a compra feita na
// rua aparecer na UI segundos depois do sync do Open Finance (webhook → conector
// → comando → evento → ledger). Sem socket: consulta leve, barato e honesto.
import { useEffect } from "react";

export function useAutoRefresh(load: () => void, seconds = 25) {
  useEffect(() => {
    const id = window.setInterval(load, seconds * 1000);
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, seconds]);
}