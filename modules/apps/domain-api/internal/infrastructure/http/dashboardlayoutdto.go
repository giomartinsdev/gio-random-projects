package httpapi

import (
	"encoding/json"
	"time"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/dashboardlayout"
)

type DashboardLayoutResponse struct {
	UserEmail string          `json:"user_email"`
	Blocos       json.RawMessage `json:"blocos"`
	UpdatedAt time.Time       `json:"updated_at"`
}

func toDashboardLayoutResponse(l domaindashboardlayout.DashboardLayout) DashboardLayoutResponse {
	return DashboardLayoutResponse{UserEmail: l.UserEmail, Blocos: l.Blocos, UpdatedAt: l.UpdatedAt}
}
