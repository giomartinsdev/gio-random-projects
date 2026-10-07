package domain

// Campaign is the projection of prospecta_campaign that this ACL models. The
// domain pair owns the row; this struct is only the shape read back.
//
// ICPID is empty until the company's ICP is attached, and StartCampaign refuses
// a campaign without it (422) -- a campaign with no ICP has nothing to match
// prospects against.
type Campaign struct {
	ID         string   `json:"id"`
	CompanyID  string   `json:"company_id"`
	ICPID      string   `json:"icp_id,omitempty"`
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	Channels   []string `json:"channels"`
	LeadsCount int      `json:"leads_count"`
}
