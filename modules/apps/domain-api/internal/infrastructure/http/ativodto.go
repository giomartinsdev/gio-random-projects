package httpapi

import (
	"time"

	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativo"
	domainativomovimento "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativomovimento"
)

// AtivoResponse adds valor_mercado_atual (quantidade_atual x
// ultima_cotacao) on top of the raw entity -- rentabilidade completa
// (custo médio, proventos acumulados) is left to asset-manager-api /
// the BFF, which have the fuller picture; see the spec's own note.
type AtivoResponse struct {
	ID                string    `json:"id"`
	UsuarioEmail      string    `json:"usuario_email"`
	ContaID           string    `json:"conta_id"`
	Ticker            string    `json:"ticker"`
	Status            string    `json:"status"`
	QuantidadeAtual   float64   `json:"quantidade_atual"`
	CustoMedio        float64   `json:"custo_medio"`
	UltimaCotacao     float64   `json:"ultima_cotacao,omitempty"`
	UltimaCotacaoEm   time.Time `json:"ultima_cotacao_em,omitempty"`
	ValorMercadoAtual float64   `json:"valor_mercado_atual"`
	CriadoEm          time.Time `json:"criado_em"`
	AtualizadoEm      time.Time `json:"atualizado_em"`
}

func toAtivoResponse(a domainativo.Ativo) AtivoResponse {
	return AtivoResponse{
		ID: a.ID, UsuarioEmail: a.UsuarioEmail, ContaID: a.ContaID, Ticker: a.Ticker, Status: a.Status,
		QuantidadeAtual: a.QuantidadeAtual, CustoMedio: a.CustoMedio,
		UltimaCotacao: a.UltimaCotacao, UltimaCotacaoEm: a.UltimaCotacaoEm,
		ValorMercadoAtual: a.QuantidadeAtual * a.UltimaCotacao,
		CriadoEm:          a.CriadoEm, AtualizadoEm: a.AtualizadoEm,
	}
}

func toAtivoResponses(ativos []domainativo.Ativo) []AtivoResponse {
	out := make([]AtivoResponse, len(ativos))
	for i, a := range ativos {
		out[i] = toAtivoResponse(a)
	}
	return out
}

type AtivoMovimentoResponse struct {
	ID                 string    `json:"id"`
	AtivoID            string    `json:"ativo_id"`
	Tipo               string    `json:"tipo"`
	Quantidade         float64   `json:"quantidade,omitempty"`
	PrecoUnitario      float64   `json:"preco_unitario,omitempty"`
	ValorProvento      float64   `json:"valor_provento,omitempty"`
	ResultadoRealizado float64   `json:"resultado_realizado,omitempty"`
	Data               time.Time `json:"data"`
	CriadoEm           time.Time `json:"criado_em"`
}

func toAtivoMovimentoResponse(m domainativomovimento.AtivoMovimento) AtivoMovimentoResponse {
	return AtivoMovimentoResponse{
		ID: m.ID, AtivoID: m.AtivoID, Tipo: m.Tipo, Quantidade: m.Quantidade,
		PrecoUnitario: m.PrecoUnitario, ValorProvento: m.ValorProvento, ResultadoRealizado: m.ResultadoRealizado,
		Data: m.Data, CriadoEm: m.CriadoEm,
	}
}

func toAtivoMovimentoResponses(movimentos []domainativomovimento.AtivoMovimento) []AtivoMovimentoResponse {
	out := make([]AtivoMovimentoResponse, len(movimentos))
	for i, m := range movimentos {
		out[i] = toAtivoMovimentoResponse(m)
	}
	return out
}
