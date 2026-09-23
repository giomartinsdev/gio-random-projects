// Package ativomovimento holds the AtivoMovimento record type -- one
// row per compra/venda/provento posted against an Ativo. It is
// deliberately data-only: every invariant that decides whether a
// movimento is valid (enough quantidade to vender, which fields a
// given tipo requires) lives in domain/ativo.RegistrarMovimento, since
// applying a movimento always mutates the owning Ativo's running
// quantidade/custo_medio/status too -- there is no standalone "create a
// movimento" operation that doesn't also touch its Ativo.
package ativomovimento

import "time"

const (
	TipoCompra   = "compra"
	TipoVenda    = "venda"
	TipoProvento = "provento"
)

type AtivoMovimento struct {
	ID      string
	AtivoID string
	Kind    string
	// Quantidade and PrecoUnitario are required and > 0 for
	// compra/venda; both are zero for provento.
	Quantidade    float64
	PrecoUnitario float64
	// ValorProvento is required for provento; zero for compra/venda.
	ValorProvento float64
	Data          time.Time
	// ResultadoRealizado is only ever non-zero on a venda.
	ResultadoRealizado float64
	CreatedAt           time.Time
}
