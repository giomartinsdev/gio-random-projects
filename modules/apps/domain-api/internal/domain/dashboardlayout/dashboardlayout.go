// Package dashboardlayout is the domain layer for a usuario's saved
// dashboard layout as seen from domain-api: read-only, same split as
// domain/room. Saving/deleting a layout go through /sync
// (dashboardlayout.save, dashboardlayout.delete) by the caller directly
// -- when no row exists, the frontend falls back to its own embedded
// default layout.
package dashboardlayout

import (
	"encoding/json"
	"time"
)

type DashboardLayout struct {
	UsuarioEmail string
	Blocos       json.RawMessage
	AtualizadoEm time.Time
}
