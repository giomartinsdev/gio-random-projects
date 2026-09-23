package httpapi

import (
	"time"

	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/aposta"
)

type ApostaResponse struct {
	ID            string    `json:"id"`
	UserEmail  string    `json:"user_email"`
	ContaID       string    `json:"conta_id"`
	Descricao     string    `json:"descricao"`
	ValorApostado float64   `json:"valor_apostado"`
	Odd           float64   `json:"odd,omitempty"`
	Status        string    `json:"status"`
	RetornoObtido float64   `json:"retorno_obtido,omitempty"`
	DataAposta    time.Time `json:"data_aposta"`
	DataResultado time.Time `json:"data_resultado,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func toApostaResponse(a domainaposta.Aposta) ApostaResponse {
	return ApostaResponse{
		ID: a.ID, UserEmail: a.UserEmail, ContaID: a.ContaID, Descricao: a.Descricao,
		ValorApostado: a.ValorApostado, Odd: a.Odd, Status: a.Status, RetornoObtido: a.RetornoObtido,
		DataAposta: a.DataAposta, DataResultado: a.DataResultado,
		CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
	}
}

func toApostaResponses(apostas []domainaposta.Aposta) []ApostaResponse {
	out := make([]ApostaResponse, len(apostas))
	for i, a := range apostas {
		out[i] = toApostaResponse(a)
	}
	return out
}
