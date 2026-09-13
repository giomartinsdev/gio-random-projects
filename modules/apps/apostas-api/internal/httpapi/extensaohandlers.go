// The betting-slip Chrome extension's one route: POST a screenshot,
// get a registered aposta back. No session cookie exists in a service
// worker, so this route sits outside requireAuth entirely (see
// server.go's Handler) and checks its own static token instead --
// financas is a single-person product, so one shared secret mapped to
// one fixed identity (ExtensionUsuarioEmail) is enough; see Config's
// own doc comment for why this isn't a general personal-token system.
package httpapi

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/domainapi"
)

// maxImagemBytes bounds the decoded screenshot size -- generous enough
// for a full-page PNG capture, same order of magnitude as
// transacional-api's own anexo_imagem limit.
const maxImagemBytes = 8 << 20

type importarPrintRequest struct {
	// Imagem is base64, optionally as a data: URL (the extension sends
	// the raw output of canvas.toDataURL/captureVisibleTab, prefix and
	// all) -- stripped in handleImportarPrint before decoding.
	Imagem string `json:"imagem"`
}

// handleImportarPrint authenticates by static token (not session),
// reads the screenshot via internal/ai, matches the casa it read
// against one of the caller's own "aposta" contas, and -- on a match --
// registers the bet through the exact same registrar core
// handleRegistrarAposta uses. No confirmation step: a bad extraction
// becomes a bad aposta, corrected later like any manual entry mistake
// (a deliberate simplicity trade-off, not an oversight).
func (s *Server) handleImportarPrint(w http.ResponseWriter, r *http.Request) {
	if s.cfg.ExtensionToken == "" {
		writeError(w, http.StatusServiceUnavailable, "extensao_desabilitada", "extensão não configurada neste servidor")
		return
	}
	token := r.Header.Get("X-Extension-Token")
	if subtle.ConstantTimeCompare([]byte(token), []byte(s.cfg.ExtensionToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "token_invalido", "token de extensão inválido")
		return
	}
	if s.ai == nil || !s.ai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "ia_indisponivel", "leitura de print indisponível neste servidor")
		return
	}

	var req importarPrintRequest
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxImagemBytes+(maxImagemBytes/3)))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo_invalido", "corpo da requisição inválido: "+err.Error())
		return
	}

	imagem, mimeType, err := decodificarImagem(req.Imagem)
	if err != nil {
		writeError(w, http.StatusBadRequest, "imagem_invalida", err.Error())
		return
	}
	if len(imagem) > maxImagemBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "imagem_muito_grande", "imagem excede o tamanho máximo permitido")
		return
	}

	usuarioEmail := s.cfg.ExtensionUsuarioEmail
	extracao, err := s.ai.LerAposta(r.Context(), imagem, mimeType)
	if err != nil {
		// Logged, never returned to the extension -- the real error
		// (model rejected the request, 9router unreachable, bad JSON
		// shape) is only useful server-side; the person just sees "não
		// consegui ler".
		log.Printf("apostas-api: extração de print falhou: %v", err)
		writeError(w, http.StatusUnprocessableEntity, "extracao_falhou", "não consegui ler os dados da aposta no print")
		return
	}
	if extracao.Casa == "" || extracao.Descricao == "" || extracao.ValorApostado <= 0 {
		log.Printf("apostas-api: extração incompleta: %+v", extracao)
		writeError(w, http.StatusUnprocessableEntity, "extracao_falhou", "não consegui ler os dados da aposta no print")
		return
	}

	contas, err := s.domain.ListContas(r.Context(), usuarioEmail)
	if err != nil {
		writeError(w, http.StatusBadGateway, "domain_api_indisponivel", err.Error())
		return
	}
	conta := casarConta(contas, extracao.Casa)
	if conta == nil {
		writeError(w, http.StatusUnprocessableEntity, "casa_nao_reconhecida",
			"não reconheci a casa \""+extracao.Casa+"\" entre suas contas de aposta")
		return
	}

	apostaID, apiErr := s.registrar(r.Context(), usuarioEmail, conta.ID, extracao.Descricao, extracao.ValorApostado, extracao.Odd, time.Now())
	if apiErr != nil {
		writeError(w, apiErr.status, apiErr.codigo, apiErr.mensagem)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": apostaID, "casa": conta.Nome, "descricao": extracao.Descricao, "valorApostado": extracao.ValorApostado,
	})
}

// casarConta matches the casa name the AI read against one of the
// caller's "aposta" contas -- exact (case-insensitive) first, then
// substring containment in either direction ("Bet365" read from a
// print titled "Bet365 - Boletim" matches a conta literally named
// "Bet365"). Returns nil when nothing matches closely enough; this
// server never guesses which conta to debit.
func casarConta(contas []domainapi.Conta, casaLida string) *domainapi.Conta {
	casaLida = strings.ToLower(strings.TrimSpace(casaLida))
	if casaLida == "" {
		return nil
	}
	for i := range contas {
		if contas[i].Tipo != "aposta" {
			continue
		}
		nome := strings.ToLower(strings.TrimSpace(contas[i].Nome))
		if nome == casaLida {
			return &contas[i]
		}
	}
	for i := range contas {
		if contas[i].Tipo != "aposta" {
			continue
		}
		nome := strings.ToLower(strings.TrimSpace(contas[i].Nome))
		if strings.Contains(nome, casaLida) || strings.Contains(casaLida, nome) {
			return &contas[i]
		}
	}
	return nil
}

// decodificarImagem accepts either a data: URL
// ("data:image/png;base64,...") or a bare base64 string (assumed PNG),
// returning the decoded bytes and the MIME type to send the AI client.
func decodificarImagem(raw string) ([]byte, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, "", errImagemVazia
	}
	mimeType := "image/png"
	payload := raw
	if strings.HasPrefix(raw, "data:") {
		comma := strings.IndexByte(raw, ',')
		if comma < 0 {
			return nil, "", errImagemInvalida
		}
		header := raw[len("data:"):comma]
		if mime, _, ok := strings.Cut(header, ";"); ok {
			mimeType = mime
		}
		payload = raw[comma+1:]
	}
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, "", errImagemInvalida
	}
	return decoded, mimeType, nil
}

var (
	errImagemVazia    = errBody("imagem: obrigatória")
	errImagemInvalida = errBody("imagem: base64 inválido")
)

type errBody string

func (e errBody) Error() string { return string(e) }
