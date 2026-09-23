// Package ativo is the domain layer for the Ativo aggregate -- a
// position in one Ticker held inside a Conta (of tipo "investimento"),
// tracked as a running quantidade/custo_medio updated by every
// AtivoMovimento posted against it. RegistrarMovimento is this
// package's one piece of real business logic: compra/venda/provento
// each update the running position differently, and that arithmetic
// has to live in exactly one place so custo_medio and
// resultado_realizado are never computed two different ways by two
// different callers.
package ativo

import (
	"errors"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativomovimento"
)

const (
	StatusAberta    = "aberta"
	StatusEncerrada = "encerrada"
)

var (
	ErrUsuarioRequired        = errors.New("usuario_email is required")
	ErrContaRequired          = errors.New("conta_id is required")
	ErrTickerRequired         = errors.New("ticker is required")
	ErrQuantidadeInvalida     = errors.New("quantidade must be greater than zero")
	ErrPrecoInvalido          = errors.New("preco_unitario must be greater than zero")
	ErrTipoMovimentoInvalido  = errors.New("tipo must be \"compra\", \"venda\" or \"provento\"")
	ErrValorProventoInvalido  = errors.New("valor_provento must be greater than zero")
	ErrQuantidadeInsuficiente = errors.New("quantidade exceeds the current position")
	ErrAtivoEncerrado         = errors.New("ativo is encerrada")
)

type Ativo struct {
	ID              string
	UsuarioEmail    string
	ContaID         string
	Ticker          string
	QuantidadeAtual float64
	CustoMedio      float64
	UltimaCotacao   float64
	// UltimaCotacaoEm's zero value means "never quoted".
	UltimaCotacaoEm time.Time
	Status          string
	CriadoEm        time.Time
	AtualizadoEm    time.Time
}

func validTipoMovimento(t string) bool {
	return t == ativomovimento.TipoCompra || t == ativomovimento.TipoVenda || t == ativomovimento.TipoProvento
}

// New creates an Ativo from its first compra -- there is no way to
// open a position with a "venda" or "provento", same reasoning as Room
// always opening StatusOpen. It returns both the Ativo and the
// AtivoMovimento that funded it so the caller can persist both in one
// transaction.
func New(id, usuarioEmail, contaID, ticker string, quantidadeInicial, precoUnitario float64, data time.Time) (Ativo, ativomovimento.AtivoMovimento, error) {
	if usuarioEmail == "" {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrUsuarioRequired
	}
	if contaID == "" {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrContaRequired
	}
	if ticker == "" {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrTickerRequired
	}
	if quantidadeInicial <= 0 {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrQuantidadeInvalida
	}
	if precoUnitario <= 0 {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrPrecoInvalido
	}
	if data.IsZero() {
		data = time.Now().UTC()
	}

	now := time.Now().UTC()
	a := Ativo{
		ID:              id,
		UsuarioEmail:    usuarioEmail,
		ContaID:         contaID,
		Ticker:          ticker,
		QuantidadeAtual: quantidadeInicial,
		CustoMedio:      precoUnitario,
		Status:          StatusAberta,
		CriadoEm:        now,
		AtualizadoEm:    now,
	}
	mov := ativomovimento.AtivoMovimento{
		AtivoID:       id,
		Tipo:          ativomovimento.TipoCompra,
		Quantidade:    quantidadeInicial,
		PrecoUnitario: precoUnitario,
		Data:          data,
		CriadoEm:      now,
	}
	return a, mov, nil
}

// RegistrarMovimento is the aggregate's central rule: applying a
// compra/venda/provento to an existing Ativo. It returns the updated
// Ativo (running quantidade/custo_medio/status) and the resulting
// AtivoMovimento record -- both are persisted together by the caller,
// same "return both sides" shape as New.
func RegistrarMovimento(a Ativo, tipo string, quantidade, precoUnitario, valorProvento float64, data time.Time) (Ativo, ativomovimento.AtivoMovimento, error) {
	if !validTipoMovimento(tipo) {
		return Ativo{}, ativomovimento.AtivoMovimento{}, ErrTipoMovimentoInvalido
	}
	if data.IsZero() {
		data = time.Now().UTC()
	}

	now := time.Now().UTC()
	mov := ativomovimento.AtivoMovimento{
		AtivoID:  a.ID,
		Tipo:     tipo,
		Data:     data,
		CriadoEm: now,
	}

	switch tipo {
	case ativomovimento.TipoCompra:
		if quantidade <= 0 {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrQuantidadeInvalida
		}
		if precoUnitario <= 0 {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrPrecoInvalido
		}
		custoAtualTotal := a.QuantidadeAtual * a.CustoMedio
		novaQuantidade := a.QuantidadeAtual + quantidade
		a.CustoMedio = (custoAtualTotal + quantidade*precoUnitario) / novaQuantidade
		a.QuantidadeAtual = novaQuantidade
		mov.Quantidade = quantidade
		mov.PrecoUnitario = precoUnitario

	case ativomovimento.TipoVenda:
		if quantidade <= 0 {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrQuantidadeInvalida
		}
		if precoUnitario <= 0 {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrPrecoInvalido
		}
		if quantidade > a.QuantidadeAtual {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrQuantidadeInsuficiente
		}
		resultado := quantidade * (precoUnitario - a.CustoMedio)
		a.QuantidadeAtual -= quantidade
		if a.QuantidadeAtual == 0 {
			a.Status = StatusEncerrada
		}
		mov.Quantidade = quantidade
		mov.PrecoUnitario = precoUnitario
		mov.ResultadoRealizado = resultado

	case ativomovimento.TipoProvento:
		if valorProvento <= 0 {
			return Ativo{}, ativomovimento.AtivoMovimento{}, ErrValorProventoInvalido
		}
		mov.ValorProvento = valorProvento
	}

	a.AtualizadoEm = now
	return a, mov, nil
}

// AtualizarCotacao is a lightweight update outside RegistrarMovimento's
// scope -- a quote refresh never touches quantidade/custo_medio, so it
// doesn't need the full domain flow (main spec allows the repository
// to apply this directly against Postgres; this method exists for
// completeness/testability of the same rule).
func (a *Ativo) AtualizarCotacao(cotacao float64, obtidaEm time.Time) {
	a.UltimaCotacao = cotacao
	a.UltimaCotacaoEm = obtidaEm
	a.AtualizadoEm = time.Now().UTC()
}
