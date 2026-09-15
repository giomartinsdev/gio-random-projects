package cluster

import (
	"encoding/json"
	"time"
)

// RoomSummary mirrors rooms.RoomSummary without importing the rooms
// package -- the cluster package must not depend on room state, only
// on the wire shape of "what the home page shows".
type RoomSummary struct {
	RoomID     string    `json:"roomId"`
	People     int       `json:"people"`
	Publishing int       `json:"publishing"`
	CreatedAt  time.Time `json:"createdAt"`
}

func parseJSON(body []byte, dst any) error { return json.Unmarshal(body, dst) }