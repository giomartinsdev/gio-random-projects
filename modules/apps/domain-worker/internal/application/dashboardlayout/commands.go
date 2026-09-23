// Package dashboardlayout holds the concrete application.Command
// payloads for the DashboardLayout aggregate -- domain-api decodes the
// same shapes on the other end (its own copy of this package, used
// only to build outgoing commands, never to decode).
package dashboardlayout

import "encoding/json"

type SaveInput struct {
	UserEmail string          `json:"user_email"`
	Blocos       json.RawMessage `json:"blocos"`
}

type DeleteInput struct {
	UserEmail string `json:"user_email"`
}
