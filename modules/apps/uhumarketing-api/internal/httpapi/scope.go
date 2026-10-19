package httpapi

import "net/http"

// svc devolve o Service escopado no workspace da sessão.
//
// Os handlers chamam `h.svc(r)` em vez de `h.Service` porque a única diferença
// entre uma conta e outra é o workspace — e ele vem do token, resolvido pelo
// middleware. Esquecer esse detalhe seria deixar um handler operando sobre o
// workspace errado.
func (h *Handlers) svc(r *http.Request) *Service {
	return h.Service.For(sessionFrom(r))
}
