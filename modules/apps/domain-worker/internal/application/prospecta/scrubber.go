package prospecta

import (
	"encoding/json"
	"regexp"
)

// scrubPII remove PII do payload antes de ele virar linha de auditoria
// (data-model §8, spec §9). O contrato do Prospecta manda o payload JÁ passado
// por scrubbing, então a última barreira é aqui — o worker nunca sabe em que
// ponto o produtor esqueceu.
//
// Duas defesas, porque uma só não cobre o contrato: (1) chaves conhecidas de PII
// (email, phone, telefone...) viram "[redacted]" independente do valor; (2)
// qualquer string que ainda pareça um e-mail ou telefone é mascarada, para o
// caso de a PII vir dentro de um campo de texto livre (content/enriched).
//
// O payload de auditoria não é um contrato de leitura — perder fidelidade de
// tipo aqui não quebra nada.
func scrubPII(payload []byte) []byte {
	if len(payload) == 0 {
		return payload
	}
	var v any
	if err := json.Unmarshal(payload, &v); err != nil {
		// Não é JSON (ou é um escalar solto): trata como texto e mascara.
		return []byte(redactString(string(payload)))
	}
	scrubbed := scrubValue(v)
	out, err := json.Marshal(scrubbed)
	if err != nil {
		return payload
	}
	return out
}

// piiKeys são os campos cujo nome, por si, já diz que o valor é PII. Comparados
// em minúsculas.
var piiKeys = map[string]bool{
	"email":      true,
	"e-mail":     true,
	"phone":      true,
	"telefone":   true,
	"whatsapp":   true,
	"celular":    true,
	"cpf":        true,
	"cnpj":       true,
	"document":   true,
	"documento":  true,
	"password":   true,
	"senha":      true,
	"token":      true,
	"api_key":    true,
	"apikey":     true,
	"authorization": true,
}

var (
	emailRe = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	// Telefone brasileiro em E.164 (+55DDNNNNNNNNN) ou formatos comuns com
	// separadores. Pelo menos 10 dígitos, para não mascarar anos/ids curtos.
	phoneRe = regexp.MustCompile(`(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,3}\)?[\s.\-]?)?\d{4,5}[\s.\-]?\d{4}`)
)

const redacted = "[redacted]"

func scrubValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if piiKeys[lower(k)] {
				out[k] = redacted
				continue
			}
			out[k] = scrubValue(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = scrubValue(val)
		}
		return out
	case string:
		return redactString(t)
	default:
		return v
	}
}

func redactString(s string) string {
	s = emailRe.ReplaceAllString(s, redacted)
	s = phoneRe.ReplaceAllString(s, redacted)
	return s
}

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}
