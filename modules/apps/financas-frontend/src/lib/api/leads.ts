// Cliente do leads-api -- o único backend público do produto (sem
// sessão de Access, sem cookie). A landing page usa isso pra capturar
// o e-mail de quem ainda não é uma pessoa usuária.
export const LEADS_API_URL = import.meta.env.VITE_LEADS_API_URL || "http://localhost:8015";

export class LeadsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}

// Sem credentials:"include" de propósito -- esta rota não tem cookie
// de sessão nenhum para atravessar a origem cruzada.
export async function capturarLead(email: string): Promise<void> {
  const res = await fetch(`${LEADS_API_URL}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 201 || res.status === 202) return;
  let codigo: string | undefined;
  try {
    const body = await res.json();
    codigo = body?.erro?.codigo;
  } catch {
    // sem corpo JSON de erro.
  }
  throw new LeadsApiError(`leads-api ${res.status}`, res.status, codigo);
}
