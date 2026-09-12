package httpapi

import (
	"encoding/json"
	"time"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/dashboardlayout"
)

type DashboardLayoutResponse struct {
	UsuarioEmail string          `json:"usuario_email"`
	Blocos       json.RawMessage `json:"blocos"`
	AtualizadoEm time.Time       `json:"atualizado_em"`
}

func toDashboardLayoutResponse(l domaindashboardlayout.DashboardLayout) DashboardLayoutResponse {
	return DashboardLayoutResponse{UsuarioEmail: l.UsuarioEmail, Blocos: l.Blocos, AtualizadoEm: l.AtualizadoEm}
}
