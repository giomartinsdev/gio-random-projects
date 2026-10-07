package domain

// Lead is the projection of prospecta_lead. The list view reads the flat
// fields; the detail view also carries the enrichment blob, a timeline and the
// last message. All extras are omitempty so the list projection stays lean.
type Lead struct {
	ID          string          `json:"id"`
	CampaignID  string          `json:"campaign_id,omitempty"`
	CompanyName string          `json:"company_name"`
	Segment     string          `json:"segment,omitempty"`
	Channel     string          `json:"channel,omitempty"`
	Fit         int             `json:"fit"`
	Status      string          `json:"status"`
	SourceURL   string          `json:"source_url,omitempty"`
	Enriched    map[string]any  `json:"enriched,omitempty"`
	Timeline    []TimelineEntry `json:"timeline,omitempty"`
	LastMessage *Message        `json:"last_message,omitempty"`
}

// TimelineEntry is one step of a lead's history (discovered, enriched,
// qualified, contacted, replied, meeting).
type TimelineEntry struct {
	At     string `json:"at"`
	Kind   string `json:"kind"`
	Detail string `json:"detail,omitempty"`
}
