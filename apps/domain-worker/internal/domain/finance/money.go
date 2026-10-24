// Package finance é a camada de domínio do bounded context financeiro no
// domain-worker: os agregados (Transaction, Budget), o value object Money e as
// invariantes do §3.4. Tipos Go puros, sem banco e sem HTTP.
//
// Money é inteiro em unidades menores (centavos) — nunca float, é a invariante
// nº1 do §3.4 levada a sério: soma exata de dinheiro não se faz com `float64`.
// A moeda viaja junto (BRL hoje), porque somar moedas diferentes é erro, não
// conveniência.
package finance

import (
	"errors"
	"fmt"
	"strings"
)

var (
	ErrInvalidAmount   = errors.New("amount is invalid")
	ErrCurrencyMissing = errors.New("currency is required")
	ErrCurrencyMismatch = errors.New("cannot mix currencies in one sum")
)

// Money é dinheiro em centavos, com moeda. Imutável por convenção (métodos
// devolvem cópias).
type Money struct {
	// Cents é o valor em unidades menores (ex.: centavos de BRL). Negativo é
	// permitido (um saldo pode ficar negativo); zero é válido.
	Cents    int64
	Currency string
}

// ParseMoney lê um valor decimal como string ("45", "45.00", "-1.234,56") e o
// converte em centavos. É a única porta de entrada de um valor monetário: o
// que chega do worker ou da ACL é sempre texto (nunca número), e o parse é
// exato — nada de `strconv.ParseFloat`.
func ParseMoney(raw, currency string) (Money, error) {
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if cur == "" {
		return Money{}, ErrCurrencyMissing
	}
	text := strings.TrimSpace(raw)
	if text == "" {
		return Money{}, fmt.Errorf("%w: empty", ErrInvalidAmount)
	}
	negative := false
	if strings.HasPrefix(text, "-") {
		negative = true
		text = text[1:]
	} else if strings.HasPrefix(text, "+") {
		text = text[1:]
	}
	// Regra de separador, sem ambiguidade:
	//   - ponto E vírgula juntos: a vírgula é o decimal (pt-BR: "1.234,56");
	//   - só um tipo de separador: ele é o decimal ("45.00", "45,00");
	//   - o mesmo separador mais de uma vez: ou é milhar pt-BR ("1.234.567"),
	//     ou é lixo ("4.5.6") — tratamos como milhar e a validação de dígitos
	//     depois decide.
	dots := strings.Count(text, ".")
	commas := strings.Count(text, ",")
	switch {
	case dots > 0 && commas > 0:
		text = strings.ReplaceAll(text, ".", "")
		text = strings.ReplaceAll(text, ",", ".")
	case commas == 1:
		text = strings.ReplaceAll(text, ",", ".")
	case commas > 1:
		if !validThousands(text, ',') {
			return Money{}, fmt.Errorf("%w: %q", ErrInvalidAmount, raw)
		}
		text = strings.ReplaceAll(text, ",", "") // milhar pt-BR
	case dots > 1:
		if !validThousands(text, '.') {
			return Money{}, fmt.Errorf("%w: %q", ErrInvalidAmount, raw)
		}
		text = strings.ReplaceAll(text, ".", "") // milhar
	}
	// A partir daqui só pode sobrar um "." (ou nenhum).
	if strings.Count(text, ".") > 1 {
		return Money{}, fmt.Errorf("%w: %q", ErrInvalidAmount, raw)
	}
	intPart, fracPart, _ := strings.Cut(text, ".")
	if intPart == "" {
		intPart = "0"
	}
	if fracPart == "" {
		fracPart = "00"
	}
	if len(fracPart) > 2 {
		// Mais de dois decimais não é dinheiro (o domínio é centavo-exato).
		fracPart = fracPart[:2]
	}
	for len(fracPart) < 2 {
		fracPart += "0"
	}
	if !allDigits(intPart) || !allDigits(fracPart) {
		return Money{}, fmt.Errorf("%w: %q", ErrInvalidAmount, raw)
	}
	var cents int64
	for _, r := range intPart {
		cents = cents*10 + int64(r-'0')
	}
	for _, r := range fracPart {
		cents = cents*10 + int64(r-'0')
	}
	if negative {
		cents = -cents
	}
	return Money{Cents: cents, Currency: cur}, nil
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// validThousands diz se `text` está no formato de milhar (1 a 3 dígitos, depois
// grupos exatos de 3, separados por `sep`). "1.234.567" e "12.345" passam;
// "4.5.6" não.
func validThousands(text string, sep rune) bool {
	groups := strings.Split(text, string(sep))
	if len(groups) < 2 {
		return false
	}
	if len(groups[0]) < 1 || len(groups[0]) > 3 {
		return false
	}
	for _, g := range groups[1:] {
		if len(g) != 3 || !allDigits(g) {
			return false
		}
	}
	return allDigits(groups[0])
}

// Add soma dois valores da MESMA moeda. Somar moedas diferentes é erro.
func (m Money) Add(o Money) (Money, error) {
	if m.Currency != o.Currency {
		return Money{}, ErrCurrencyMismatch
	}
	return Money{Cents: m.Cents + o.Cents, Currency: m.Currency}, nil
}

// Sub subtrai dois valores da MESMA moeda.
func (m Money) Sub(o Money) (Money, error) {
	if m.Currency != o.Currency {
		return Money{}, ErrCurrencyMismatch
	}
	return Money{Cents: m.Cents - o.Cents, Currency: m.Currency}, nil
}

// Neg devolve o valor com o sinal trocado (para o débito de uma transferência).
func (m Money) Neg() Money { return Money{Cents: -m.Cents, Currency: m.Currency} }

// IsZero diz se o valor é zero.
func (m Money) IsZero() bool { return m.Cents == 0 }

// Decimal devolve a representação decimal canônica como string (ex.: "1234.50",
// "-0.05") — o formato que o schema NUMERIC aceita e que o JSON transporta sem
// perder exatidão.
func (m Money) Decimal() string {
	sign := ""
	cents := m.Cents
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}
